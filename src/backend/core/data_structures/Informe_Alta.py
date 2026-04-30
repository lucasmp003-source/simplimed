class InformeAlta:
    def __init__(self, args):
        self.motivo, self.antecedentes, self.enfermedad, self.pComplementarias, self.evolucion, self.intervencion, self.juicio, self.plan, self.tratamiento, self.revisiones = args

        self.secciones = {
            'motivo': self.motivo,
            'antecedentes': self.antecedentes,
            'enfermedad': self.enfermedad,
            'pruebas': self.pComplementarias,
            'evolucion': self.evolucion,
            'intervencion': self.intervencion,
            'juicio': self.juicio,
            'tratamiento': self.tratamiento,
            'plan': self.plan,
            'revisiones': self.revisiones
        }

    def __str__(self):
        motivo_str = self.secciones['motivo'] if self.secciones['motivo'] is not None else "N/A"
        evolucion_str = self.secciones['evolucion'] if self.secciones['evolucion'] is not None else "N/A"
        intervencion_str = self.secciones['intervencion'] if self.secciones['intervencion'] is not None else "N/A"
        tratamiento_str = self.secciones['tratamiento'] if self.secciones['tratamiento'] is not None else "N/A"
        plan_str = self.secciones['plan'] if self.secciones['plan'] is not None else "N/A"

        return f"Motivo de ingreso: {motivo_str}\nAntecedentes: {self.secciones['antecedentes']}\nEnfermedad Actual: {self.secciones['enfermedad']}\nPruebas Complementarias: {self.secciones['pruebas']}\nEvolución y Curso Clínico: {evolucion_str}\nIntervención Quirúrgica / Procedimientos: {intervencion_str}\nJuicio clínico: {self.secciones['juicio']}\nPlan de actuación: {plan_str}\nTratamiento: {tratamiento_str}\nRevisiones: {self.secciones['revisiones']}"

    def __getitem__(self, index):
        return self.secciones[index]

    def __setitem__(self, index, value):
        self.secciones[index] = value

    def __delitem__(self, index):
        del self.secciones[index]

    def get_apartados(self):
        apartados = ""
        if self.secciones['motivo'] is not None and self.secciones['motivo'] != "N/A":
            apartados += "Motivo de Consulta, "

        if self.secciones['antecedentes'] is not None and self.secciones['antecedentes'] != "N/A":
            apartados += "Antecedentes, "

        if self.secciones['enfermedad'] is not None and self.secciones['enfermedad'] != "N/A":
            apartados += "Enfermedad Actual, "

        if self.secciones['pruebas'] is not None and self.secciones['pruebas'] != "N/A":
            apartados += "Pruebas Complementarias, "

        if self.secciones['evolucion'] is not None and self.secciones['evolucion'] != "N/A":
            apartados += "Evolución y Curso Clínico, "

        if self.secciones['intervencion'] is not None and self.secciones['intervencion'] != "N/A":
            apartados += "Intervención Quirúrgica, "

        if self.secciones['juicio'] is not None and self.secciones['juicio'] != "N/A":
            apartados += "Juicio Clínico, "

        if self.secciones['plan'] is not None and self.secciones['plan'] != "N/A":
            apartados += "Plan de Actuación, "

        if self.secciones['tratamiento'] is not None and self.secciones['tratamiento'] != "N/A":
            apartados += "Tratamiento, "

        if self.secciones['revisiones'] is not None and self.secciones['revisiones'] != "N/A":
            apartados += "Revisiones"

        return apartados


