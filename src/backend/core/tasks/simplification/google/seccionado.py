import os
import logging
import json
import re
import threading
import time

from datetime import datetime
from tasks.assemble import BaseAssembler
from openai import OpenAI



from utils.utils import get_prompts, convert_section_to_markdown, get_relative_path

# Definición de las nuevas secciones objetivo
TARGET_SECTIONS_CONFIG = {
    'motivo_ingreso': {
        'title': 'Motivo del ingreso',
        'description': 'Motivo del ingreso'
    },
    'problemas_anteriores': {
        'title': 'Problemas de salud anteriores',
        'description': 'Problemas de salud conocidos anteriores al actual ingreso'
    },
    'pruebas_realizadas': {
        'title': 'Pruebas y procedimientos',
        'description': 'Pruebas o procedimientos que se han realizado durante el ingreso'
    },
    'diagnostico_actual': {
        'title': 'Diagnóstico del ingreso',
        'description': 'Diagnóstico del ingreso, es decir, lo que le ha ocurrido ahora'
    },
    'tratamiento_y_pautas': {
        'title': 'Tratamiento y recomendaciones',
        'description': 'Tratamiento y/o qué debe hacer usted a partir de ahora, desde revisiones médicas hasta medicamentos'
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
            print(f"[PROGRESS_LOGGER] Archivo de progreso existente eliminado")
        
        try:
            with open(self.progress_file, 'w', encoding='utf-8') as f:
                f.write('')
            print(f"[PROGRESS_LOGGER] Archivo de progreso creado exitosamente")
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
        """
        Args:
            output_file (str): Ruta del archivo de salida
            section_order (list): Lista ordenada de las claves de sección
        """
        self.output_file = output_file
        self.section_order = section_order
        self.current_section_index = 0
        self.section_buffers = {section: [] for section in section_order}
        self.section_complete = {section: False for section in section_order}
        self.lock = threading.Lock()
        self.file_handle = None
        
        print(f"[STREAMING_WRITER] Inicializado con {len(section_order)} secciones")
        print(f"[STREAMING_WRITER] Orden de secciones: {section_order}")
        
    def open_file(self):
        """Abre el archivo para escritura."""
        print(f"[STREAMING_WRITER] Abriendo archivo: {self.output_file}")
        self.file_handle = open(self.output_file, "a", encoding="utf-8")
        self.file_handle.write(f"\n# Informe de Alta Simplificado generado por IA\n\n")
        self.file_handle.flush()
        print(f"[STREAMING_WRITER] Archivo abierto y header escrito")
    
    def close_file(self):
        """Cierra el archivo."""
        if self.file_handle:
            print(f"[STREAMING_WRITER] Cerrando archivo")
            self.file_handle.close()
    
    def write_chunk(self, section_key, chunk_text):
        """
        Escribe un fragmento de texto para una sección específica.
        La PRIMERA sección escribe INMEDIATAMENTE, las demás esperan su turno.
        
        Args:
            section_key (str): Clave de la sección
            chunk_text (str): Texto a escribir
        """
        with self.lock:
            section_index = self.section_order.index(section_key)
            
            print(f"[STREAMING_WRITER] Recibido chunk de '{section_key}' (index={section_index}, current={self.current_section_index})")
            
            # Si es la sección actual, escribir INMEDIATAMENTE
            if section_index == self.current_section_index:
                print(f"[STREAMING_WRITER] ✓ Escribiendo INMEDIATAMENTE chunk de '{section_key}' ({len(chunk_text)} chars)")
                self.file_handle.write(chunk_text)
                self.file_handle.flush()
                os.fsync(self.file_handle.fileno())
            else:
                # Si no es la sección actual, guardar en buffer
                print(f"[STREAMING_WRITER] → Guardando en buffer chunk de '{section_key}' ({len(chunk_text)} chars)")
                self.section_buffers[section_key].append(chunk_text)
    
    def mark_section_complete(self, section_key):
        """
        Marca una sección como completada y intenta escribir las siguientes.
        
        Args:
            section_key (str): Clave de la sección completada
        """
        with self.lock:
            print(f"[STREAMING_WRITER] Sección '{section_key}' marcada como COMPLETA")
            self.section_complete[section_key] = True
            self._try_flush()
    
    def _try_flush(self):
        """
        Intenta escribir las secciones que están listas en orden.
        Debe ser llamado dentro de un contexto con lock.
        """
        print(f"[STREAMING_WRITER] Intentando flush (current_index={self.current_section_index})")
        
        while self.current_section_index < len(self.section_order):
            current_section = self.section_order[self.current_section_index]
            
            print(f"[STREAMING_WRITER] Verificando sección '{current_section}'...")
            
            # Si hay contenido en el buffer, escribirlo
            if self.section_buffers[current_section]:
                print(f"[STREAMING_WRITER] ✓ Escribiendo buffer de '{current_section}' ({len(self.section_buffers[current_section])} chunks)")
                for chunk in self.section_buffers[current_section]:
                    self.file_handle.write(chunk)
                self.file_handle.flush()
                os.fsync(self.file_handle.fileno())
                
                # Limpiar el buffer
                self.section_buffers[current_section] = []
                print(f"[STREAMING_WRITER] Buffer de '{current_section}' limpiado")
            
            # Si la sección está completa, pasar a la siguiente
            if self.section_complete[current_section]:
                print(f"[STREAMING_WRITER] ✓ Sección '{current_section}' completa, avanzando a la siguiente")
                self.current_section_index += 1
            else:
                # Si no está completa, no podemos avanzar más
                print(f"[STREAMING_WRITER] ⏸ Sección '{current_section}' aún no está completa, esperando...")
                break


def get_model_response_llm_streaming(client, prompt, content, model_path, section_key_original, section_key_spanish, streaming_writer, logger):
    """
    Versión modificada que usa StreamingWriter en lugar de escribir directamente.
    
    Args:
        client: Cliente de OpenAI
        prompt (str): Prompt del sistema
        content (str): Contenido a procesar
        model_path (str): Modelo a usar
        section_key_original (str): Clave original de la sección ('motivo', 'antecedentes', etc.)
        section_key_spanish (str): Nombre en español para el header
        streaming_writer (StreamingWriter): Gestor de escritura
        logger: Logger para debugging
    
    Returns:
        bool: True si fue exitoso
    """
    logger.info(f"[LLM_STREAM] Iniciando generación para '{section_key_original}' ({section_key_spanish})")
    print(f"[LLM_STREAM] Llamando a OpenAI para '{section_key_spanish}'...")
    
    try:
        response_stream = client.chat.completions.create(
            model=model_path,
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": content}
            ],
            max_tokens=2048,
            temperature=0.0,
            stream=True
        )
        
        print(f"[LLM_STREAM] Stream iniciado para '{section_key_spanish}'")

        # Escribir el encabezado de la sección (usar la clave ORIGINAL para el writer)
        header = f"\n## {section_key_spanish}\n\n"
        print(f"[LLM_STREAM] Escribiendo header: {header.strip()}")
        streaming_writer.write_chunk(section_key_original, header)
        
        accumulated_text = ""
        chunk_count = 0
        header_cleaned = False
        
        for chunk in response_stream:
            if chunk.choices[0].delta.content:
                text = chunk.choices[0].delta.content
                accumulated_text += text
                chunk_count += 1
                
                # Header Cleaning Logic (First time only)
                if not header_cleaned:
                    if "\n" in accumulated_text or len(accumulated_text) > 100:
                        # Check first line
                        first_line = accumulated_text.split('\n', 1)[0].strip()
                        if first_line.startswith('#'):
                            print(f"[LLM_STREAM] Eliminando header redundante detectado: '{first_line}'")
                            # Remove the first line
                            if '\n' in accumulated_text:
                                accumulated_text = accumulated_text.split('\n', 1)[1]
                            else:
                                accumulated_text = ""
                        header_cleaned = True
                
                # Proceed only if header is cleaned or buffer is full enough
                if header_cleaned:
                    # Write only if we have enough text or a newline, to avoid writing tiny chunks
                    if len(accumulated_text.split()) >= 5 or "\n" in accumulated_text:
                        if accumulated_text:
                            streaming_writer.write_chunk(section_key_original, accumulated_text)
                            accumulated_text = ""
        
        print(f"[LLM_STREAM] Stream completado para '{section_key_spanish}' ({chunk_count} chunks recibidos)")
        
        # Escribir cualquier texto restante
        if accumulated_text.strip() and len(accumulated_text.split()) < 5:
            print(f"[LLM_STREAM] Escribiendo texto final de '{section_key_spanish}'")
            streaming_writer.write_chunk(section_key_original, accumulated_text)
        
        # Marcar la sección como completa
        print(f"[LLM_STREAM] Marcando '{section_key_original}' como completa")
        streaming_writer.mark_section_complete(section_key_original)
        
        logger.info(f"[LLM_STREAM] Generación exitosa para '{section_key_original}'")
        return True
        
    except Exception as e:
        logger.error(f"[LLM_STREAM] ERROR en '{section_key_original}': {e}")
        print(f"[LLM_STREAM] ERROR en '{section_key_original}': {e}")
        streaming_writer.mark_section_complete(section_key_original)
        raise


class seccionado(BaseAssembler):
    """Class for processing and generating reports based on sections of medical data."""
    
    def __init__(self, args):
        super().__init__(args)
        self.logger = logging.getLogger(__name__)
        self.progress_logger = None
    
    def run(self):
        """
        Runs the process of generating reports, handling each section in parallel.
        """
        print("\n" + "="*80)
        print("[SECCIONADO] INICIANDO GENERACIÓN PARALELA")
        print("="*80 + "\n")
        
        self.logger.info("Starting the parallel report generation process.")
        
        # Inicializar el logger de progreso
        self.progress_logger = ProgressLogger(self.output_path, self.output_file)
        self.progress_logger.log("🚀 Iniciando generación paralela del informe simplificado", "info")
        
        # Get the prompts for the sections
        print("[SECCIONADO] Obteniendo prompts...")
        prompts = get_prompts(self.output_format, self.task, self.model_name, self.policy)
        print(f"[SECCIONADO] Prompts obtenidos: {list(prompts.keys())}")
        
        # Iterate through each "ingreso"
        for ingreso in self.ingresos:
            print(f"\n[SECCIONADO] Procesando ingreso: {ingreso}")
            
            # Retrieve available source section keys/data
            source_sections = self.ingresos[ingreso].informes['alta'].secciones
            source_keys = list(source_sections.keys())

            print(f"[SECCIONADO] Secciones FUENTE encontradas: {source_keys}")
            self.logger.info(f"Targeting 5 new sections using data from {len(source_keys)} source sections")
            
            # Nuevas secciones OBJETIVO
            target_keys = list(TARGET_SECTIONS_CONFIG.keys())
            
            # Crear el StreamingWriter con el orden de las secciones OBJETIVO
            output_file = os.path.join(self.output_path, self.output_file)
            print(f"[SECCIONADO] Archivo de salida: {output_file}")
            
            streaming_writer = StreamingWriter(output_file, target_keys)
            streaming_writer.open_file()
            
            # Lista para almacenar los threads
            threads = []
            
            print(f"\n[SECCIONADO] Lanzando {len(target_keys)} threads con delay escalonado...")
            
            # Lanzar un thread por cada sección OBJETIVO
            for i, target_key in enumerate(target_keys):
                print(f"[SECCIONADO] Lanzando thread {i+1}/{len(target_keys)} para '{target_key}' (delay: {i}s)")
                
                # Crear y lanzar el thread para esta sección
                thread = threading.Thread(
                    target=self._process_section_smart,
                    args=(target_key, source_sections, prompts, streaming_writer, ingreso, i),
                    name=f"Thread-{target_key}"
                )
                thread.start()
                threads.append(thread)
                
                self.logger.info(f"Thread launched for section {target_key} with {i}s delay")
            
            # Esperar a que todos los threads terminen
            print(f"\n[SECCIONADO] Esperando a que completen {len(threads)} threads...")
            for i, thread in enumerate(threads):
                print(f"[SECCIONADO] Esperando thread {i+1}/{len(threads)} ({thread.name})...")
                thread.join()
                print(f"[SECCIONADO] ✓ Thread {i+1}/{len(threads)} completado")
            
            # Cerrar el archivo
            streaming_writer.close_file()
            
            # Finalizar progreso
            self.progress_logger.log(f"🎉 Informe simplificado generado exitosamente", "success")
            self.logger.info(f"All sections completed for ingreso {ingreso}")
            
            # Create .complete file to signal backend
            complete_file_name = self.output_file.replace('.md', '.complete')
            complete_file_path = os.path.join(self.output_path, complete_file_name)
            with open(complete_file_path, 'w') as f:
                f.write('')
            print(f"[SECCIONADO] Creado archivo de finalización: {complete_file_path}")
            
            print("\n" + "="*80)
            print("[SECCIONADO] GENERACIÓN COMPLETADA")
            print("="*80 + "\n")
            import sys
            sys.stdout.flush()
            time.sleep(2)
    

    def _select_sources(self, target_key, target_desc, source_sections, thread_name):
        """
        Selecciona inteligentemente qué secciones fuente son relevantes para la sección objetivo.
        """
        available_sources = list(source_sections.keys())
        
        prompt_selection = f"""
        Eres un asistente médico experto en analizar informes clínicos.
        
        OBJETIVO: Identificar qué secciones del informe original son NECESARIAS para escribir el apartado: "{target_desc}".
        
        SECCIONES DISPONIBLES EN EL INFORME ORIGINAL:
        {', '.join(available_sources)}
        
        Instrucciones:
        1. Analiza qué secciones originales contienen información relevante para el objetivo.
        2. Responde ÚNICAMENTE con una lista JSON de las claves de las secciones seleccionadas.
        3. No incluyas explicaciones.
        4. Si ninguna es relevante (muy improbable), responde [].
        
        Ejemplo de respuesta válida: ["antecedentes", "evolucion"]
        """
        
        try:
            response = self.client.chat.completions.create(
                model=self.model_path,
                messages=[{"role": "user", "content": prompt_selection}],
                temperature=0.0
            )
            content = response.choices[0].message.content.strip()
            # Intento básico de limpieza JSON
            if "```" in content:
                content = content.split("```json")[1].split("```")[0].strip() if "```json" in content else content.split("```")[1].strip()
            
            selected_keys = json.loads(content)
            
            # Filtrar claves que no existen realmente
            valid_keys = [k for k in selected_keys if k in source_sections]
            
            print(f"[{thread_name}] Fuentes seleccionadas para '{target_key}': {valid_keys}")
            return valid_keys
            
        except Exception as e:
            print(f"[{thread_name}] ⚠ Error seleccionando fuentes para '{target_key}': {e}. Usando todas.")
            return available_sources


    def _process_section_smart(self, target_key, source_sections, prompts, streaming_writer, ingreso, delay_seconds):
        """
        Procesa una sección OBJETIVO: selecciona fuentes, agrega contenido y genera.
        """
        thread_name = threading.current_thread().name
        
        # ESPERAR el delay
        if delay_seconds > 0:
            time.sleep(delay_seconds)
        
        print(f"\n[{thread_name}] INICIANDO Smart Processing de '{target_key}'")
        
        try:
            config = TARGET_SECTIONS_CONFIG[target_key]
            section_name_spanish = config['title']
            target_description = config['description']
            
            self.progress_logger.log(f"📝 Procesando nueva sección: {section_name_spanish}", "processing")
            
            # 1. SELECCIÓN DE FUENTES
            # Para motivo_ingreso: selección directa (sin LLM) usando claves de InformeAlta
            if target_key == 'motivo_ingreso':
                motivo_keys = ['motivo', 'enfermedad']  # Claves fijas de InformeAlta
                selected_keys = [k for k in motivo_keys 
                                if k in source_sections and source_sections[k] is not None 
                                and source_sections[k] != "N/A"]
                print(f"[{thread_name}] Fuentes directas para motivo_ingreso: {selected_keys}")
            else:
                # Para el resto: selección inteligente con LLM
                print(f"[{thread_name}] Seleccionando fuentes relevantes...")
                selected_keys = self._select_sources(target_key, target_description, source_sections, thread_name)
            
            # FALLBACK MANUAL: Si la selección falla, buscar por keywords
            if not selected_keys:
                print(f"[{thread_name}] ⚠ Selección vacía. Intentando Fallback por keywords...")
                keywords = []
                if target_key == 'diagnostico_actual':
                    keywords = ['diagnos', 'juicio', 'problem', 'conclusion']
                elif target_key == 'motivo_ingreso':
                    keywords = ['motivo', 'enfermedad', 'actual', 'ingreso']
                elif target_key == 'tratamiento_y_pautas':
                    keywords = ['trata', 'pauta', 'farmaco', 'medic', 'recomend']
                elif target_key == 'problemas_anteriores':
                    keywords = ['anteced', 'historia', 'previo']
                elif target_key == 'pruebas_realizadas':
                    keywords = ['explor', 'rueba', 'complem', 'proced']
                
                if keywords:
                    selected_keys = [k for k in source_sections.keys() if any(kw in k.lower() for kw in keywords)]
                    print(f"[{thread_name}] Fallback Keywords encontró: {selected_keys}")

            if not selected_keys:
                print(f"[{thread_name}] ⚠ Ninguna fuente seleccionada ni siquiera con fallback. Saltando.")
                streaming_writer.write_chunk(target_key, f"\n## {section_name_spanish}\n\n*No se encontró información relevante.*")
                streaming_writer.mark_section_complete(target_key)
                return

            # 2. AGREGACIÓN DE CONTENIDO
            combined_content = ""
            for sk in selected_keys:
                combined_content += f"\n--- INFORMACIÓN DE {sk.upper()} ---\n{source_sections[sk]}\n"
            
            # 3. PROCESAMIENTO (Abreviaciones con regex)
            prompt_extra = ""
            
            if len(combined_content) < 50000: # Límite seguridad
                abreviaciones_encontradas = self.detectar_abreviaciones_regex(combined_content, thread_name)
                
                if abreviaciones_encontradas:
                    prompt_extra += "\nGLOSARIO DE ABREVIACIONES ENCONTRADAS (Úsalo para interpretar el texto, no las copies tal cual):"
                    for abrev, significado in abreviaciones_encontradas.items():
                        prompt_extra += f"\n- {abrev}: {significado}"
                        self.progress_logger.log(f"🔍 Abreviación detectada: {abrev}", "abbreviation")

            # Detección local de medicamentos (solo para tratamiento)
            if target_key == 'tratamiento_y_pautas':
                print(f"[{thread_name}] Detectando medicamentos con regex+fuzzy...")
                medicamentos_encontrados = self.detectar_medicamentos_local(combined_content, thread_name)
                
                if medicamentos_encontrados:
                    prompt_extra += "\n\nGUÍA DE MEDICAMENTOS (Uso terapéutico y principios activos):"
                    prompt_extra += "\nIMPORTANTE: Si un medicamento aparece descrito por su principio activo, pon su nombre comercial entre paréntesis."
                    for nombre_med, info_med in medicamentos_encontrados.items():
                        nombre_llm = info_med['nombre_LLM']
                        pas = ', '.join(info_med['principiosActivos'])
                        uso = info_med['uso_terapeutico'][:150]
                        # Si el nombre encontrado en texto difiere del nombre comercial, mostrar ambos
                        if nombre_med.lower() != nombre_llm.lower():
                            linea = f"\n- {nombre_med} (nombre comercial: {nombre_llm}): Principios activos: {pas}. {uso}"
                        else:
                            linea = f"\n- {nombre_med}: Principios activos: {pas}. {uso}"
                        prompt_extra += linea
                    
                    meds_list = ', '.join(list(medicamentos_encontrados.keys()))
                    self.progress_logger.log(f"💊 Medicamentos detectados: {meds_list}...", "info")
                    print(f"[{thread_name}] Medicamentos detectados: {len(medicamentos_encontrados)}")


            # 4. CONSTRUCCIÓN DEL PROMPT FINAL
            # Cargar el prompt base desde archivo
            base_prompt = self._load_protocol_prompt(target_key)
            
            prompt_final = f"""
            {base_prompt}
            
            {prompt_extra}
            """

            # 5. GENERACIÓN
            print(f"[{thread_name}] Generando respuesta...")
            
            get_model_response_llm_streaming(
                self.client,
                prompt_final,
                combined_content,
                self.model_path,
                target_key,
                section_name_spanish,
                streaming_writer,
                self.logger
            )
            
            # self.progress_logger.log(f"✅ Completada sección: {section_name_spanish}", "success")
            
        except Exception as e:
            print(f"[{thread_name}] ✗ ERROR CRÍTICO en '{target_key}': {e}")
            import traceback
            traceback.print_exc()
            streaming_writer.mark_section_complete(target_key)

    def _process_section(self, section_key, data, prompts, streaming_writer, ingreso, delay_seconds):
        pass # Deprecated in favor of _process_section_smart
            

    def detectar_abreviaciones_regex(self, texto, thread_name):
        """
        Detecta abreviaciones en el texto usando expresiones regulares y las busca
        en el diccionario CSV cargado por buscador_abreviaciones.
        
        Patrones detectados:
        - Palabras en MAYÚSCULAS de 2+ caracteres (HTA, DM, FA, ACV...)
        - Siglas con mezcla mayúscula/minúscula (AINEs, ADOs...)
        - Abreviaciones con puntos (I.V., V.O., a.m. ...)
        
        Args:
            texto (str): Texto completo a analizar
            thread_name (str): Nombre del thread actual para logging
        
        Returns:
            dict: Diccionario {abreviacion: significado} solo con las encontradas en el CSV
        """
        # Patrón regex para detectar candidatas a abreviación
        patron = re.compile(
            r'\b[A-ZÁÉÍÓÚÑ]{2,}[a-záéíóúñs]?\b'   # MAYÚSCULAS 2+ chars, opcionalmente terminadas en minúscula (AINEs)
            r'|\b[A-ZÁÉÍÓÚÑ][a-záéíóúñ]*[A-ZÁÉÍÓÚÑ][a-záéíóúñA-ZÁÉÍÓÚÑ]*\b'  # CamelCase tipo sigla (AgHBs)
            r'|[A-Za-záéíóúñ]\.(?:[A-Za-záéíóúñ]\.)+' # Con puntos (I.V., a.m.)
        )
        
        candidatas = set(patron.findall(texto))
        
        # Filtrar: solo las que existen en el diccionario
        resultado = {}
        for candidata in candidatas:
            sig = self.buscador_abreviaciones.buscar_abreviacion(candidata)
            if sig is not None:
                if isinstance(sig, str):
                    resultado[candidata] = sig
                elif isinstance(sig, list) and len(sig) > 0:
                    # Pasar TODOS los significados para que el LLM elija el correcto en contexto
                    resultado[candidata] = ' / '.join(sig)
        
        print(f"[{thread_name}] Regex detectó {len(candidatas)} candidatas, {len(resultado)} encontradas en diccionario")
        return resultado


    def detectar_medicamentos_local(self, texto, thread_name):
        """
        Detecta medicamentos en texto de tratamiento usando regex + fuzzy matching.
        Sin llamadas a LLM.
        
        Estrategia:
        1. Solo procesa líneas que parecen prescripciones (tienen dosis, o marcadores ** / -)
        2. Extrae nombre antes de dosificación (mg, UI, ml...)
        3. Divide compuestos con / en componentes
        4. Siglas (all caps 2-5 chars) → busca en diccionario abreviaciones
        5. Fuzzy match con score >= 80
        """
        dosage_pattern = re.compile(
            r'\d+[\.,/]?\d*\s*(mg|g|ml|UI|mcg|µg|ug)\b',
            re.IGNORECASE
        )
        # Detecta si la línea original tiene marcadores de prescripción
        prescription_marker = re.compile(r'^\s*[\*]{2}|^\s*[\-]\s+[A-ZÁÉÍÓÚÑ]')
        marker_pattern = re.compile(r'^\s*[\*\-]+\s*')
        
        skip_line_patterns = re.compile(
            r'^\s*$'
            r'|^MEDICACI[ÓO]N'
            r'|^RESTO\s+DE'
            r'|^Dieta\b'
            r'|^Movilizaci[oó]n\b'
            r'|^Ox[ií]geno\b'
            r'|^Tratamiento\s*$'
            r'|^implante\b'
            r'|^comida\b'
            r'|^\d+[\s\-]',
            re.IGNORECASE
        )
        
        # Palabras comunes que NO son medicamentos
        stop_words = {
            'control', 'seguimiento', 'retirada', 'tolerancia', 'cita',
            'empeoramiento', 'desayuno', 'comida', 'cena', 'noche',
            'comprimido', 'comprimidos', 'pastilla', 'pastillas',
            'horas', 'dias', 'diarias', 'diario', 'semanal',
            'sueño', 'descanso', 'reposo', 'andador', 'nasales',
            'gafas', 'marcapasos', 'electrodo', 'implante',
            'edemas', 'disnea', 'astenia', 'ingreso', 'alta',
            'sal', 'litro', 'litros', 'mes', 'dia', 'semana',
            'beber', 'evitar', 'acudir', 'revisar', 'subir',
            'bajar', 'mantener', 'suspender', 'igual', 'resto',
            'acepta', 'acepto', 'suspende', 'suspende al alta',
            'ajustar', 'continuar', 'iniciar', 'retirar',
            'aumentar', 'reducir', 'completar', 'valorar',
            'derivar', 'remitir', 'pautado', 'prescrito',
        }
        
        sigla_pattern = re.compile(r'^[A-ZÁÉÍÓÚÑ]{2,5}$')
        MIN_SCORE = 80
        
        medicamentos_encontrados = {}
        candidatas_vistas = set()
        
        lines = texto.strip().split('\n')
        
        for line in lines:
            line = line.strip()
            if not line:
                continue
            
            # Determinar si la línea parece una prescripción
            has_marker = bool(prescription_marker.match(line))
            has_dose = bool(dosage_pattern.search(line))
            
            # Limpiar marcadores
            clean = marker_pattern.sub('', line).strip()
            clean = re.sub(r'^SUSPENDER\s+', '', clean, flags=re.IGNORECASE).strip()
            
            if not clean or len(clean) < 3:
                continue
            if skip_line_patterns.match(clean):
                continue
            
            # HEURÍSTICA CLAVE: solo procesar líneas que parecen prescripciones
            # Una línea es prescripción si:
            # 1. Tiene marcador (** o - ) Y/O dosificación (mg, UI, ml...)
            # 2. O es una línea corta (1-2 palabras) que podría ser solo un nombre de medicamento
            is_short_name = len(clean.split()) <= 3 and not any(c.isdigit() for c in clean.split()[-1]) if clean.split() else False
            
            if not has_marker and not has_dose and not is_short_name:
                continue  # No parece una prescripción, saltar
            
            # Extraer nombre del medicamento (antes de la dosificación)
            dose_match = dosage_pattern.search(clean)
            if dose_match:
                nombre_raw = clean[:dose_match.start()].strip().rstrip(',').strip()
            else:
                nombre_raw = re.split(
                    r'\bseg[uú]n\b|\bigual\b|\bal menos\b|\bdurante\b|\ben gafas\b|\bun comprimido\b|\bcada\b',
                    clean, flags=re.IGNORECASE
                )[0].strip().rstrip('.').strip()
            
            if not nombre_raw or len(nombre_raw) < 2:
                continue
            
            sub_nombres = [n.strip().rstrip('.').strip() for n in nombre_raw.split('.') if n.strip()]
            
            for nombre in sub_nombres:
                if not nombre or len(nombre) < 2:
                    continue
                
                if len(nombre) > 40 or len(nombre.split()) > 4:
                    continue
                
                if '/' in nombre:
                    partes_nombre = []
                    print(f"[{thread_name}] 🔀 Compuesto detectado: '{nombre}'")
                    for parte in nombre.split('/'):
                        parte = parte.strip()
                        if re.match(r'^\d+[\.,]?\d*\s*(mg|g|ml|UI)?$', parte, re.IGNORECASE):
                            continue
                        parte = re.sub(r'\s+\d+[\.,]?\d*\s*$', '', parte).strip()
                        if parte and len(parte) >= 2:
                            # Expandir siglas dentro del compuesto
                            if sigla_pattern.match(parte):
                                expansion = self.buscador_abreviaciones.buscar_abreviacion(parte)
                                if expansion:
                                    exp_text = expansion[0] if isinstance(expansion, list) else expansion
                                    parte = exp_text.split('.')[0].strip()
                                    print(f"[{thread_name}] 📋 Sigla en compuesto → '{parte}'")
                            partes_nombre.append(parte)
                    
                    print(f"[{thread_name}] 🔀 Partes extraídas: {partes_nombre}")
                    
                    # PRIMERO: buscar compuesto - resolver cada componente a su PA
                    if len(partes_nombre) >= 2:
                        try:
                            from difflib import get_close_matches, SequenceMatcher
                            
                            # Construir índice de nombres base de PA (1ª palabra)
                            pa_index = {}
                            for pa in self.buscador_medicamentos.principios_activos:
                                base = self.buscador_medicamentos.quitar_tildes(pa.split()[0].lower())
                                if base not in pa_index:
                                    pa_index[base] = pa
                            
                            print(f"[{thread_name}] PA index: {len(pa_index)} entries")
                            
                            # Paso 1: Resolver cada componente a su PA canónico
                            pas_resueltos = []
                            todos_resueltos = True
                            for comp in partes_nombre:
                                comp_norm = self.buscador_medicamentos.quitar_tildes(comp.lower().strip())
                                # Coincidencia exacta
                                if comp_norm in pa_index:
                                    pas_resueltos.append(pa_index[comp_norm])
                                    print(f"[{thread_name}] 🔍 '{comp}' → PA: '{pa_index[comp_norm]}' (exacto)")
                                    continue
                                # Búsqueda por similitud de secuencia
                                matches = get_close_matches(comp_norm, pa_index.keys(), n=1, cutoff=0.7)
                                if matches:
                                    ratio = SequenceMatcher(None, comp_norm, matches[0]).ratio()
                                    pas_resueltos.append(pa_index[matches[0]])
                                    print(f"[{thread_name}] 🔍 '{comp}' → PA: '{pa_index[matches[0]]}' (ratio={ratio:.2f})")
                                else:
                                    print(f"[{thread_name}] ❌ '{comp}' sin PA match (norm='{comp_norm}')")
                                    todos_resueltos = False
                                    break
                            
                            print(f"[{thread_name}] PAs resueltos: {pas_resueltos}, todos={todos_resueltos}")
                            
                            # Paso 2: Buscar entradas que contengan TODOS los PAs resueltos
                            if todos_resueltos and len(pas_resueltos) >= 2:
                                n_componentes = len(pas_resueltos)
                                candidatos = []
                                for mid, entry in self.buscador_medicamentos.data_med.items():
                                    entry_pas = {pa.lower() for pa in entry['principiosActivos']}
                                    if len(entry['principiosActivos']) == n_componentes:
                                        if all(pa_r in entry_pas for pa_r in pas_resueltos):
                                            candidatos.append(entry)
                                
                                print(f"[{thread_name}] Candidatos encontrados: {len(candidatos)}")
                                
                                if candidatos:
                                    # Preferir nombres de marca sobre genéricos
                                    pas_lower = set(pas_resueltos)
                                    marca = None
                                    for c in candidatos:
                                        llm = self.buscador_medicamentos.quitar_tildes(c.get('nombre_LLM', '').lower())
                                        if not any(pa in llm for pa in pas_lower):
                                            marca = c
                                            break
                                    
                                    resultado = marca if marca else candidatos[0]
                                    nombre_llm = resultado.get('nombre_LLM', '')
                                    nombre_compuesto = '/'.join(partes_nombre)
                                    print(f"[{thread_name}] Resultado: '{nombre_llm}', compuesto='{nombre_compuesto}', ya_visto={nombre_compuesto.lower() in candidatas_vistas}")
                                    if nombre_llm and nombre_compuesto.lower() not in candidatas_vistas:
                                        candidatas_vistas.add(nombre_compuesto.lower())
                                        medicamentos_encontrados[nombre_compuesto] = resultado
                                        print(f"[{thread_name}] ✅ COMPUESTO '{nombre_compuesto}' → {nombre_llm} (PA: {', '.join(resultado['principiosActivos'])})")
                                        continue
                        except Exception as e:
                            import traceback
                            print(f"[{thread_name}] Búsqueda compuesta falló: {e}")
                            traceback.print_exc()
                        print(f"[{thread_name}] Compuesto no encontrado, buscando componentes...")
                else:
                    partes_nombre = [nombre]
                
                for candidata in partes_nombre:
                    candidata = candidata.strip()
                    if not candidata or len(candidata) < 2:
                        continue
                    
                    candidata_lower = candidata.lower()
                    if candidata_lower in candidatas_vistas:
                        continue
                    candidatas_vistas.add(candidata_lower)
                    
                    # Filtrar stop words
                    if candidata_lower in stop_words:
                        continue
                    
                    # Siglas: buscar expansión primero
                    candidatas_busqueda = []
                    es_sigla = sigla_pattern.match(candidata)
                    
                    if es_sigla:
                        expansion = self.buscador_abreviaciones.buscar_abreviacion(candidata)
                        if expansion:
                            exp_text = expansion[0] if isinstance(expansion, list) else expansion
                            exp_text = exp_text.split('.')[0].strip()
                            candidatas_busqueda.append(exp_text)
                            print(f"[{thread_name}] 📋 Sigla '{candidata}' → expandida a '{exp_text}'")
                        else:
                            continue
                    else:
                        candidatas_busqueda.append(candidata)
                    
                    for busqueda in candidatas_busqueda:
                        try:
                            match_result, _ = self.buscador_medicamentos.buscar_medicamento(busqueda)
                            
                            if not match_result or match_result.get('score', 0) < MIN_SCORE:
                                continue
                            
                            score = match_result['score']
                            ids = match_result.get('ids', [])
                            if not ids:
                                continue
                            
                            resultado = self.buscador_medicamentos.mejor_coincidencia([busqueda.lower()])
                            
                            if resultado is None:
                                first_id = ids[0] if isinstance(ids, list) else ids
                                resultado = self.buscador_medicamentos.data_med.get(first_id)
                            
                            if resultado:
                                nombre_llm = resultado.get('nombre_LLM', '')
                                if nombre_llm and nombre_llm.lower() not in [m.get('nombre_LLM', '').lower() for m in medicamentos_encontrados.values()]:
                                    medicamentos_encontrados[candidata] = resultado
                                    print(f"[{thread_name}] ✅ '{candidata}' → {nombre_llm} (score={score})")
                            break
                        except Exception as e:
                            print(f"[{thread_name}] Error buscando medicamento '{busqueda}': {e}")
        
        print(f"[{thread_name}] Detectados {len(medicamentos_encontrados)} medicamentos")
        return medicamentos_encontrados

    
    def _load_protocol_prompt(self, target_key):
        """Carga el prompt específico para el protocolo médico desde archivo."""
        try:
            # Construir ruta: tasks/simplification/llama/prompts/prompts_seccionado_protoclo_medico/<key>.txt
            # Asumimos que la estructura es fija desde utils.get_relative_path o similar
            
            # Nota: self.model_path suele ser la ruta del modelo o nombre, aqui hardcodeamos la ruta relativa de prompts
            # base_path = "tasks/simplification/llama/prompts/prompts_seccionado_protoclo_medico"
            # Pero mejor usaria get_relative_path si pudiera, o os.path.join
            
            # file_path = get_relative_path(os.path.join(base_path, f"{target_key}.txt"))
            
            # Dado que estamos en seccionado.py, podemos asumir la ruta relativa desde el root del proyecto
            # o construirla relativa a este archivo.
            # Este archivo esta en src/backend/core/tasks/simplification/llama/seccionado.py
            
            current_dir = os.path.dirname(os.path.abspath(__file__))
            prompts_dir = os.path.join(current_dir, "prompts", "prompts_seccionado_protoclo_medico")
            file_path = os.path.join(prompts_dir, f"{target_key}.txt")
            
            with open(file_path, 'r', encoding='utf-8') as f:
                return f.read()
                
        except Exception as e:
            print(f"[SECCIONADO] ⚠ Error cargando prompt para '{target_key}': {e}")
            self.logger.error(f"Error loading prompt for {target_key}: {e}")
            # Fallback a un prompt genérico
            return f"Actúa como un médico y resume la sección {target_key} para el paciente."


    def _get_section_name_spanish(self, section_key):
        """Convierte la clave de sección al nombre en español."""
        if section_key in TARGET_SECTIONS_CONFIG:
            return TARGET_SECTIONS_CONFIG[section_key]['title']
        
        # Fallback por si acaso
        section_names = {
            'motivo': 'Motivo de Ingreso',
            'antecedentes': 'Antecedentes',
            'enfermedad': 'Enfermedad Actual',
            'pruebas': 'Pruebas Complementarias',
            'evolucion': 'Evolución Clínica',
            'intervencion': 'Intervención Quirúrgica',
            'juicio': 'Juicio Clínico',
            'plan': 'Plan de Actuación',
            'tratamiento': 'Tratamiento al Alta',
            'revisiones': 'Revisiones'
        }
        return section_names.get(section_key, section_key.title())