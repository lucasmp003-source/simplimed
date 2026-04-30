import os
import importlib.util
import logging
import torch

from datetime import datetime
from types import SimpleNamespace
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from utils.extractor_medicamentos import ExtractorMedicamentos
from utils.extractor_abreviaciones import ExtractorAbreviaciones
from utils.buscador_medicamentos import BuscadorMedicamentos
from utils.buscador_abreviaciones import BuscadorAbreviaciones

from data_structures.Informe_Alta import InformeAlta
from preprocess.altaProcessor import ProcessorAlta
from utils.utils import procesar_archivos, _log_system_info, read_pdf, get_relative_path, leer_csv_a_diccionario
from data_structures.Ingreso import Ingreso


class Builder:
    def __init__(self, baseconfig):
        # Accessing yaml-config
        yaml_config = baseconfig.config['yaml-config']

        self.input_paths = yaml_config['paths']['input']
        self.output_paths = yaml_config['paths']['output']
        self.model_config = yaml_config['model']

        self.input_file_folder = self.input_paths['input_data']
        self.output_file_folder = self.output_paths['results_name']

        self.abbreviations_path = self.input_paths['abreviaciones']
        self.medicamentos_path = self.input_paths['medicamentos']

        self.extractor_abreviaciones_path = self.input_paths['extractor_abreviaciones']
        self.extractor_medicamentos_path = self.input_paths['extractor_medicamentos']
        self.prompt_medicamentos = self.input_paths['prompt_finetunning_medicamentos']
        self.prompt_abreviaciones = self.input_paths['prompt_finetunnig_abreviaciones']

        '''self.extractor_abreviaciones_path = None
        self.extractor_medicamentos_path = None
        self.prompt_medicamentos = None
        self.prompt_abreviaciones = None'''

        # Accessing locals-model-config
        self.local_models_config = baseconfig.config.get('models-paths', None)
        self.model_name = self.model_config.get('name')
        self.model_type = self.model_config.get('type')

        model_path = self.local_models_config[self.model_name][self.model_type]


        # Accessing runtime-config
        runtime_config = baseconfig.config['runtime-config']
        self.task = runtime_config['task']


        if self.task == "full_report": raise NotImplementedError
        # Generation task is now supported


        self.abbreviations_path = self.input_paths['abreviaciones']
        self.medicamentos_path = self.input_paths['medicamentos']

        '''self.abbreviations_path = None
        self.medicamentos_path = None'''


        self.extractor_medicamento = ExtractorMedicamentos(self.extractor_medicamentos_path, self.prompt_medicamentos)
        self.extractor_abreviaciones = ExtractorAbreviaciones(self.extractor_abreviaciones_path, self.prompt_abreviaciones)

        self.buscador_medicamentos = BuscadorMedicamentos(self.medicamentos_path)
        self.buscador_abreviaciones = BuscadorAbreviaciones(self.abbreviations_path)

        '''self.extractor_medicamento = None
        self.extractor_abreviaciones = None

        self.buscador_medicamentos = None
        self.buscador_abreviaciones = None'''

        self.extractor_abreviaciones_path = self.input_paths['extractor_abreviaciones']
        self.extractor_medicamentos_path = self.input_paths['extractor_medicamentos']
        self.prompt_medicamentos = self.input_paths['prompt_finetunning_medicamentos']
        self.prompt_abreviaciones = self.input_paths['prompt_finetunnig_abreviaciones']

        '''self.extractor_abreviaciones_path = None
        self.extractor_medicamentos_path = None
        self.prompt_medicamentos = None
        self.prompt_abreviaciones = None'''

        print("loging")
        self.setup_logging()
        self.logger = logging.getLogger(__name__)
        self.logger.info("Builder initialized successfully.")



        self.model = model_path
        self.logger.info("Model loaded succesfully...")
        print("sucesful init")


    def setup_logging(self):
        """Set up logging configuration."""

        default_log = "log/"
        default_log = get_relative_path(default_log)

        if not os.path.exists(default_log):
            os.makedirs(default_log)

        now = datetime.now()
        curr_time = now.strftime("%Y%m%d%H%M%S%f")

        self.filename_log = f"{curr_time}.log"
        self.folder_log = default_log

        logging.basicConfig(
            filename=f"{self.folder_log}/{self.filename_log}",
            format='%(asctime)s - %(levelname)s - %(name)s -   %(message)s',
            datefmt='%m/%d/%Y %H:%M:%S',
            filemode='a',
            level=logging.INFO
        )

    def build(self, input_file):
        _log_system_info(self.logger)
        logging.info("Building started")

        self.output_file = input_file

        if self.task == "simplification":
            try:
                input_file_path = os.path.join(self.input_file_folder, input_file)

                # Procesar el archivo de informe de alta
                logging.info(f"Processing Informe Alta file: {input_file}")
                informe_alta = self.process_file(input_file_path, 'alta', InformeAlta)
                
                # Crear el modelo ensamblado con ingresos, sin anamnesis ni evolucion
                ingresos = {1: Ingreso((None, None, informe_alta))}

                # Llamar a create_assemble pasándole el diccionario args
                return self.create_assemble(ingresos, input_file)
            
            except Exception as e:
                logging.error(f"Error during build process: {e}")
                raise
        
        elif self.task == "generation":
            try:
                # Para generation, buscamos pares de archivos anamnesis + evolucion
                # El nombre del archivo base tiene el formato: generated_<id>_anamnesis.pdf o generated_<id>_evolution.pdf
                logging.info(f"Processing file for generation: {input_file}")
                print(f"\n[BUILDER] Procesando generación desde: {input_file}")
                
                from data_structures.Anamnesis import HojaAnamnesis
                from data_structures.Hoja_Evolucion import HojaEvolucion
                
                # Determinar el basename para buscar el par de archivos
                base_name = input_file.replace('_anamnesis.pdf', '').replace('_evolution.pdf', '')
                
                anamnesis_file = os.path.join(self.input_file_folder, f"{base_name}_anamnesis.pdf")
                evolution_file = os.path.join(self.input_file_folder, f"{base_name}_evolution.pdf")
                
                print(f"[BUILDER] Archivo anamnesis: {anamnesis_file}")
                print(f"[BUILDER] Archivo evolución: {evolution_file}")
                
                anamnesis = None
                evolucion = None
                
                # Procesar anamnesis si existe
                if os.path.exists(anamnesis_file):
                    print(f"[BUILDER] ✓ Procesando ANAMNESIS...")
                    logging.info(f"Processing anamnesis file: {anamnesis_file}")
                    try:
                        anamnesis = self.process_file(anamnesis_file, 'anamnesis', HojaAnamnesis)
                        print(f"[BUILDER]   Anamnesis procesada correctamente")
                    except Exception as e:
                        logging.warning(f"Error processing anamnesis: {e}")
                        print(f"[BUILDER]   ⚠ Error en anamnesis: {e}")
                else:
                    print(f"[BUILDER] ⚠ No se encontró archivo de anamnesis")
                
                # Procesar evolución si existe
                if os.path.exists(evolution_file):
                    print(f"[BUILDER] ✓ Procesando EVOLUCIÓN...")
                    logging.info(f"Processing evolution file: {evolution_file}")
                    try:
                        evolucion = self.process_file(evolution_file, 'evolucion', HojaEvolucion)
                        print(f"[BUILDER]   Evolución procesada correctamente")
                    except Exception as e:
                        logging.warning(f"Error processing evolution: {e}")
                        print(f"[BUILDER]   ⚠ Error en evolución: {e}")
                else:
                    print(f"[BUILDER] ⚠ No se encontró archivo de evolución")
                
                # Verificar que al menos uno de los dos documentos existe
                if anamnesis is None and evolucion is None:
                    raise ValueError("No se pudo procesar ni anamnesis ni evolución")
                
                # Crear el ingreso con anamnesis y evolución
                ingresos = {1: Ingreso((anamnesis, evolucion, None))}
                print(f"[BUILDER] Ingreso creado: anamnesis={'✓' if anamnesis else '✗'}, evolución={'✓' if evolucion else '✗'}")

                # Llamar a create_assemble para generar el informe
                # Usar el nombre base para el archivo de salida
                self.output_file = f"{base_name}.md"
                return self.create_assemble(ingresos, input_file)
            
            except Exception as e:
                logging.error(f"Error during generation build process: {e}")
                raise
        
        else:
            raise ValueError(f"Unknown task '{self.task}'. Supported: 'simplification', 'generation'.")

    def process_file(self, file_path, document_type, container):
    # Factory crea el procesador desde preprocess/
        from preprocess.processor_factory import ProcessorFactory

        
        processor = ProcessorFactory.create_processor(file_path, document_type)
        processor.process()  # Maneja todo internamente
        args = processor.get_arguments()
        
        return container(args)

    def create_assemble(self, informe_alta, input_file):
        """Assemble the final model with configuration settings."""
        logging.info("Creating assemble process started")

        print(f"[BUILDER] Creating assemble process started for file {input_file}")
        model_name = self.model_config.get('name')
        model_type = self.model_config.get('type')
        model_policy = self.model_config.get('policy')

        # abbreviations = leer_csv_a_diccionario(self.abbreviations_path)
        abbreviations = None

        # Construct the args as a SimpleNamespace
        args = SimpleNamespace(
            ingresos=informe_alta,
            api_key=self.model_config.get('api_key'),
            base_url=self.model_config.get('base_url'),
            type=model_type,
            model_name=model_name,
            output_format=self.model_config.get('output_format'),
            task=self.task,
            output_path=self.output_file_folder,
            output_file=self.output_file,
            model_path=self.local_models_config[model_name][model_type],
            policy=model_policy,
            abbreviations=abbreviations,
            input_file=input_file,
            model=self.model,
            extractor_medicamento=self.extractor_medicamento,
            extractor_abreviaciones=self.extractor_abreviaciones,
            buscador_abreviaciones=self.buscador_abreviaciones,
            buscador_medicamentos=self.buscador_medicamentos,
        )

        policy = self.model_config['policy']
        mod = f'tasks/{self.task}/'
        mod += f'{model_name}/'

        module = get_relative_path(mod + policy)

        try:
            logging.info("Start creating assemble process")
            logging.info(module)

            spec = importlib.util.spec_from_file_location("my_module",  module + '.py')
            module = importlib.util.module_from_spec(spec)

            spec.loader.exec_module(module)


            _class = getattr(module, policy)

            model = _class(args)
            logging.info("Creating assemble process finished successfully")

            return model
        except Exception as e:
            logging.error(f"Error creating assemble: {e}")
            raise
