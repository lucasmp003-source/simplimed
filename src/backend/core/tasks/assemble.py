import os 

from openai import OpenAI
from abc import ABC, abstractmethod

# from utils.pricing import Pricing

class BaseAssembler(ABC):
    """Base class for assembling reports based on various configurations."""
    
    def __init__(self, args):
        """
        Initialize the base assembler with the provided arguments.
        
        Args:
            args (Namespace): A namespace object containing various configuration settings.
        """


        # Extract parameters from args or set to None if not available
        self.ingresos = getattr(args, 'ingresos', None)
        self.api_key = getattr(args, 'api_key', None)
        self.model_type = getattr(args, 'type', None)  # Model type (e.g., 'GPT')
        self.output_format = getattr(args, 'output_format', None)
        self.output_path = getattr(args, 'output_path', None)
        self.results_name = getattr(args, 'results_name', None)
        self.price_flag = getattr(args, 'price', None)
        self.price_config = getattr(args, 'price_config', None)
        self.model_name = getattr(args, 'model_name', None)  # Model name (e.g., 'GPT')
        self.task = getattr(args, 'task', None)  # Specific task to be performed
        self.policy = getattr(args, 'policy', None)  # Policy to be applied
        self.model_path = getattr(args, 'model_path', None)  # Policy to be applied            
        self.abbreviations = getattr(args, 'abbreviations', None)  
        self.input_file = getattr(args, 'input_file', None)        
        self.model = getattr(args, 'model', None)        
        self.tokenizer = getattr(args, 'tokenizer', None)
        self.extractor_medicamento = getattr(args, 'extractor_medicamento', None)   
        self.extractor_abreviaciones = getattr(args, 'extractor_abreviaciones', None)        
        self.buscador_medicamentos = getattr(args, 'buscador_medicamentos', None)        
        self.buscador_abreviaciones = getattr(args, 'buscador_abreviaciones', None)     
        self.output_file = getattr(args, 'output_file', None)     
        self.api_key = getattr(args, 'api_key', None)     
        self.base_url = getattr(args, 'base_url', None)     

        self.output_file = self.output_file.replace('.pdf', '.md')

        # Construct final paths for results and ensure directories exist
        self.final_results_path = self.output_path
        os.makedirs(self.final_results_path, exist_ok=True)
        
        if self.api_key:
            if self.base_url:
                self.client = OpenAI(
                    api_key=self.api_key,
                    base_url=self.base_url
                )
            else:
                self.client = OpenAI(
                    api_key=self.api_key,
                )

        
    @abstractmethod
    def run(self):
        """
        Execute the report assembly process. This method should be implemented 
        by any subclass to define the specific behavior of the report generation.
        """
        pass
