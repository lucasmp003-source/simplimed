import fitz  # PyMuPDF
import json
import logging
from collections import defaultdict
import re


class PDFReader:
    """Clase para leer archivos PDF con diferentes métodos de extracción."""
    
    @staticmethod
    def read_pdf_text(file_path):
        """
        Lee un archivo PDF y extrae solo el texto plano.
        
        Args:
            file_path (str): Ruta al archivo PDF
            
        Returns:
            str: Texto extraído del PDF
            
        Raises:
            FileNotFoundError: Si el archivo no existe
            Exception: Si hay errores al leer el PDF
        """
        try:
            # Abrir el documento PDF
            doc = fitz.open(file_path)
            text = ""
            
            # Extraer texto de todas las páginas
            for page_num in range(len(doc)):
                page = doc.load_page(page_num)
                text += page.get_text()
            
            # Cerrar el documento
            doc.close()
            
            return text
            
        except FileNotFoundError:
            logging.error(f"File not found: {file_path}")
            raise FileNotFoundError(f"PDF file not found: {file_path}")
            
        except Exception as e:
            logging.error(f"Error reading PDF {file_path}: {e}")
            raise Exception(f"Error reading PDF: {str(e)}")
    
    @staticmethod
    def read_pdf_structured(file_path):
        """
        Lee un archivo PDF y extrae información estructurada línea por línea
        con formato, posición y metadatos.
        
        Args:
            file_path (str): Ruta al archivo PDF
            
        Returns:
            dict: Análisis estructurado del PDF con información detallada por línea
        """
        analyzer = PDFLineAnalyzer(file_path)
        
        try:
            analysis = analyzer.analyze_full_document()
            return analysis
        except Exception as e:
            logging.error(f"Error analyzing PDF structure {file_path}: {e}")
            raise Exception(f"Error analyzing PDF structure: {str(e)}")
        finally:
            analyzer.close()


class PDFLineAnalyzer:
    """Analizador detallado de PDFs línea por línea."""
    
    def __init__(self, pdf_path):
        self.pdf_path = pdf_path
        self.doc = fitz.open(pdf_path)
        self.analysis_results = []
    
    def rgb_to_hex(self, rgb_tuple):
        """Convierte RGB a hexadecimal"""
        if not rgb_tuple or len(rgb_tuple) != 3:
            return "#000000"  # Negro por defecto
        return "#{:02x}{:02x}{:02x}".format(
            int(rgb_tuple[0] * 255),
            int(rgb_tuple[1] * 255),
            int(rgb_tuple[2] * 255)
        )
    
    def get_font_flags_description(self, flags):
        """Interpreta las flags de fuente"""
        descriptions = []
        if flags & 2**4:  # Bit 4
            descriptions.append("negrita")
        if flags & 2**1:  # Bit 1
            descriptions.append("cursiva")
        if flags & 2**0:  # Bit 0
            descriptions.append("superíndice")
        if flags & 2**2:  # Bit 2
            descriptions.append("monospace")
        return descriptions if descriptions else ["normal"]
    
    def calculate_indentation(self, x0, page_width):
        """Calcula la sangría como porcentaje del ancho de página"""
        return {
            "pixels": round(x0, 2),
            "porcentaje": round((x0 / page_width) * 100, 2)
        }
    
    def group_spans_into_lines(self, spans):
        """Agrupa spans por líneas basándose en coordenadas Y similares"""
        lines = defaultdict(list)
        tolerance = 2  # Tolerancia para considerar misma línea
        
        for span in spans:
            y_coord = round(span["bbox"][1])  # coordenada y superior
            
            # Buscar línea existente con Y similar
            found_line = None
            for line_y in lines.keys():
                if abs(line_y - y_coord) <= tolerance:
                    found_line = line_y
                    break
            
            if found_line is not None:
                lines[found_line].append(span)
            else:
                lines[y_coord].append(span)
        
        # Ordenar spans dentro de cada línea por coordenada X
        for line_y in lines:
            lines[line_y].sort(key=lambda x: x["bbox"][0])
        
        return dict(lines)
    
    def analyze_page(self, page_num):
        """Analiza una página específica"""
        page = self.doc[page_num]
        page_dict = page.get_text("dict")
        
        page_width = page.rect.width
        page_height = page.rect.height
        
        page_analysis = {
            "pagina": page_num + 1,
            "dimensiones": {
                "ancho": round(page_width, 2),
                "alto": round(page_height, 2)
            },
            "lineas": []
        }
        
        # Extraer todos los spans de texto
        all_spans = []
        for block in page_dict["blocks"]:
            if "lines" in block:  # Es un bloque de texto
                for line in block["lines"]:
                    for span in line["spans"]:
                        span_info = {
                            "texto": span["text"],
                            "bbox": span["bbox"],  # [x0, y0, x1, y1]
                            "fuente": span["font"],
                            "tamaño": round(span["size"], 2),
                            "flags": span["flags"],
                            "color": span.get("color", 0)
                        }
                        if span_info["texto"].strip():  # Solo spans con texto
                            all_spans.append(span_info)
        
        # Agrupar spans por líneas
        lines_dict = self.group_spans_into_lines(all_spans)
        
        # Procesar cada línea
        for line_y in sorted(lines_dict.keys()):
            spans_in_line = lines_dict[line_y]
            
            # Combinar texto de todos los spans en la línea
            full_text = "".join([span["texto"] for span in spans_in_line])
            
            # Información de la primera posición (para sangría)
            first_span = spans_in_line[0]
            x0 = first_span["bbox"][0]
            
            # Análisis de formato (usar el span más representativo)
            main_span = max(spans_in_line, key=lambda x: len(x["texto"]))
            
            line_analysis = {
                "numero_linea": len(page_analysis["lineas"]) + 1,
                "texto_completo": full_text,
                "posicion": {
                    "y_superior": round(line_y, 2),
                    "y_inferior": round(max([s["bbox"][3] for s in spans_in_line]), 2),
                    "x_inicio": round(x0, 2),
                    "x_final": round(max([s["bbox"][2] for s in spans_in_line]), 2)
                },
                "sangria": self.calculate_indentation(x0, page_width),
                "formato_principal": {
                    "fuente": main_span["fuente"],
                    "tamaño": main_span["tamaño"],
                    "color_hex": self.rgb_to_hex(self.int_to_rgb(main_span["color"])),
                    "color_rgb": self.int_to_rgb(main_span["color"]),
                    "estilos": self.get_font_flags_description(main_span["flags"])
                },
                "spans_detallados": []
            }
            
            # Detalles de cada span en la línea
            for i, span in enumerate(spans_in_line):
                span_detail = {
                    "span_numero": i + 1,
                    "texto": span["texto"],
                    "posicion": {
                        "x0": round(span["bbox"][0], 2),
                        "y0": round(span["bbox"][1], 2),
                        "x1": round(span["bbox"][2], 2),
                        "y1": round(span["bbox"][3], 2)
                    },
                    "fuente": span["fuente"],
                    "tamaño": span["tamaño"],
                    "color_hex": self.rgb_to_hex(self.int_to_rgb(span["color"])),
                    "color_rgb": self.int_to_rgb(span["color"]),
                    "estilos": self.get_font_flags_description(span["flags"])
                }
                line_analysis["spans_detallados"].append(span_detail)
            
            # Análisis adicional de la línea
            line_analysis["metadatos"] = {
                "longitud_caracteres": len(full_text),
                "num_palabras": len(full_text.split()),
                "num_spans": len(spans_in_line),
                "tiene_numeros": bool(re.search(r'\d', full_text)),
                "es_mayusculas": full_text.isupper(),
                "espacios_iniciales": len(full_text) - len(full_text.lstrip()),
                "espacios_finales": len(full_text) - len(full_text.rstrip())
            }
            
            page_analysis["lineas"].append(line_analysis)
        
        return page_analysis
    
    def int_to_rgb(self, color_int):
        """Convierte color entero a tupla RGB"""
        if color_int == 0:
            return (0, 0, 0)  # Negro por defecto
        
        # Extraer componentes RGB del entero
        r = (color_int >> 16) & 255
        g = (color_int >> 8) & 255
        b = color_int & 255
        
        # Normalizar a 0-1
        return (r/255.0, g/255.0, b/255.0)
    
    def analyze_full_document(self):
        """Analiza todo el documento"""
        full_analysis = {
            "archivo": self.pdf_path,
            "total_paginas": len(self.doc),
            "metadatos": self.doc.metadata,
            "paginas": []
        }
        
        for page_num in range(len(self.doc)):
            page_analysis = self.analyze_page(page_num)
            full_analysis["paginas"].append(page_analysis)
        
        self.analysis_results = full_analysis
        return full_analysis
    
    def close(self):
        """Cierra el documento PDF"""
        self.doc.close()