import json
import re
import time

class ExtractorAbreviaciones:
    def __init__(self, ruta_modelo, ruta_prompt):
        self.model_path = ruta_modelo
        self.prompt = self._cargar_prompt(ruta_prompt)

    def _cargar_prompt(self, ruta_prompt):
        with open(ruta_prompt, "r", encoding="utf-8") as file:
            return file.read()
    
    def _extraer_listas(self, texto):
        patrones = {
            "formas_abreviadas": re.compile(r'"formas_abreviadas": \[([^\]]+)\]'),
            "simbolos_medicos": re.compile(r'"simbolos_medicos": \[([^\]]+)\]')
        }
        datos = {"formas_abreviadas": [], "simbolos_medicos": []}
        for clave, patron in patrones.items():
            coincidencia = patron.search(texto)
            if coincidencia:
                elementos = [x.strip().strip('"') for x in coincidencia.group(1).split(',')]
                datos[clave] = elementos
        
        return datos

    def extraer_abreviaciones(self, client, texto):
        datos = self.extraer_abreviaciones_simbolos(client, texto)
        return list(set(datos["formas_abreviadas"]) | set(datos["simbolos_medicos"]))
 
    def extraer_abreviaciones_simbolos(self, client, text, temperature=0.0, max_new_tokens=128):
        """
        Extrae abreviaciones y símbolos médicos de un texto usando la API estilo OpenAI.
        
        Args:
            client: Cliente OpenAI ya inicializado
            text (str): El texto a analizar
            temperature (float): Valor de temperatura para la generación
            max_new_tokens (int): Número máximo de tokens a generar
            
        Returns:
            dict: Diccionario con las listas de formas abreviadas y símbolos médicos
        """
        
        # Eliminamos el bucle de intentos múltiples y hacemos un solo intento
        try:
            # Preparar los mensajes
            messages = [
                {"role": "system", "content": self.prompt},
                {"role": "user", "content": text}
            ]

            
            # Realizar la llamada a la API
            response = client.chat.completions.create(
                model=self.model_path,
                messages=messages,
                max_tokens=max_new_tokens,
                temperature=temperature
            )
            
            # Obtener el contenido de la respuesta
            resp = response.choices[0].message.content
            
            # Intentar parsear como JSON
            try:
                resultado = json.loads(resp)
                return resultado
            except json.JSONDecodeError:
                inicio_json = resp.find("{")
                if inicio_json != -1:
                    json_str = resp[inicio_json:]
                    try:
                        resultado = json.loads(json_str)
                        return resultado
                    except json.JSONDecodeError:
                        listas = self._extraer_listas(resp)
                        return listas
                else:
                    return self._extraer_listas(resp)
                    
        except Exception as e:
            print(f"Error en la solicitud: {str(e)}")
            return {"formas_abreviadas": [], "simbolos_medicos": []}