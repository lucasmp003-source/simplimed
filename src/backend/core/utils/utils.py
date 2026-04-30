import json
import os
import re
import pdfplumber
import platform
import multiprocessing as mp
import psutil
import subprocess
import pickle
import csv

from openai import OpenAI

SECTION_MAP = {
            'motivo': "Motivo de Ingreso",
            'antecedentes': "Antecedentes",
            'enfermedad': "Enfermedad Actual",
            'pruebas': "Pruebas Complementarias",
            'evolucion': "Evolución y Curso Clínico",
            'intervencion': "Intervención Quirúrgica",
            'juicio': "Juicio Clínico",
            'plan': "Plan de Actuación",
            'tratamiento': "Tratamiento",
            'revisiones': "Revisiones"
        }

def get_relative_path(file_path, project_root=None):
    """
        Genera la ruta relativa de un archivo en base a la ruta del proyecto.

        :param file_path: Ruta absoluta del archivo.
        :param project_root: Ruta del directorio raíz del proyecto. Si es None, se asume el directorio de ejecución.
        :return: Ruta relativa del archivo desde el directorio raíz del proyecto.
    """
    # Obtiene el directorio raíz del proyecto si no se proporciona
    if project_root is None:
        project_root = os.getcwd()  # Obtiene el directorio de ejecución actual
        
    # Calcula la ruta relativa
    project_path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # Ruta absoluta del archivo actual
    relative_path = os.path.relpath(project_path, start=project_root)

    final_path = os.path.join(relative_path, file_path)

    return final_path

def _log_system_info(logger):
    """
    Logs information about the system where the code is being executed.
    """
    logger.info(f"System: {platform.system()}")
    logger.info(f"Node Name: {platform.node()}")
    logger.info(f"Release: {platform.release()}")
    logger.info(f"Version: {platform.version()}")
    logger.info(f"Processor: {platform.processor()}")
    logger.info(f"CPU Count: {mp.cpu_count()}")
    logger.info(f"Total RAM: {psutil.virtual_memory().total / (1024**3):.2f} GB")
    logger.info(f"Available RAM: {psutil.virtual_memory().available / (1024**3):.2f} GB")

    # GPU information
    '''
    try:
        result = subprocess.check_output(
            ['nvidia-smi', '--query-gpu=index,name,memory.total,memory.used,memory.free', '--format=csv,noheader,nounits'],
            encoding='utf-8'
        )
        gpu_info_lines = result.strip().split('\n')
        for line in gpu_info_lines:
            index, name, total_mem, used_mem, free_mem = line.split(',')
            logger.info(f"GPU {index.strip()} ({name.strip()}):")
            logger.info(f"  - Total VRAM: {float(total_mem.strip()):.2f} MB")
            logger.info(f"  - Used VRAM: {float(used_mem.strip()):.2f} MB")
            logger.info(f"  - Available VRAM: {float(free_mem.strip()):.2f} MB")
    except subprocess.CalledProcessError as e:
        logger.error(f"Error occurred while running nvidia-smi: {e}")
    '''

def read_pdf(pdf_file):
    texto = ''
    with pdfplumber.open(pdf_file) as pdf:
        for num_pagina in range(len(pdf.pages)):
            pagina = pdf.pages[num_pagina]

            texto_pag = pagina.extract_text()

            texto += texto_pag

    return texto

def get_tables(pdf_file):
    tables = []
    with pdfplumber.open(pdf_file) as pdf:
        for num_pagina in range(len(pdf.pages)):
            pagina = pdf.pages[num_pagina]

            tables_pag = pagina.extract_tables()
            tables.append(tables_pag)

    return tables

# Pág -> Anamnesis, Evolución, Alta
# NHC -> Anamnesis
# Jaén -> Evolución, Anamnesis
# http -> Alta
# fdo -> Alta
# Page -> Alta


def clean_text(text, substring):
    lines = text.split('\n')
    filtered_lines = [line for line in lines if substring not in line]
    txt = '\n'.join(filtered_lines)
    return txt

def clean_structured_text(structured_text, substrings):
    """
    Limpia el structured_text eliminando líneas que contengan cualquiera de los substrings.
    
    Args:
        structured_text (dict): Diccionario con estructura de PDF
        substrings (list): Lista de substrings a filtrar
        
    Returns:
        dict: Structured_text limpio
    """
    if not structured_text or not substrings:
        return structured_text
    
    # Crear copia de la estructura
    cleaned_structure = {
        "archivo": structured_text["archivo"],
        "total_paginas": structured_text["total_paginas"],
        "metadatos": structured_text["metadatos"],
        "paginas": []
    }
    
    total_lines_removed = 0
    
    # Procesar cada página
    for pagina in structured_text["paginas"]:
        cleaned_page = {
            "pagina": pagina["pagina"],
            "dimensiones": pagina["dimensiones"],
            "lineas": []
        }
        
        # Filtrar líneas que NO contengan ninguno de los substrings
        for linea in pagina["lineas"]:
            texto_completo = linea.get("texto_completo", "")
            
            # Verificar si algún substring está presente (case insensitive)
            contains_substring = any(
                substring.lower() in texto_completo.lower() 
                for substring in substrings
            )
            
            if not contains_substring:
                cleaned_page["lineas"].append(linea)
            else:
                total_lines_removed += 1
        
        cleaned_structure["paginas"].append(cleaned_page)
    
    return cleaned_structure, total_lines_removed


def remove_personal_data_anamnesis(text):
    return remove_personal_data(text, ["Motivo de Consulta"])


def remove_personal_data_evolucion(text):
    return remove_personal_data(text, ["Evolución"])


def remove_personal_data_alta(text):
    return remove_personal_data(text, ["Motivo de consulta", "Motivo de ingreso", "Antecedentes"])


def remove_personal_data(text, substrings):
    lines = text.split('\n')
    ini_index = None

    for i, line in enumerate(lines):
        if any(substring in line for substring in substrings):
            ini_index = i
            break
    if ini_index is not None:
        filtered_lines = lines[ini_index:]
        modified_text = '\n'.join(filtered_lines)
        return modified_text
    else:
        return text


def keep_text_before_keyword(text, substrings):
    lines = text.split('\n')
    end_index = None

    for i, line in enumerate(lines):
        if any(substring in line for substring in substrings):
            end_index = i
            break
    if end_index is not None:
        filtered_lines = lines[:end_index]
        modified_text = '\n'.join(filtered_lines)
        return modified_text
    else:
        return text

def remove_after_page(text):
    lines = text.split('\n')
    filtered_lines = []
    for line in lines:
        if 'Page' in line:
            line = line.split('Page')[0]
        filtered_lines.append(line)
    modified_text = '\n'.join(filtered_lines)
    return modified_text

def get_key(text):
    pattern = r'\b\d+\b'
    key = re.findall(pattern, text)

    if key:
        return int(key[0])
    else:
        return None


def flatten(lst):
    flat_list = []
    for item in lst:
        if isinstance(item, list):
            flat_list.extend(flatten(item))
        else:
            flat_list.append(item)
    return flat_list


def remove_none(lst):
    flat_list = []
    for item in lst:
        if isinstance(item, list):
            flat_list.append(flatten(item))
        elif item is not None and item != '':
            flat_list.append(item)
    return flat_list


def check_string_presence(text, target_string):
    text_lower = text.lower()
    target_lower = target_string.lower()
    return target_lower in text_lower


def procesar_archivos(path, processor_class, container):
    archivos = os.listdir(path)
    for archivo in archivos:
        ruta_completa = os.path.join(path, archivo)
        text = read_pdf(ruta_completa)
        args = (text, ruta_completa)
        processor = processor_class(args)
        processor.preprocess()
        args = processor.get_arguments()
        objeto = container(args)
        key = get_key(archivo)
        yield key, objeto

def get_model_response_llm(client, prompt, content, model_path, section_key, output_file):
    
    response_stream = client.chat.completions.create(
        model=model_path,
        messages=[
            {"role": "system", "content": prompt},
            {"role": "user", "content": content}
        ],
        max_tokens=1024,
        temperature=0.0,
        stream=True
    )

    accumulated_text = ""  # Variable para acumular texto
    with open(output_file, "a", encoding="utf-8") as f:
        f.write(f"\n## {section_key}\n\n")
        
        for chunk in response_stream:
            if chunk.choices[0].delta.content:
                text = chunk.choices[0].delta.content
                accumulated_text += text
                
                # Si ya tenemos 5 palabras o un salto de línea, procesamos
                if len(accumulated_text.split()) >= 5 or "\n" in accumulated_text:
                    # Convertir a minúsculas para comprobar 'simplif' sin importar mayúsculas/minúsculas
                    first_words = accumulated_text.lower().split()[:5]
                    if any("simplif" in word for word in first_words):
                        # Si contiene 'simplif', eliminamos todo hasta el primer salto de línea
                        if "\n" in accumulated_text:
                            accumulated_text = accumulated_text.split("\n", 1)[1]
                        else:
                            accumulated_text = ""  # Si no hay salto de línea, descartamos todo

                    # Si no contiene 'simplif', escribimos lo acumulado
                    if accumulated_text.strip():  # Solo escribimos si no está vacío
                        f.write(accumulated_text)
                        f.flush()  # Escribe inmediatamente
                        accumulated_text = ""  # Reiniciamos la acumulación
                
        # Si el texto final tiene menos de 5 palabras y es el último fragmento, se escribe
        if accumulated_text.strip() and len(accumulated_text.split()) < 5:
            f.write(accumulated_text)
            f.flush()
    
    # Retornar True para indicar que la generación fue exitosa
    return True

def load_json(data):
    return json.loads(data) if data else {}

def get_prompts(output_format, _type, model_name, strategy, reminder=None, secciones=None):
    if _type == "generation":
        return get_prompts_generate(reminder, output_format)
    elif _type == "simplification":
        return get_prompts_simplify(output_format, model_name, strategy, secciones)
    else: 
        raise NotImplementedError

def get_prompts_generate(reminder, output_format):
    apartados = ["Motivo de Ingreso", "Antecedentes", "Enfermedad Actual", "Pruebas Complementarias",
                 "Intervención Quirúrgica, que es distinto de las Pruebas Complementarias,", "Juicio Clínico"]
    datos_proporcionados = ["Se te proporcionarán la sección Motivo de Consulta de la hoja de anamnesis del paciente.",
                            "Se te proporcionarán la sección Antecedentes de la hoja de anamnesis del paciente.",
                            "Se te proporcionarán la sección Enfermedad Actual de la hoja de anamnesis del paciente.",
                            "Se te proporcionarán la hoja de anamnesis junto con ciertos registros de la hoja de evolución del paciente.",
                            "Se te proporcionarán la hoja de anamnesis junto con ciertos registros de la hoja de evolución del paciente.",
                            "Se te proporcionarán la sección la hoja de anamnesis del paciente junto con el último registro de la Hoja de Evolución."]

    prompts = []
    inicio = "Eres experto en generación de informes de alta hospitalaria."
    final_ini = "Deberás generar el apartado"

    if output_format == 'JSON':
        final_fin = "del informe de alta a partir de esta información en formato JSON."

        for i in range(0, 6):
            prompt = f'{inicio} {datos_proporcionados[i]} {final_ini} {apartados[i]} {final_fin} {reminder}'
            prompts.append(prompt)

    elif output_format == 'string':
        final_fin = "del informe de alta a partir de esta información."

        for i in range(0, 6):
            prompt = f'{inicio} {datos_proporcionados[i]} {final_ini} {apartados} {final_fin}'
            prompts.append(prompt)

    return prompts

def get_prompts_simplify(output_format, model, strategy, secciones):
    apartados = ['motivo', 'antecedentes', 'enfermedad', 'pruebas', 'evolucion', 'intervencion', 'juicio', 'plan', 'tratamiento', 'revisiones']

    prompts = {}

    path_prompts = f"tasks/simplification/{model}/prompts/prompts_{strategy}"
    path_prompts = get_relative_path(path_prompts)
     
    if strategy == "seccionado":
        paths = ["prompt_motivo.txt", "prompt_antecedentes.txt", "prompt_EA.txt", "prompt_PC.txt", "prompt_ECC.txt", "prompt_IQ.txt", "prompt_JC.txt", "prompt_PA.txt", "prompt_tratamiento.txt", "prompt_revisiones.txt"]
        for path, ap in zip(paths, apartados):
            with open(os.path.join(path_prompts, path), 'r', encoding='utf-8') as archivo:
                contenido = archivo.read()
            if output_format == 'JSON':
                contenido += '\nTu respuesta debe de ser en formato JSON.'
            prompts[ap] = contenido

        return prompts
    elif strategy == "completo":
        paths = ["prompt_ini.txt", "prompt_fin.txt"]
        with open(os.path.join(path_prompts, paths[0]), 'r', encoding='utf-8') as archivo:
            contenido = archivo.read()

        contenido += '\n'
        for seccion in secciones:
            contenido += f'{SECTION_MAP[seccion]}, '
        
        contenido = contenido[:-2]
        contenido += ".\n\n"

        with open(os.path.join(path_prompts, paths[1]), 'r', encoding='utf-8') as archivo:
            contenido += archivo.read()

        if output_format == 'JSON':
            contenido += '\nTu respuesta debe de ser en formato JSON.'

        return contenido

def convert_section_to_markdown(section):
    """
    Convierte un diccionario de secciones en formato Markdown.
    """

    SECTION_MAP = {
            'motivo': "Motivo de Ingreso",
            'antecedentes': "Antecedentes",
            'enfermedad': "Enfermedad Actual",
            'pruebas': "Pruebas Complementarias",
            'evolucion': "Evolución y Curso Clínico",
            'intervencion': "Intervención Quirúrgica",
            'juicio': "Juicio Clínico",
            'plan': "Plan de Actuación",
            'tratamiento': "Tratamiento",
            'revisiones': "Revisiones"
        }
    

    return SECTION_MAP[section]

def leer_csv_a_diccionario(ruta_archivo):
    """
    Lee un archivo .csv con dos columnas: 'abreviatura' y 'significado', 
    y lo almacena en un diccionario.
    
    Args:
        ruta_archivo (str): Ruta al archivo .csv.
    
    Returns:
        dict: Diccionario con las abreviaturas como claves y sus significados como valores.
    """
    abreviaciones = {}
    with open(ruta_archivo, mode='r', encoding='utf-8') as archivo:
        lector = csv.DictReader(archivo)
        for fila in lector:
            abreviatura = fila['Abreviacion'].strip()
            significado = fila['Definicion'].strip()
            # Solo incluir abreviaturas con al menos 2 letras
            if len(abreviatura) >= 2:
                abreviaciones[abreviatura] = significado

    return abreviaciones

def procesar_texto(texto, abreviaciones):
    """
    Procesa un texto para encontrar las abreviaturas presentes en él 
    y concatenar su significado al final del texto.
    
    Args:
        texto (str): El texto a procesar.
        abreviaciones (dict): Diccionario con abreviaturas y significados.
    
    Returns:
        str: El texto original con las abreviaturas y significados concatenados.
    """
    encontrados = {}

    # Iterar sobre las abreviaturas y buscar todas las coincidencias usando regex
    for abr, sig in abreviaciones.items():
        # Crear un patrón para encontrar la abreviatura con posibles caracteres alrededor
        patron = fr'\b{re.escape(abr)}\b|{re.escape(abr)}(?=[.,;:()])'
        coincidencias = re.findall(patron, texto)
        if coincidencias:
            encontrados[abr] = sig
            
    abreviaciones_encontradas = ""
    if encontrados:
        abreviaciones_encontradas += "\n\nNo confundas artículos o determinantes con abreviaturas. Aquí tienes un conjunto de abreviaturas junto con su signficado que te pueden servir en tu simplificación:\n"
        for abr, sig in encontrados.items():
            abreviaciones_encontradas += f"- {abr}: {sig}\n"
    
    return abreviaciones_encontradas

def get_input_data(base_config):
    yaml_config = base_config.config['yaml-config']
    return yaml_config['paths']['input']['input_data']



def load_processed_files(processed_files_path):
    """Carga el estado de los archivos procesados desde disco."""
    if os.path.exists(processed_files_path):
        try:
            with open(processed_files_path, 'rb') as f:
                return pickle.load(f)
        except Exception as e:
            print(f"Error al cargar los archivos procesados: {e}")
            return {}
    return {}

def save_processed_files(processed_files, processed_files_path):
    """Guarda el estado de los archivos procesados en disco."""
    try:
        with open(processed_files_path, 'wb') as f:
            pickle.dump(processed_files, f)
        print("Estado de los archivos procesados guardado.")
    except Exception as e:
        print(f"Error al guardar los archivos procesados: {e}")


