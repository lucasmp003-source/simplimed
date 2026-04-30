import csv


class BuscadorAbreviaciones:
    def __init__(self, ruta_siglas):
        self.diccionario_siglas = self._cargar_siglas(ruta_siglas)

    def _cargar_siglas(self, ruta_siglas):
        diccionario = {}

        with open(ruta_siglas, encoding="utf-8") as archivo:
            lector = csv.reader(archivo)
            next(lector)  # Saltar la primera fila (encabezados)

            for fila in lector:
                sigla, definicion = fila
                if sigla in diccionario:
                    diccionario[sigla].append(definicion)  # Agregar a la lista si ya existe
                else:
                    diccionario[sigla] = [definicion]  # Crear una nueva lista si no existe
        return diccionario

    def buscar_abreviacion(self, sigla):
        """Busca una sigla en el diccionario y devuelve sus definiciones."""
        return self.diccionario_siglas.get(sigla, None)