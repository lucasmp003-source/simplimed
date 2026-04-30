from preprocess.altaProcessor import ProcessorAlta
from preprocess.anamensisProcessor import ProcessorAnamnesis
from preprocess.evolucionProcessor import ProcessorEvolucion

class ProcessorFactory:
    @staticmethod
    def create_processor(file_path, document_type):
        processors = {
            'alta': ProcessorAlta,
            'evolucion': ProcessorEvolucion,
            'anamnesis': ProcessorAnamnesis
        }
        if document_type not in processors:
            raise ValueError(f"Document type '{document_type}' not supported")
        
        return processors[document_type](file_path)