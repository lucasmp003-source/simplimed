import re

from utils.utils import clean_text, remove_personal_data_alta

class ProcessorAlta:
    def __init__(self, args):
        self.text, _ = args
        self.args = None

    def preprocess(self):
        self.__clean()
        self.__divide()

    def get_arguments(self):
        return self.args

    def __clean(self):
        self.text = remove_personal_data_alta(self.text)
        self.text = clean_text(self.text, "Pág")
        self.text = clean_text(self.text, "Page")
        self.text = clean_text(self.text, "Pag")
        self.text = clean_text(self.text, "http")
        self.text = clean_text(self.text, "fdo")
        self.text = clean_text(self.text, "Fdo")

        self.text = self.text.strip()

    def __divide(self):
        txt = self.text.split("Antecedentes")
        motivo = None
        if len(txt) > 1:
            if "Motivo de consulta" in txt[0]:
                string_motivo = "Motivo de consulta"
            else:
                string_motivo = "Motivo de ingreso"

            listado = txt[0].split(string_motivo)
            lista_sin_vacios = list(filter(bool, listado))

            if len(lista_sin_vacios) > 0:
                motivo = lista_sin_vacios[0]

        txt_n = ''
        for i, t in enumerate(txt):
            if i != 0 or len(txt) == 1:
                txt_n += t

        txt = txt_n
        txt = txt.split("Enfermedad Actual")
        antecedentes = txt[0]

        txt_n = ''
        for i, t in enumerate(txt):
            if i != 0 or len(txt) == 1:
                txt_n += t

        txt = txt_n
        txt = txt.split("Pruebas Complementarias")
        enfermedad = txt[0]

        txt_n = ''
        for i, t in enumerate(txt):
            if i != 0 or len(txt) == 1:
                txt_n += t

        txt = txt_n
        txt = txt.split("Juicio Clínico")

        txt_n = ''
        for i, t in enumerate(txt):
            if i != 0 or len(txt) == 1:
                txt_n += t

        evol_in = False
        intervencion_in = False

        pattern = re.compile(r"Evolución y curso Clínico", re.IGNORECASE)

        if re.search(pattern, txt[0]):
            evol_in = True
        if "Intervención Quirúrgica" in txt[0]:
            intervencion_in = True

        txt_evol_pruebas = txt[0]
        intervencion = None
        if intervencion_in:
            txt_aux = txt[0].split("Intervención Quirúrgica / Procedimientos")
            txt_evol_pruebas = txt_aux[0]
            intervencion = ''
            for i, t in enumerate(txt_aux):
                if i != 0:
                    intervencion += t

        evolucion = None
        pruebas_complementarias = txt_evol_pruebas
        if evol_in:
            txt_aux = re.split("Evolución y curso Clínico", txt_evol_pruebas, flags=re.IGNORECASE)
            evolucion = ''
            for i, t in enumerate(txt_aux):
                if i != 0:
                    evolucion += t

            pruebas_complementarias = txt_aux[0]

        txt_aux = pruebas_complementarias.split("Pruebas Complementarias")
        pruebas_complementarias = ''
        for i, t in enumerate(txt_aux):
            if i != 0 or len(txt_aux) == 1:
                pruebas_complementarias += t

        txt = txt_n
        # print(txt)

        txt = txt.split("Tratamiento")
        juicio = txt[0]

        txt_n = ''
        for i, t in enumerate(txt):
            if i != 0 or len(txt) == 1:
                txt_n += t

        txt = txt_n

        plan_in = False
        revisiones_in = False
        if "Plan de Actuación" in txt:
            plan_in = True
        if "Revisiones" in txt:
            revisiones_in = True

        txt_plan_tratamiento = txt
        revisiones = None
        if revisiones_in:
            txt_aux = txt.split("Revisiones")
            txt_plan_tratamiento = txt_aux[0]
            revisiones = ''
            for i, t in enumerate(txt_aux):
                if i != 0:
                    revisiones += t

        actuacion = None
        tratamiento = txt_plan_tratamiento
        if plan_in:
            txt_aux = txt_plan_tratamiento.split("Plan de Actuación")
            actuacion = ''
            for i, t in enumerate(txt_aux):
                if i != 0:
                    actuacion += t

            tratamiento = txt_aux[0]

        txt_aux = tratamiento.split("Tratamiento")
        tratamiento = ''
        for i, t in enumerate(txt_aux):
            if i != 0 or len(txt_aux) == 1:
                tratamiento += t

        self.args = (
        motivo, antecedentes, enfermedad, pruebas_complementarias, evolucion, intervencion, juicio, actuacion,
        tratamiento, revisiones)
