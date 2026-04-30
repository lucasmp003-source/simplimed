from preprocess.baseProcessor import BaseProcessor
import logging
import json
# from utils.utils import clean_structured_text

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



class ProcessorEvolucion(BaseProcessor):
    """Procesador específico para documentos de alta hospitalaria."""
    
    def __init__(self, file_path):
        """
        Inicializa el procesador de alta.
        
        Args:
            file_path (str): Ruta al archivo PDF de alta
        """
        super().__init__(file_path)
        
    def _clean(self):
        """
        Implementa la limpieza específica para documentos de alta.
        1. Busca "procedencia" y elimina todo lo que esté arriba
        2. Encuentra el x_inicio más común y elimina líneas que estén fuera del rango (más o menos)
        3. Para líneas con múltiples spans, mantiene solo el span más cercano a la derecha
        """

        if not self.structured_text:
            logging.error(f"No structured text available for {self.file_path}")
            return
        
        try:
            # Crear una copia del structured_text para modificar
            cleaned_structured_text = {
                "archivo": self.structured_text["archivo"],
                "total_paginas": self.structured_text["total_paginas"],
                "metadatos": self.structured_text["metadatos"],
                "paginas": []
            }
            
            # Copiar páginas inicialmente
            for pagina in self.structured_text["paginas"]:
                cleaned_page = {
                    "pagina": pagina["pagina"],
                    "dimensiones": pagina["dimensiones"],
                    "lineas": pagina["lineas"].copy()  # Copia inicial de todas las líneas
                }
                cleaned_structured_text["paginas"].append(cleaned_page)
            
            # Actualizar el structured_text con la copia inicial
            self.structured_text = cleaned_structured_text
            
            # ========== NUEVA FUNCIONALIDAD: Filtro por PROCEDENCIA ==========
            
            # Crear una lista global de todas las líneas con su posición original
            all_lines_with_position = []
            
            for page_idx, pagina in enumerate(self.structured_text["paginas"]):
                for line_idx, linea in enumerate(pagina["lineas"]):
                    all_lines_with_position.append({
                        "linea": linea,
                        "page_idx": page_idx,
                        "line_idx": line_idx,
                        "global_idx": len(all_lines_with_position),
                        "texto": linea.get("texto_completo", "").lower()
                    })
            
            # Buscar "procedencia" en todas las líneas
            procedencia_idx = None
            for i, line_info in enumerate(all_lines_with_position):
                if "procedencia" in line_info["texto"]:
                    procedencia_idx = i
                    logging.info(f"Encontrada línea con 'procedencia' en posición global {i}: '{line_info['linea'].get('texto_completo', '')[:50]}...'")
                    break
            
            if procedencia_idx is None:
                error_msg = f"No se encontró la palabra 'procedencia' en el documento {self.file_path}"
                logging.error(error_msg)
                raise ValueError(error_msg)
            
            # Eliminar todo por encima de procedencia
            lines_removed_by_cut = 0
            
            # Crear nueva estructura sin las líneas que están por encima del corte
            filtered_pages = []
            global_line_counter = 0
            
            for page_idx, pagina in enumerate(self.structured_text["paginas"]):
                filtered_page = {
                    "pagina": pagina["pagina"],
                    "dimensiones": pagina["dimensiones"],
                    "lineas": []
                }
                
                for line_idx, linea in enumerate(pagina["lineas"]):
                    if global_line_counter >= procedencia_idx:
                        # Mantener esta línea
                        filtered_page["lineas"].append(linea)
                    else:
                        # Eliminar esta línea
                        lines_removed_by_cut += 1
                        logging.debug(f"Eliminando línea por corte procedencia: '{linea.get('texto_completo', '')[:50]}...'")
                    
                    global_line_counter += 1
                
                # Solo añadir páginas que tengan líneas restantes
                if filtered_page["lineas"]:
                    filtered_page["total_lineas_restantes"] = len(filtered_page["lineas"])
                    filtered_pages.append(filtered_page)
            
            # Actualizar la estructura
            self.structured_text["paginas"] = filtered_pages
            logging.info(f"Eliminadas {lines_removed_by_cut} líneas por corte procedencia")
            
            # ========== FIN BÚSQUEDA PROCEDENCIA ==========
            
            # ========== MANEJO DE SPANS: Mantener el span más cercano a la derecha ==========
            
            lines_processed_spans = 0
            
            for pagina in self.structured_text["paginas"]:
                for linea in pagina["lineas"]:
                    spans_detallados = linea.get("spans_detallados", [])
                    
                    if len(spans_detallados) > 1:
                        # Encontrar el span con mayor x_inicio (más a la derecha)
                        span_mas_derecha = None
                        max_x_inicio = float('-inf')
                        
                        for span in spans_detallados:
                            x_inicio_span = span.get("posicion", {}).get("x0", 0)
                            if x_inicio_span > max_x_inicio:
                                max_x_inicio = x_inicio_span
                                span_mas_derecha = span
                        
                        if span_mas_derecha:
                            # Reemplazar spans_detallados con solo el span más a la derecha
                            linea["spans_detallados"] = [span_mas_derecha]
                            # Actualizar el texto_completo con el texto del span seleccionado
                            linea["texto_completo"] = span_mas_derecha.get("texto", "")
                            # IMPORTANTE: Actualizar la posición de la línea mapeando desde el span
                            span_posicion = span_mas_derecha.get("posicion", {})
                            if span_posicion:
                                linea["posicion"].update({
                                    "x_inicio": span_posicion.get("x0", linea["posicion"].get("x_inicio", 0)),
                                    "x_final": span_posicion.get("x1", linea["posicion"].get("x_final", 0)),
                                    "y_superior": span_posicion.get("y0", linea["posicion"].get("y_superior", 0)),
                                    "y_inferior": span_posicion.get("y1", linea["posicion"].get("y_inferior", 0))
                                })
                            # NUEVO: Actualizar también el estilo de la línea con el estilo del span seleccionado
                            span_estilo = span_mas_derecha.get("estilos", {})
                            if span_estilo:
                                linea["formato_principal"]["estilos"] = span_estilo.copy()

                            
                            lines_processed_spans += 1
                            logging.debug(f"Línea con múltiples spans procesada, mantenido span más derecha: '{linea['texto_completo'][:50]}...'")
            
            logging.info(f"Procesadas {lines_processed_spans} líneas con múltiples spans, mantenido el span más a la derecha")
                        
            # ========== FIN MANEJO DE SPANS ==========
            
            # ========== NUEVA FUNCIONALIDAD: Filtro por x_inicio_comun (MAS Y MENOS) ==========
            
            # Recopilar todos los valores de x_inicio de las líneas restantes
            all_x_inicio_values = []
            tolerance = 8.0  # Tolerancia para agrupar x_inicio similares
            
            for pagina in self.structured_text["paginas"]:
                for linea in pagina["lineas"]:
                    x_inicio = linea.get("posicion", {}).get("x_inicio")
                    if x_inicio is not None:
                        all_x_inicio_values.append(x_inicio)
            
            if not all_x_inicio_values:
                logging.warning(f"No se encontraron valores x_inicio para {self.file_path}")
            else:
                # Agrupar valores similares usando tolerancia
                grouped_x_values = {}
                
                for x_val in all_x_inicio_values:
                    # Buscar si ya existe un grupo similar
                    found_group = None
                    for group_key in grouped_x_values.keys():
                        if abs(x_val - group_key) <= tolerance:
                            found_group = group_key
                            break
                    
                    if found_group is not None:
                        grouped_x_values[found_group].append(x_val)
                    else:
                        grouped_x_values[x_val] = [x_val]
                
                # Encontrar el grupo más común (x_inicio_comun)
                most_common_group = max(grouped_x_values.items(), key=lambda item: len(item[1]))
                x_inicio_comun = most_common_group[0]  # Usar la clave del grupo como referencia
                frequency = len(most_common_group[1])
                
                logging.info(f"x_inicio_comun encontrado: {x_inicio_comun:.2f} (frecuencia: {frequency})")
                
                # Segunda limpieza: Eliminar líneas cuyo x_inicio esté FUERA del rango (más Y menos)
                lines_removed_count = 0
                
                for pagina in self.structured_text["paginas"]:
                    filtered_lines = []
                    
                    for linea in pagina["lineas"]:
                        x_inicio = linea.get("posicion", {}).get("x_inicio", 0)
                        
                        # Mantener líneas cuyo x_inicio esté dentro del rango común (con tolerancia)
                        if abs(x_inicio - x_inicio_comun) <= tolerance:
                            filtered_lines.append(linea)
                        else:
                            lines_removed_count += 1
                            logging.debug(f"Eliminando línea por x_inicio fuera de rango: '{linea.get('texto_completo', '')[:50]}...' (x_inicio: {x_inicio:.2f}, diferencia: {abs(x_inicio - x_inicio_comun):.2f})")
                    
                    # Actualizar las líneas de la página
                    pagina["lineas"] = filtered_lines
                    pagina["total_lineas_restantes"] = len(filtered_lines)
                
                logging.info(f"Eliminadas {lines_removed_count} líneas por x_inicio fuera del rango común (±{tolerance} de {x_inicio_comun:.2f})")
            
            # ========== FIN NUEVA FUNCIONALIDAD x_inicio ==========
            
            # Opcional: También limpiar el texto plano eliminando líneas correspondientes
            if self.text:
                # Reconstruir el texto plano con las líneas que quedaron
                clean_text_lines = []
                for pagina in self.structured_text["paginas"]:
                    for linea in pagina["lineas"]:
                        if linea.get("texto_completo"):
                            clean_text_lines.append(linea["texto_completo"])
                
                self.text = "\n".join(clean_text_lines)
            
            logging.info(f"Final cleaning completed for {self.file_path}")
            
        except Exception as e:
            logging.error(f"Error cleaning structured text for {self.file_path}: {e}")
            # En caso de error, mantener el texto original
            pass

        # Limpieza por substrings (código original)
        substrings_to_remove = ["Pág", "Page", "Pag", "http", "fdo", "Fdo", "Jaén, a"]
        self.cleaned_structured_text, lines_removed = clean_structured_text(self.structured_text, substrings_to_remove)

            
    
    def _join_from_index(self, text_list, start_index):
        """
        Utility method para unir elementos de una lista desde un índice específico.
        
        Args:
            text_list (list): Lista de strings
            start_index (int): Índice desde donde empezar a unir
            
        Returns:
            str: String unido
        """
        if len(text_list) <= start_index:
            return ""
        
        result = ""
        for i, t in enumerate(text_list):
            if i >= start_index:
                result += t
        
        return result
    
    
    def _validate_result(self):
        """
        Validación específica para la hoja ed evolucion.
        """
        super()._validate_result()
        
    def _extract_sections(self):
        """
        Extrae secciones en negrita del structured_text para documentos de evolución.
        Cada sección comienza con texto en negrita y continúa hasta la siguiente negrita.
        Si hay secciones con el mismo nombre, se numeran secuencialmente (ej: Exploración_1, Exploración_2).
        
        Returns:
            list: Lista de diccionarios con formato:
                {'seccion': str, 'cuerpo': str, 'numero_seccion': int}
        """
        if not hasattr(self, 'cleaned_structured_text') or not self.cleaned_structured_text or "paginas" not in self.cleaned_structured_text:
            logging.warning(f"No cleaned structured text available for section extraction in {self.file_path}")
            return []
        
        sections = []
        current_section = None
        current_body_lines = []
        section_counters = {}  # Para llevar el conteo de secciones con el mismo nombre
        
        # Crear una lista global de todas las líneas
        all_lines = []
        for pagina in self.cleaned_structured_text["paginas"]:
            for linea in pagina["lineas"]:
                all_lines.append(linea)

        def get_bold_info(linea):
            """
            Extrae información sobre texto en negrita de una línea.
            Returns: (is_bold, bold_text)
            """
            texto_completo = linea.get("texto_completo", "").strip()
            spans_detallados = linea.get("spans_detallados", [])
            
            # Verificar el formato principal de la línea
            formato_principal = linea.get("formato_principal", {})
            estilos_principales = formato_principal.get("estilos", [])
            
            if "negrita" in estilos_principales:
                return True, texto_completo
            
            # Si no es negrita en formato principal, verificar spans detallados
            bold_text = ""
            has_bold = False
            
            if spans_detallados:
                for span in spans_detallados:
                    estilos_span = span.get("estilos", [])
                    if "negrita" in estilos_span:
                        has_bold = True
                        bold_text += span.get("texto", "")
                
                if has_bold:
                    return True, bold_text.strip()
            
            # Criterios heurísticos para detectar posibles títulos/secciones
            if not spans_detallados and texto_completo:
                if (len(texto_completo) < 50 and 
                    (texto_completo.isupper() or 
                    texto_completo.endswith(':') or
                    all(word[0].isupper() for word in texto_completo.split() if word))):
                    return True, texto_completo
            
            return False, ""
        
        def normalize_section_name(name):
            """
            Normaliza el nombre de la sección eliminando tildes y sustituyendo espacios por guiones bajos.
            
            Args:
                name (str): Nombre original de la sección
                
            Returns:
                str: Nombre normalizado
            """
            # Diccionario para eliminar tildes
            tildes_map = {
                'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u',
                'Á': 'A', 'É': 'E', 'Í': 'I', 'Ó': 'O', 'Ú': 'U',
                'ñ': 'n', 'Ñ': 'N'
            }
            
            # Eliminar tildes
            normalized = name
            for tilde, normal in tildes_map.items():
                normalized = normalized.replace(tilde, normal)
            
            # Sustituir espacios por guiones bajos
            normalized = normalized.replace(' ', '_')
            
            return normalized
        
        def save_current_section():
            """Guarda la sección actual en la estructura de datos."""
            nonlocal current_section, current_body_lines, sections
            
            if current_section is not None:
                current_section['cuerpo'] = '\n'.join(current_body_lines).strip()
                sections.append(current_section)
                current_section = None
                current_body_lines = []
        
        # Procesar todas las líneas
        for i, linea in enumerate(all_lines):
            texto_completo = linea.get("texto_completo", "").strip()
            is_bold, bold_text = get_bold_info(linea)
            
            if is_bold and bold_text.strip():
                # Guardar sección anterior antes de crear nueva
                save_current_section()
                
                # Procesar el nombre de la sección
                section_name = bold_text.strip()
                
                # Limpiar el nombre de la sección (remover ':' al final si existe)
                if section_name.endswith(':'):
                    section_name = section_name[:-1].strip()
                
                # Normalizar el nombre (eliminar tildes y espacios)
                normalized_section_name = normalize_section_name(section_name)
                
                # Contar secciones con el mismo nombre normalizado
                if normalized_section_name in section_counters:
                    section_counters[normalized_section_name] += 1
                else:
                    section_counters[normalized_section_name] = 1
                
                # Crear nombre único con contador
                unique_section_name = f"{normalized_section_name}_{section_counters[normalized_section_name]}"
                
                # Crear nueva sección
                current_section = {
                    'seccion': unique_section_name.strip().rstrip(":").strip(),
                    'cuerpo': '',
                    'numero_seccion': section_counters[normalized_section_name],
                    'nombre_original': section_name
                }
                current_body_lines = []
                
                logging.debug(f"Nueva sección encontrada: '{unique_section_name}' (original: '{section_name}')")
                
            elif texto_completo:
                # Agregar línea al cuerpo de la sección actual
                if current_section is not None:
                    current_body_lines.append(texto_completo)
        
        # No olvidar la última sección
        save_current_section()
        
        # Guardar las secciones como atributo de la instancia
        self.sections = sections
        logging.info(f"Extracted {len(sections)} sections from {self.file_path}")
        
        # Log resumen de secciones encontradas
        section_summary = {}
        for section in sections:
            original_name = section['nombre_original']
            if original_name in section_summary:
                section_summary[original_name] += 1
            else:
                section_summary[original_name] = 1
        
        logging.info(f"Section summary: {section_summary}")

        self.args = sections
        
        return sections

    def get_arguments(self):
        """
        Devuelve los argumentos en formato compatible con HojaEvolucion.
        Convierte las secciones extraídas en registros cronológicos.
        
        Returns:
            list: Lista de registros para HojaEvolucion
        """
        if not hasattr(self, 'sections') or self.sections is None:
            self._extract_sections()
        
        # Para evolución, agrupamos las secciones por registro cronológico
        # Usamos el patrón de secciones repetidas para identificar registros
        registros = []
        current_registro = {
            'evolucion': None,
            'juicio_clinico': None,
            'exploracion': None,
            'pruebas_complementarias': None,
            'plan_actuacion': None
        }
        
        for section in self.sections:
            seccion_name = section.get('seccion', '').lower()
            cuerpo = section.get('cuerpo', '')
            numero = section.get('numero_seccion', 1)
            
            # Mapear secciones a campos del registro
            if 'evolucion' in seccion_name or 'evolución' in seccion_name:
                # Nuevo registro empieza con cada evolución
                if numero > 1 and current_registro['evolucion']:
                    registros.append(current_registro.copy())
                    current_registro = {
                        'evolucion': None,
                        'juicio_clinico': None,
                        'exploracion': None,
                        'pruebas_complementarias': None,
                        'plan_actuacion': None
                    }
                current_registro['evolucion'] = cuerpo
            elif 'juicio' in seccion_name or 'diagnos' in seccion_name:
                current_registro['juicio_clinico'] = cuerpo
            elif 'explora' in seccion_name:
                current_registro['exploracion'] = cuerpo
            elif 'prueba' in seccion_name or 'complementar' in seccion_name:
                current_registro['pruebas_complementarias'] = cuerpo
            elif 'plan' in seccion_name or 'actuacion' in seccion_name:
                current_registro['plan_actuacion'] = cuerpo
        
        # Añadir el último registro
        if current_registro['evolucion'] or current_registro['juicio_clinico']:
            registros.append(current_registro)
        
        # Si no hay registros estructurados, devolver secciones como texto
        if not registros:
            registros = self.sections
        
        return registros

    def print_sections(self):
        """
        Imprime las secciones extraídas en formato legible.
        """
        if not hasattr(self, 'sections') or not self.sections:
            sections = self._extract_sections()
        else:
            sections = self.sections
        
        if not sections:
            print(f"No se encontraron secciones en negrita en {self.file_path}")
            return
        
        print(f"\n{self.file_path}")
        print(f"Se encontraron {len(sections)} secciones:")
        print("=" * 80)
        
        for i, section in enumerate(sections, 1):
            print(f"\nSECCIÓN {i}: {section['seccion']}")
            print(f"Nombre original: {section['nombre_original']}")
            print(f"Número de repetición: {section['numero_seccion']}")
            print("-" * 60)
            
            if section['cuerpo'].strip():
                print(f"CUERPO:")
                print(section['cuerpo'])
            else:
                print("(Sin contenido)")
            
            print("=" * 80)

    def get_sections_summary(self):
        """
        Obtiene un resumen de la estructura de secciones encontradas.
        
        Returns:
            dict: Resumen con estadísticas de las secciones
        """
        if not hasattr(self, 'sections') or not self.sections:
            sections = self._extract_sections()
        else:
            sections = self.sections
        
        total_sections = len(sections)
        unique_section_names = set(s['nombre_original'] for s in sections)
        
        # Contar repeticiones por nombre
        section_counts = {}
        for section in sections:
            original_name = section['nombre_original']
            if original_name in section_counts:
                section_counts[original_name] += 1
            else:
                section_counts[original_name] = 1
        
        summary = {
            'total_sections': total_sections,
            'unique_section_names': len(unique_section_names),
            'file_path': self.file_path,
            'section_counts': section_counts,
            'sections_with_repetitions': {k: v for k, v in section_counts.items() if v > 1},
            'section_details': []
        }
        
        for section in sections:
            section_detail = {
                'name': section['seccion'],
                'original_name': section['nombre_original'],
                'repetition_number': section['numero_seccion'],
                'has_body': bool(section['cuerpo'].strip()),
                'body_length': len(section['cuerpo'])
            }
            summary['section_details'].append(section_detail)
        
        return summary
        