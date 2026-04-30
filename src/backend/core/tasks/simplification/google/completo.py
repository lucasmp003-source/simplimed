import json
import os
import torch
import gc

from tqdm import tqdm
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

from utils.utils import convert_to_html, get_model_response_llm
from tasks.assemble import Base_Assembler

class completo(Base_Assembler):
    def __init__(self, args):
        super().__init__(args)

        self.texto_inicial = ("Eres especialista en simplificación de informes de alta de cardiología. "
                              "Tu tarea es simplificar el siguiente informe para hacerlo más fácil de entender para personas mayores. "
                              "Por favor, proporciona una respuesta clara y concisa que conserve el significado original de cada oración, "
                              "eliminando cualquier complejidad o jerga innecesaria. Además, deberás explicar la terminología médica, "
                              "especialmente la relacionada con cardiología. Ten en cuenta que tu respuesta debe ser lo suficientemente flexible "
                              "como para permitir varias simplificaciones relevantes y creativas, siempre y cuando transmitan con precisión el "
                              "significado previsto. El informe de alta tiene los siguientes apartados: ")
        self.texto_final = ("\nPor favor, simplifica este informe de alta y devuelve la simplificación: ")

        torch_dtype = torch.bfloat16
        quant_storage_dtype = torch.bfloat16
        bnb_config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_use_double_quant=True,
            bnb_4bit_quant_type="nf4",
            nb_4bit_compute_dtype=torch_dtype,
            bnb_4bit_quant_storage=quant_storage_dtype,
        )

        llama_model_path = '/mnt/beegfs/sinai-data/llama3-70b-instruct'
        llama_model_tokenizer = '/mnt/beegfs/sinai-data/llama3-70b-instruct'
        
        self.model_name = self.model
        print("Cargando modelo")
        self.model = AutoModelForCausalLM.from_pretrained(llama_model_path, quantization_config=bnb_config)  # Cambiar por la ruta real del modelo LLaMA 2
        self.tokenizer = AutoTokenizer.from_pretrained(llama_model_tokenizer)  # Cambiar por la ruta real del tokenizador LLaMA 2
        print("Modelo cargado")

    def run(self):
        output_second_path = f'simplification_{self.results_name}_{self.model_name}'
        final_path = os.path.join(self.output_path, self.task, output_second_path)
        print(final_path)

        altas_txt_path = os.path.join(final_path, 'simplificacion_txt')
        if not os.path.exists(altas_txt_path):
            os.makedirs(altas_txt_path)

        print(altas_txt_path)

        for ingreso in tqdm(self.ingresos):

            apartados = self.ingresos[ingreso].get_apartados()
            prompt = self.texto_inicial + apartados + self.texto_final
            content = self.ingresos[ingreso].getOutput()

            resp = get_model_response_llm(self.model, self.tokenizer, prompt, content, self.output_format, self.model_name)
            
            resp = json.dumps(resp, indent=4, ensure_ascii=False)
            resp = json.loads(resp)

            print(resp[-1])
            resp = resp[-1]["content"]

            file_path = os.path.join(altas_txt_path, f'{ingreso}_simplificado.txt')
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(resp)

            # Libera memoria de PyTorch y Python
            del resp
            torch.cuda.empty_cache()  # Si usas GPU
            gc.collect()  # Garbage collection



