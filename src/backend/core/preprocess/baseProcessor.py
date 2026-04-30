from abc import ABC, abstractmethod
import logging
# from preprocess.pdf_reader import PDFReader
from preprocess.pdf_reader import PDFReader

from typing import final


class BaseProcessor(ABC):
    """Clase base abstracta para todos los procesadores de documentos PDF."""
    
    def __init__(self, file_path):
        """
        Inicializa el procesador base.
        
        Args:
            file_path (str): Ruta al archivo PDF a procesar
        """
        self.file_path = file_path
        self.text = None
        self.structured_text = None
        self.cleaned_structured_text = None
        self.args = None
    
    @final
    def process(self):
        """
        Método template que orquesta todo el flujo de procesamiento.
        Define el orden de ejecución: leer -> limpiar -> dividir -> validar
        """
        try:
            self._read_pdf()
            self._clean()
            self._extract_sections()
            self._validate_result()
        except Exception as e:
            logging.error(f"Error processing file {self.file_path}: {e}")
            raise
    
    def get_sections(self):
        """
        Retorna los argumentos procesados.
        
        Returns:
            tuple: Tupla con las secciones extraídas del documento
        """
        return self.args
    
    def _read_pdf(self):
        """Lee el contenido del archivo PDF."""
        try:
            self.text = PDFReader.read_pdf_text(self.file_path)
            self.structured_text = PDFReader.read_pdf_structured(self.file_path)
            if not self.text or not self.text.strip():
                raise ValueError("PDF appears to be empty or could not extract text")
        except Exception as e:
            logging.error(f"Failed to read PDF {self.file_path}: {e}")
            raise
    
    @abstractmethod
    def _clean(self):
        """
        Método abstracto para aplicar limpieza específica al texto.
        Cada procesador específico debe implementar su propia lógica de limpieza.
        """
        pass
    
    @abstractmethod
    def _extract_sections(self):
        """
        Método abstracto para dividir el texto en secciones específicas.
        Cada procesador específico debe implementar su propia lógica de división.
        """
        pass
    
    def _validate_result(self):
        """
        Validación básica del resultado.
        Cada procesador específico puede sobrescribir para validaciones adicionales.
        """
        if self.args is None:
            logging.warning(f"No arguments extracted from {self.file_path}")
        
        # Validación básica: verificar que sea una tupla
        if self.args is not None and not isinstance(self.args, tuple):
            logging.warning(f"Arguments should be a tuple, got {type(self.args)}")


