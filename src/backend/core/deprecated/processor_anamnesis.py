from data_structures.Anamnesis import Antecedentes
from utils.utils import clean_text, remove_personal_data_anamnesis


class ProcessorAnamnesis:
    def __init__(self, args):
        self.text, _ = args
        self.args = None

    def preprocess(self):
        self.__clean()
        self.__divide()

    def get_arguments(self):
        return self.args

    def __clean(self):
        self.text = remove_personal_data_anamnesis(self.text)
        self.text = clean_text(self.text, "Pág")
        self.text = clean_text(self.text, "Jaén")
        self.text = clean_text(self.text, "NHC")

    def __divide(self):
        self.text = self.text.strip()
        text_ini = self.text.split("Motivo de Consulta")
        text_ini = text_ini[-1].split("Antecedentes")
        motivo = text_ini[0]

        # print("\n\nText" + self.text)
        # print("Motivo: " + motivo + "\n\n")

        text = ''
        for i, t in enumerate(text_ini):
            if i != 0:
                text += t

        text = text.split("Enfermedad Actual")
        # print(text)
        antecedentes = text[0]

        text_n = ''
        for i, t in enumerate(text):
            if i != 0:
                text_n += t
        text = text_n

        plan = None
        if len(text.split("Plan de Actuación")) > 1:
            text = text.split("Plan de Actuación")
            plan = text[1]
            text = text[0]

        # print(text)
        text = text.split("Juicio Clínico")
        juicio = text[1]
        text = text[0]

        com = False
        expl = False
        pruebas_complementarias = None
        exploracion = None
        enfermedad = None

        if "Exploración" in text:
            expl = True

        if "Pruebas Complementarias" in text:
            com = True

        if not com and not expl:
            enfermedad = text

        if com:
            text = text.split("Pruebas Complementarias")
            pruebas_complementarias = text[-1]
            text = text[0]
            if not expl:
                enfermedad = text

        if expl:
            text = text.split("Exploración")
            enfermedad = text[0]
            text_n = ''
            for i, t in enumerate(text):
                if i != 0:
                    text_n += t
            text = text_n
            exploracion = text

        familiares = None

        text_ant = antecedentes.split("Familiares")

        if len(text_ant) > 1:
            familiares = text_ant[1]

        personales = text_ant[0]

        antecedentes_object = Antecedentes((personales, familiares))
        self.args = (motivo, antecedentes_object, enfermedad, exploracion, pruebas_complementarias, juicio, plan)
