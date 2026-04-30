from utils.utils import remove_personal_data_evolucion, clean_text, get_tables, flatten, remove_none, \
    keep_text_before_keyword
import re


class ProcessorEvolucion:
    def __init__(self, args):
        self.text, self.pdf = args
        self.args = None

    def preprocess(self):
        self.__clean()
        self.__divide()
        # self.args = self.text

    def get_arguments(self):
        return self.args

    def __clean(self):
        #print()
        self.text = remove_personal_data_evolucion(self.text)

        self.text = remove_personal_data_evolucion(self.text)
        self.text = keep_text_before_keyword(self.text, ['Firmantes'])

        self.text = clean_text(self.text, "Pág")
        self.text = clean_text(self.text, "Jaén")
        self.text = clean_text(self.text, "NHC")

    def __divide(self):
        """evoluciones = self.text.split("Evolución:")
        evoluciones = [ev.strip() for ev in evoluciones if ev.strip()]"""
        tables = get_tables(self.pdf)
        # print(tables)

        tables = list(filter(lambda x: x, tables))
        # print(tables)

        # tables = remove_none(tables)

        # print(tables)

        n_pags = len(tables)

        # print(tables)

        palabras_clave_regex = re.compile(r'Evolución:|Juicio Clínico:|Pruebas Complementarias:')
        if n_pags == 1:
            tables = flatten(tables)
            tables = [table for table in tables if table is not None and table != '']
            # print(tables)

            tables = [elemento for elemento in tables if palabras_clave_regex.search(elemento)]


        else:
            for i, table in enumerate(tables):
                tables[i] = flatten(table)
                tables[i] = list(filter(lambda x: x, tables[i]))
                tables[i] = [elemento for elemento in tables[i] if palabras_clave_regex.search(elemento)]
                tables[i] = [n_table for n_table in tables[i] if n_table is not None and n_table != '']

            tables = [item for item in tables if item]


        # print(tables)
        # print(repr(tables[0]))
        # print(tables[1])

        # print("\n\ntables: ")

        # print("N Pags: " + str(n_pags))

        if n_pags == 1:
            tables = [tables]
        # print(n_pags)

        registros = []

        #print(tables)

        for j in range(n_pags):
            if j == n_pags - 1 and len(tables) != n_pags:
                break

            for i, table in enumerate(tables[j]):
                if i != len(tables[j]) - 1 or j == n_pags - 1:
                    registros.append(table)
            # print(j)
            if j != n_pags - 1 and self.__continua(tables[j][-1], j, tables):
                text_continua = self.__getTextFin(tables[j][-1], j, tables)
                registro = tables[j][-1] + text_continua
                registros.append(registro)
            elif j != n_pags - 1:
                registro = tables[j][-1]
                registros.append(registro)

        self.args = registros

    def __continua(self, text_ini, j, tables):
        text_fin = self.__getTextFin(text_ini, j, tables)

        if text_fin is None:
            return False
        else:
            return True

    def __getTextFin(self, text_ini, j, tables):

        # print(tables[j+1])
        if len(tables) == j+1:
            patron = re.compile(f'{re.escape(text_ini)}(.*)', re.DOTALL)
        else:
            text_fin = tables[j + 1][0]
            patron = re.compile(f'{re.escape(text_ini)}(.*?){re.escape(text_fin)}', re.DOTALL)

        match = patron.search(self.text)
        #print(self.text)

        if match:
            texto2 = match.group(1)
            return texto2

        return None


"""
from utils.utils import remove_personal_data_evolucion, clean_text


class ProcessorEvolucion:
    def __init__(self, text):
        self.text = text
        self.args = None

    def preprocess(self):
        self.__clean()
        # self.__divide()
        self.args = self.text

    def get_arguments(self):
        return self.args

    def __clean(self):
        self.text = remove_personal_data_evolucion(self.text)
        self.text = clean_text(self.text, "Pág")
        self.text = clean_text(self.text,"Jaén")


    def __divide(self):
        evoluciones = self.text.split("Evolución:")
        evoluciones = [ev.strip() for ev in evoluciones if ev.strip()]
"""
