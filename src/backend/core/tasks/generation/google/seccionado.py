import os
import logging
import json
import threading
import time
import fcntl
import sys

from datetime import datetime
from tqdm import tqdm
from tasks.assemble import BaseAssembler
from nltk.tokenize import sent_tokenize
from queue import Queue, PriorityQueue
from openai import OpenAI
from concurrent.futures import ThreadPoolExecutor, as_completed

from utils.utils import get_relative_path

# Secciones del informe de alta a GENERAR
TARGET_SECTIONS_CONFIG = {
    'motivo_de_ingreso': {
        'title': 'Motivo de ingreso',
        'description': 'Razón principal del ingreso hospitalario',
        'prompt_file': 'Motivo_de_ingreso.txt'
    },
    'antecedentes': {
        'title': 'Antecedentes',
        'description': 'Antecedentes personales y familiares relevantes',
        'prompt_file': 'Antecedentes.txt'
    },
    'historia_actual': {
        'title': 'Historia Actual',
        'description': 'Descripción de la enfermedad actual que motiva el ingreso',
        'prompt_file': 'Historia_Actual.txt'
    },
    'evolucion': {
        'title': 'Evolución',
        'description': 'Evolución clínica durante el ingreso',
        'prompt_file': 'Evolucion.txt'
    },
    'pruebas_complementarias': {
        'title': 'Pruebas Complementarias',
        'description': 'Pruebas diagnósticas realizadas y sus resultados',
        'prompt_file': 'Pruebas_complementarias.txt'
    },
    'procedimientos': {
        'title': 'Procedimientos / Intervención Quirúrgica',
        'description': 'Procedimientos o intervenciones realizadas',
        'prompt_file': 'Procedimientos_Intervencion_quirurgica.txt'
    },
    'juicio_clinico': {
        'title': 'Juicio Clínico / Diagnósticos',
        'description': 'Diagnósticos finales del ingreso',
        'prompt_file': 'Juicio_clinico_Diagnosticos.txt'
    },
    'plan_terapeutico': {
        'title': 'Plan Terapéutico',
        'description': 'Plan de tratamiento durante y post ingreso',
        'prompt_file': 'Plan_terapeutico.txt'
    },
    'tratamiento': {
        'title': 'Tratamiento al Alta',
        'description': 'Medicación y tratamiento al alta',
        'prompt_file': 'Tratamiento.txt'
    },
    'revisiones': {
        'title': 'Revisiones',
        'description': 'Citas y seguimiento posterior',
        'prompt_file': 'Revisiones.txt'
    }
}


class ProgressLogger:
    """Clase para registrar el progreso de la generación del informe."""
    
    def __init__(self, output_path, output_file):
        self.progress_file = os.path.join(output_path, output_file.replace('.md', '.progress.log'))
        print(f"[PROGRESS_LOGGER] Inicializando archivo de progreso: {self.progress_file}")
        logging.info(f"Archivo de progreso configurado en: {self.progress_file}")
        
        if os.path.exists(self.progress_file):
            os.remove(self.progress_file)
        
        try:
            with open(self.progress_file, 'w', encoding='utf-8') as f:
                f.write('')
        except Exception as e:
            print(f"[PROGRESS_LOGGER] ERROR al crear archivo de progreso: {e}")
            logging.error(f"Error creando archivo de progreso: {e}")
    
    def log(self, message, log_type='info'):
        try:
            print(f"[PROGRESS_LOGGER] {message}")
            with open(self.progress_file, 'a', encoding='utf-8') as f:
                log_entry = {
                    'message': message,
                    'type': log_type,
                    'timestamp': datetime.now().isoformat()
                }
                json_line = json.dumps(log_entry, ensure_ascii=False) + '\n'
                f.write(json_line)
                f.flush()
                os.fsync(f.fileno())
        except Exception as e:
            print(f"[PROGRESS_LOGGER] ERROR escribiendo log: {e}")
            logging.error(f"Error escribiendo log de progreso: {e}")


class StreamingWriter:
    """Clase que gestiona la escritura ordenada de múltiples streams paralelos."""
    
    def __init__(self, output_file, section_order):
        self.output_file = output_file
        self.section_order = section_order
        self.current_section_index = 0
        self.section_buffers = {section: [] for section in section_order}
        self.section_complete = {section: False for section in section_order}
        self.lock = threading.Lock()
        self.file_handle = None
        
        print(f"[STREAMING_WRITER] Inicializado con {len(section_order)} secciones")
        
    def open_file(self):
        """Abre el archivo para escritura con lock exclusivo."""
        print(f"[STREAMING_WRITER] Abriendo archivo: {self.output_file}")
        self.file_handle = open(self.output_file, "a", encoding="utf-8")
        try:
            fcntl.flock(self.file_handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            print(f"[STREAMING_WRITER] ✓ Lock exclusivo adquirido")
        except BlockingIOError:
            print(f"[STREAMING_WRITER] ❌ OTRO PROCESO ya tiene el archivo bloqueado: {self.output_file}")
            print(f"[STREAMING_WRITER] Abortando para evitar corrupción del documento.")
            self.file_handle.close()
            self.file_handle = None
            raise RuntimeError(f"No se pudo adquirir lock exclusivo en {self.output_file}. Otro proceso ya lo está escribiendo.")
        self.file_handle.write(f"# Informe de Alta\n\n")
        self.file_handle.write(f"*Generado automáticamente - {datetime.now().strftime('%d/%m/%Y %H:%M')}*\n\n")
        self.file_handle.flush()
    
    def close_file(self):
        """Cierra el archivo y libera el lock."""
        if self.file_handle:
            try:
                fcntl.flock(self.file_handle, fcntl.LOCK_UN)
            except Exception:
                pass
            self.file_handle.close()
    
    def write_chunk(self, section_key, chunk_text):
        """Escribe un fragmento de texto para una sección específica."""
        with self.lock:
            section_index = self.section_order.index(section_key)
            
            if section_index == self.current_section_index:
                self.file_handle.write(chunk_text)
                self.file_handle.flush()
                os.fsync(self.file_handle.fileno())
            else:
                self.section_buffers[section_key].append(chunk_text)
    
    def mark_section_complete(self, section_key):
        """Marca una sección como completada."""
        with self.lock:
            self.section_complete[section_key] = True
            self._try_flush()
    
    def _try_flush(self):
        """Intenta escribir las secciones que están listas en orden."""
        while self.current_section_index < len(self.section_order):
            current_section = self.section_order[self.current_section_index]
            
            if self.section_buffers[current_section]:
                for chunk in self.section_buffers[current_section]:
                    self.file_handle.write(chunk)
                self.file_handle.flush()
                os.fsync(self.file_handle.fileno())
                self.section_buffers[current_section] = []
            
            if self.section_complete[current_section]:
                self.current_section_index += 1
            else:
                break


def get_model_response_llm_streaming(client, prompt, content, model_path, section_key, section_title, streaming_writer, logger):
    """Genera respuesta del LLM en streaming para una sección."""
    # Límite de tokens: 16384 máximo, truncamos en 15000 para dejar margen
    MAX_PROMPT_TOKENS = 15000
    
    logger.info(f"[LLM_STREAM] Generando sección '{section_key}'")
    print(f"[LLM_STREAM] Llamando a modelo '{model_path}' para '{section_key}'...")
    
    try:
        max_tokens = 1024

        if section_key=="tratamiento":
            max_tokens = 512
        response_stream = client.chat.completions.create(
            model=model_path,
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": content}
            ],
            max_tokens=max_tokens,
            temperature=0.0,
            stream=True,
            extra_body={"chat_template_kwargs": {"truncate_prompt_tokens": MAX_PROMPT_TOKENS}},
            # extra_body={"truncate_prompt_tokens": MAX_PROMPT_TOKENS}  # Truncar automáticamente si excede
        )
        
        # Escribir header de la sección
        header = f"\n## {section_title}\n\n"
        streaming_writer.write_chunk(section_key, header)
        
        accumulated_text = ""
        header_cleaned = False
        
        for chunk in response_stream:
            if chunk.choices[0].delta.content:
                text = chunk.choices[0].delta.content
                accumulated_text += text
                
                # Eliminar headers redundantes del LLM al inicio
                if not header_cleaned:
                    if "\n" in accumulated_text or len(accumulated_text) > 200:
                        first_line = accumulated_text.split('\n', 1)[0].strip()
                        
                        normalized_first = first_line.replace('*', '').replace('#', '').strip().lower()
                        normalized_title = section_title.lower()
                        
                        # Limpieza agresiva de headers repetidos
                        is_redundant = False
                        
                        # Caso 1: Estilo Markdown evidente (# Título)
                        if first_line.startswith('#'):
                            is_redundant = True
                            
                        # Caso 2: Coincidencia bidireccional (El output es prefijo del titulo, o viceversa)
                        # Ej: Title="Juicio/Diag", Line="Juicio:" -> Title startswith Line (cleaned)
                        elif normalized_title.startswith(normalized_first.split(':')[0].strip()) or \
                             normalized_first.startswith(normalized_title):
                            is_redundant = True
                            
                        # Caso 3: Empieza por palabras clave del título y parece un header (termina en : o es corto)
                        elif (len(normalized_first) < 80) and (first_line.strip().endswith(':') or first_line.strip().startswith('**')):
                             title_words = set(normalized_title.split())
                             line_words = set(normalized_first.replace(':', '').split())
                             # Si comparten al menos una palabra significativa (len>3)
                             significant_matches = [w for w in title_words.intersection(line_words) if len(w) > 3]
                             if significant_matches:
                                 is_redundant = True

                        if is_redundant:
                            logger.info(f"Removing redundant header: {first_line}")
                            if '\n' in accumulated_text:
                                accumulated_text = accumulated_text.split('\n', 1)[1]
                            else:
                                accumulated_text = ""
                        
                        header_cleaned = True
                
                if header_cleaned:
                    # Detectar si el modelo intenta generar el siguiente header
                    if "\n#" in accumulated_text or "\n**" in accumulated_text:
                        lines = accumulated_text.split('\n')
                        valid_lines = []
                        stop_generation = False
                        
                        for line in lines:
                            stripped = line.strip()
                            # Si encontramos un header markdown (#) o un título en negrita (**Titulo) que parece un header de siguiente sección
                            # Protegemos que no sea un bold dentro de una lista (e.g. - **Dato**: valor)
                            is_hallucinated_header = False
                            
                            if stripped.startswith('#') and len(stripped) < 80:
                                is_hallucinated_header = True
                            elif stripped.startswith('**') and len(stripped) < 80 and (stripped.endswith('**') or stripped.endswith(':')):
                                # Verificar que no es una lista
                                if not line.strip().startswith('-') and not line.strip().startswith('* '):
                                    is_hallucinated_header = True
                            
                            if is_hallucinated_header:
                                stop_generation = True
                                break
                            valid_lines.append(line)
                        
                        if stop_generation:
                            # Escribir lo válido y salir
                            final_text = '\n'.join(valid_lines)
                            streaming_writer.write_chunk(section_key, final_text)
                            logger.info(f"Stopping generation due to detected header in stream for '{section_key}'")
                            break

                    if len(accumulated_text.split()) >= 5 or "\n" in accumulated_text:
                        if accumulated_text:
                            streaming_writer.write_chunk(section_key, accumulated_text)
                            accumulated_text = ""
        
        # Escribir texto restante
        if accumulated_text.strip():
            streaming_writer.write_chunk(section_key, accumulated_text)
            
        # Asegurar salto de línea al final de la sección
        streaming_writer.write_chunk(section_key, "\n\n")
        
        streaming_writer.mark_section_complete(section_key)
        logger.info(f"[LLM_STREAM] Completada sección '{section_key}'")
        return True
        
    except Exception as e:
        # Logging detallado del error
        error_type = type(e).__name__
        error_msg = str(e)
        logger.error(f"[LLM_STREAM] ERROR en '{section_key}': {error_type}: {error_msg}")
        print(f"[LLM_STREAM] ERROR en '{section_key}': {error_type}")
        print(f"[LLM_STREAM]   Modelo: {model_path}")
        print(f"[LLM_STREAM]   Contenido: {len(content)} chars, Prompt: {len(prompt)} chars")
        print(f"[LLM_STREAM]   Mensaje: {error_msg}")
        
        # Si es error de API, intentar obtener más detalles
        if hasattr(e, 'response'):
            print(f"[LLM_STREAM]   Response status: {getattr(e.response, 'status_code', 'N/A')}")
        if hasattr(e, 'body'):
            print(f"[LLM_STREAM]   Body: {e.body}")
        
        streaming_writer.mark_section_complete(section_key)
        raise


class seccionado(BaseAssembler):
    """Clase para generar informes de alta a partir de hojas de evolución y anamnesis."""
    
    def __init__(self, args):
        super().__init__(args)
        self.logger = logging.getLogger(__name__)
        self.progress_logger = None
    
    def run(self):
        """Ejecuta el proceso de generación del informe de alta."""
        print("\n" + "="*80)
        print("[GENERATION] INICIANDO GENERACIÓN DE INFORME DE ALTA")
        print("="*80 + "\n")
        
        self.logger.info("Starting discharge report generation process.")
        
        # Inicializar logger de progreso
        self.progress_logger = ProgressLogger(self.output_path, self.output_file)
        self.progress_logger.log("🚀 Iniciando generación del informe de alta", "info")
        
        # Iterar sobre cada ingreso
        for ingreso_key in self.ingresos:
            print(f"\n[GENERATION] Procesando ingreso: {ingreso_key}")
            
            ingreso = self.ingresos[ingreso_key]
            
            # Obtener datos de anamnesis y evolución
            anamnesis = ingreso.informes.get('anamnesis')
            evolucion = ingreso.informes.get('evolucion')
            
            # Construir el contenido fuente combinado
            source_content = self._build_source_content(anamnesis, evolucion)
            
            if not source_content:
                print(f"[GENERATION] ⚠ No hay contenido fuente disponible para ingreso {ingreso_key}")
                continue
            
            print(f"[GENERATION] Contenido fuente: {len(source_content)} caracteres")
            
            # Secciones objetivo
            target_keys = list(TARGET_SECTIONS_CONFIG.keys())
            
            # Crear StreamingWriter
            output_file = os.path.join(self.output_path, self.output_file)
            print(f"[GENERATION] Archivo de salida: {output_file}")
            
            streaming_writer = StreamingWriter(output_file, target_keys)
            streaming_writer.open_file()
            
            print(f"\n[GENERATION] Iniciando generación secuencial de {len(target_keys)} secciones...")
            
            for i, target_key in enumerate(target_keys):
                print(f"[GENERATION] Procesando sección {i+1}/{len(target_keys)}: {target_key}")
                # Ejecución secuencial para garantizar streaming token a token
                self._process_section(target_key, source_content, streaming_writer, i)
            
            # Cerrar archivo
            streaming_writer.close_file()
            
            # NOTA: No crear .complete aquí — production.py handle_launcher ya lo crea
            # con el nombre correcto (<token>_anamnesis.complete)
            
            self.progress_logger.log("🎉 Informe de alta generado exitosamente", "success")
            
            # Create .complete file to signal completion
            complete_file_name = self.output_file.replace('.md', '.complete')
            # Fallback if self.output_file doesn't end in .md
            if not complete_file_name.endswith('.complete'):
                complete_file_name = self.output_file + '.complete'
                
            complete_file_path = os.path.join(self.output_path, complete_file_name)
            with open(complete_file_path, 'w') as f:
                f.write('completed')
            print(f"[GENERATION] Creado archivo de finalización: {complete_file_path}")
            
            print("\n" + "="*80)
            print("[GENERATION] GENERACIÓN COMPLETADA")
            print("="*80 + "\n")
    
    def _build_source_content(self, anamnesis, evolucion):
        """Construye el contenido fuente a partir de anamnesis y evolución.
        
        ORDEN DE PROCESAMIENTO:
        1. Primero se procesa la ANAMNESIS (contiene datos de ingreso)
        2. Luego se procesa la EVOLUCIÓN por registros cronológicos
        """
        content_parts = []
        
        # ========== PASO 1: PROCESAR ANAMNESIS PRIMERO ==========
        print("\n" + "─"*60)
        print("[ORDEN] PASO 1: Procesando HOJA DE ANAMNESIS")
        print("─"*60)
        self.progress_logger.log("📋 Paso 1: Procesando Hoja de Anamnesis", "info")
        
        if anamnesis:
            content_parts.append("=== HOJA DE ANAMNESIS ===\n")
            
            # Si anamnesis es una lista de secciones, procesarlas
            if isinstance(anamnesis, list):
                print(f"[ANAMNESIS] Encontradas {len(anamnesis)} secciones")
                self.progress_logger.log(f"   → {len(anamnesis)} secciones encontradas", "info")
                
                for i, seccion in enumerate(anamnesis, 1):
                    if isinstance(seccion, dict):
                        nombre_seccion = seccion.get('seccion', f'Sección {i}')
                        print(f"[ANAMNESIS]   • Sección {i}: {nombre_seccion}")
                        content_parts.append(f"\n### {nombre_seccion}\n")
                        content_parts.append(seccion.get('cuerpo', ''))
                    else:
                        content_parts.append(str(seccion))
            else:
                content_parts.append(str(anamnesis))
            
            content_parts.append("\n")
            print("[ANAMNESIS] ✓ Procesamiento completado")
            self.progress_logger.log("   ✓ Anamnesis procesada correctamente", "success")
        else:
            print("[ANAMNESIS] ⚠ No hay datos de anamnesis disponibles")
            self.progress_logger.log("   ⚠ Sin datos de anamnesis", "warning")
        
        # ========== PASO 2: PROCESAR EVOLUCIÓN POR REGISTROS ==========
        print("\n" + "─"*60)
        print("[ORDEN] PASO 2: Procesando HOJA DE EVOLUCIÓN por registros")
        print("─"*60)
        self.progress_logger.log("📝 Paso 2: Procesando Hoja de Evolución", "info")
        
        if evolucion:
            content_parts.append("\n=== HOJA DE EVOLUCIÓN ===\n")
            
            # Si evolución tiene registros, procesarlos en orden
            if hasattr(evolucion, 'registros') and evolucion.registros:
                registros = evolucion.registros
                print(f"[EVOLUCIÓN] Encontrados {len(registros)} registros")
                self.progress_logger.log(f"   → {len(registros)} registros encontrados", "info")
                
                # Procesar cada registro en orden cronológico
                for i, registro in enumerate(registros, 1):
                    print(f"[EVOLUCIÓN]   • Registro {i}/{len(registros)}")
                    self.progress_logger.log(f"   • Procesando Registro {i}/{len(registros)}", "processing")
                    
                    content_parts.append(f"\n--- REGISTRO {i} ---\n")
                    
                    # Extraer campos del registro si es un objeto
                    if hasattr(registro, '__dict__'):
                        for campo, valor in registro.__dict__.items():
                            if valor and not campo.startswith('_'):
                                content_parts.append(f"**{campo.replace('_', ' ').title()}:** {valor}\n")
                    else:
                        content_parts.append(str(registro))
                    
                    content_parts.append("\n")
                
                print(f"[EVOLUCIÓN] ✓ Todos los registros procesados")
                self.progress_logger.log("   ✓ Todos los registros procesados", "success")
                
            elif isinstance(evolucion, list):
                # Si es una lista de secciones/registros
                print(f"[EVOLUCIÓN] Encontrados {len(evolucion)} items")
                self.progress_logger.log(f"   → {len(evolucion)} items encontrados", "info")
                
                for i, item in enumerate(evolucion, 1):
                    print(f"[EVOLUCIÓN]   • Registro {i}/{len(evolucion)}")
                    self.progress_logger.log(f"   • Procesando Registro {i}/{len(evolucion)}", "processing")
                    
                    content_parts.append(f"\n--- REGISTRO {i} ---\n")
                    if isinstance(item, dict):
                        for k, v in item.items():
                            if v:
                                content_parts.append(f"**{k}:** {v}\n")
                    else:
                        content_parts.append(str(item))
                    content_parts.append("\n")
                
                print(f"[EVOLUCIÓN] ✓ Todos los registros procesados")
                self.progress_logger.log("   ✓ Todos los registros procesados", "success")
            else:
                content_parts.append(str(evolucion))
                print("[EVOLUCIÓN] ✓ Procesamiento completado (formato simple)")
            
            content_parts.append("\n")
        else:
            print("[EVOLUCIÓN] ⚠ No hay datos de evolución disponibles")
            self.progress_logger.log("   ⚠ Sin datos de evolución", "warning")
        
        print("\n" + "─"*60)
        print("[ORDEN] Contenido fuente construido exitosamente")
        print("─"*60 + "\n")
        
        return "\n".join(content_parts) if content_parts else ""
    
    def _process_section(self, target_key, source_content, streaming_writer, delay_seconds):
        """Procesa una sección del informe."""
        thread_name = threading.current_thread().name
        
        # Delay escalonado
        if delay_seconds > 0:
            time.sleep(delay_seconds * 0.5)  # 0.5s entre cada sección
        
        print(f"\n[{thread_name}] Procesando sección '{target_key}'")
        
        try:
            config = TARGET_SECTIONS_CONFIG[target_key]
            section_title = config['title']
            
            self.progress_logger.log(f"📝 Generando: {section_title}", "processing")
            
            # Cargar prompt específico
            prompt = self._load_prompt(config['prompt_file'])
            
            # Generar contenido
            get_model_response_llm_streaming(
                self.client,
                prompt,
                source_content,
                self.model_path,
                target_key,
                section_title,
                streaming_writer,
                self.logger
            )
            
            print(f"[{thread_name}] ✓ Completada sección '{target_key}'")
            
        except Exception as e:
            print(f"[{thread_name}] ✗ ERROR en '{target_key}': {e}")
            import traceback
            traceback.print_exc()
            streaming_writer.mark_section_complete(target_key)
    
    def _load_prompt(self, prompt_file):
        """Carga el prompt desde archivo."""
        try:
            current_dir = os.path.dirname(os.path.abspath(__file__))
            prompts_dir = os.path.join(current_dir, "new_prompts")
            file_path = os.path.join(prompts_dir, prompt_file)
            
            with open(file_path, 'r', encoding='utf-8') as f:
                return f.read()
                
        except Exception as e:
            print(f"[GENERATION] ⚠ Error cargando prompt '{prompt_file}': {e}")
            self.logger.error(f"Error loading prompt {prompt_file}: {e}")
            return "Eres un médico especialista. Genera la sección correspondiente del informe de alta."
