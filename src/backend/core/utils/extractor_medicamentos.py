import json
import re

class ExtractorMedicamentos:
    def __init__(self, ruta_modelo, ruta_prompt):
        self.model_path = ruta_modelo
        self.prompt = self.cargar_prompt(ruta_prompt)        
    
    def cargar_prompt(self, ruta_prompt):
        with open(ruta_prompt, "r", encoding="utf-8") as file:
            return file.read()
    
    def extraer_listas(self, texto):
        patrones = {
            "medicamentos": re.compile(r'"medicamentos": \[([^\]]+)\]'),
            "principios_activos": re.compile(r'"principios_activos": \[([^\]]+)\]')
        }
        datos = {"medicamentos": [], "principios_activos": []}
        for clave, patron in patrones.items():
            coincidencia = patron.search(texto)
            if coincidencia:
                elementos = [x.strip().strip('"') for x in coincidencia.group(1).split(',')]
                datos[clave] = elementos
        return datos
    
    def extraer_medicamentos(self, client, texto):
        datos = self.extraer_medicamentos_listas(client, texto)

        # Obtener medicamentos y principios activos combinados en un set
        elementos = set(datos["medicamentos"]) | set(datos["principios_activos"])

        # Dividir cada elemento por '/', limpiar espacios y eliminar vacíos
        resultado = [parte.strip() for elemento in elementos for parte in elemento.lower().split("/") if parte.strip()]

        return list(set(resultado))  # Devolver lista sin duplicados
 
    
    def extraer_medicamentos_listas(self, client, text, temperature=0.0, max_new_tokens=128):
        """
        Extrae medicamentos y genera listas a partir de un texto usando la API estilo OpenAI.
        
        Args:
            texto (str): El texto a analizar
            temperature (float): Valor de temperatura para la generación
            max_new_tokens (int): Número máximo de tokens a generar
            
        Returns:
            dict: Diccionario con las listas de medicamentos extraídos
        """
        
        # Asumiendo que tienes configurados estos atributos en tu clase
        
        try:
            response = client.chat.completions.create(
                model=self.model_path,
                messages=[
                    {"role": "system", "content": self.prompt},
                    {"role": "user", "content": text}
                ],
                max_tokens=max_new_tokens,
                temperature=temperature
            )
            
            # Obtener el contenido de la respuesta
            resp = response.choices[0].message.content
            
            try:
                return json.loads(resp)
            except json.JSONDecodeError:
                return self.extraer_listas(resp)
        except Exception as e:
            print(f"Error al procesar la solicitud: {str(e)}")
            return {}  # O un valor por defecto apropiado