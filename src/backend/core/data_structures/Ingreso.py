class Ingreso:
    def __init__(self, args):
        self.anamnesis, self.evolucion, self.alta = args

        self.informes = {
            'anamnesis': self.anamnesis,
            'evolucion': self.evolucion,
            'alta': self.alta
        }

        self.apto = False
        if self.evolucion and self.anamnesis:
            self.apto = True

    def __str__(self):
        anamnesis_str = self.informes['anamnesis'] if self.informes['anamnesis'] is not None else "N/A"
        evolucion_str = self.informes['evolucion'] if self.informes['evolucion'] is not None else "N/A"
        return f"Hoja de Anamnesis: {anamnesis_str}\nHoja de Evolución: {evolucion_str}\nInforme de Alta: {self.informes['alta']}"

    def __getitem__(self, index):
        return self.informes[index]

    def __setitem__(self, index, value):
        self.informes[index] = value

    def __delitem__(self, index):
        del self.informes[index]

    def getInput(self):
        anamnesis_str = self.informes['anamnesis'] if self.informes['anamnesis'] is not None else "N/A"
        evolucion_str = self.informes['evolucion'] if self.informes['evolucion'] is not None else "N/A"
        return f"Hoja de Anamnesis: {anamnesis_str}\nHoja de Evolución: {evolucion_str}"

    def getOutput(self):
        return f"Informe de Alta: {self.informes['alta']}"

    def es_apto(self):
        return self.apto

    def get_apartados(self):
        return self.informes['alta'].get_apartados()
