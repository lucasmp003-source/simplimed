import json
import re

from rapidfuzz import process, fuzz


class BuscadorMedicamentos:
    def __init__(self, ruta_medicamentos):
        self.data_med = self._cargar_medicamentos(ruta_medicamentos)
        self.medicamentos, self.index_medicamentos, self.principios_activos, self.index_pactivos = self._indexar_medicamentos()

    def quitar_tildes(self, texto):
        # Diccionario de reemplazo de vocales con tilde por su versión sin tilde
        reemplazos = {
            'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u',
            'Á': 'A', 'É': 'E', 'Í': 'I', 'Ó': 'O', 'Ú': 'U'
        }
        
        # Expresión regular para encontrar vocales acentuadas
        patron = re.compile('|'.join(reemplazos.keys()))
        
        # Reemplazar cada coincidencia con su versión sin tilde
        return patron.sub(lambda m: reemplazos[m.group()], texto)
    
    def _cargar_medicamentos(self, ruta_medicamentos):
        with open(ruta_medicamentos, "r", encoding="utf-8") as file:
            return json.load(file)

    def _indexar_medicamentos(self):
        index_medicamentos = {med: datos["nombre_LLM"].lower() for med, datos in self.data_med.items()}
        
        index_pactivos = {}
        for med, datos in self.data_med.items():
            for pa in datos["principiosActivos"]:
                pa_lower = pa.lower()
                index_pactivos.setdefault(pa_lower, []).append(med)
        
        medicamentos = list(index_medicamentos.values())
        principios_activos = list(index_pactivos.keys())
        
        return medicamentos, index_medicamentos, principios_activos, index_pactivos

    def buscar_medicamento(self, nombre):
        nombre = self.quitar_tildes(nombre.lower())
        result = process.extractOne(nombre, self.medicamentos, scorer=fuzz.ratio)
        score = 0
        if result is not None:
            mejor_match, score, _ = result
            indice_match = next((med for med, nombre_llm in self.index_medicamentos.items() if nombre_llm == mejor_match), None)
            mejor_resultado = {"tipo": "medicamento", "ids": [indice_match], "score": score}

        mejor_match_pactivos, score_pactivos, _ = process.extractOne(nombre, self.principios_activos, scorer=fuzz.WRatio)
        if score_pactivos + 10 >= mejor_resultado["score"]:
            mejor_resultado = {"tipo": "principio_activo", "ids": self.index_pactivos[mejor_match_pactivos], "score": score_pactivos}
        
        return mejor_resultado, nombre

    def buscar_medicamentos_lista(self, nombres_lista):
        ids_comunes = None
        for nombre in nombres_lista:
            resultado, nombre_ini = self.buscar_medicamento(nombre)
            is_in = False

            for med, nombre_llm in self.index_medicamentos.items():
                if nombre_ini in self.quitar_tildes(nombre_llm): is_in = True

            if not resultado or (resultado["score"] < 70 and not is_in): return None
                
            ids_actuales = resultado["ids"] if isinstance(resultado["ids"], list) else []
            ids_comunes = list(set(ids_comunes) & set(ids_actuales)) if ids_comunes is not None else list(ids_actuales)
        
        # for id in ids_comunes: print(self.data_med[id])
        return ids_comunes if ids_comunes else set()

    def mejor_coincidencia(self, nombres_medicamentos):
        
        resultado = self.buscar_medicamentos_lista(nombres_medicamentos)
        if not resultado: return None
        best_score, best_match, indice_match = 0, None, None
        
        if len(resultado) > 1:
            medicamentos_encontrados = [self.data_med[res]["nombre_LLM"] for res in resultado if len(self.data_med[res]["principiosActivos"]) == len(nombres_medicamentos)]
            
            for nombre in nombres_medicamentos:
                result = process.extractOne(nombre, medicamentos_encontrados, scorer=fuzz.WRatio)
                score = 0
                if result:
                    mejor_match, score, _ = result

                if best_score < score:
                    best_score, best_match = score, mejor_match
            
            if best_match:
                indice_match = next((med for med, nombre_llm in self.index_medicamentos.items() if nombre_llm == best_match.lower()), None)
            else: return None
        else:
            indice_match = resultado[0]
        
        return self.data_med[indice_match] if indice_match else None