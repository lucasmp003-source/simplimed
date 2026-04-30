class HojaEvolucion:
    def __init__(self, registros=None):
        if registros is None:
            self.registros = None
            self.num_registros = 0
        else:
            self.registros = registros
            # print(registros)
            self.num_registros = len(registros)
            # print(self.num_registros)


    def __str__(self):
        result = "HOJA DE EVOLUCION:\n"

        for i, reg in enumerate(self.registros):
            result += f"Registro {i + 1}:\n{reg}\n\n"
        return result

    def __len__(self):
        return self.num_registros

    def __getitem__(self, index):
        return self.registros[index]

    def __setitem__(self, index, value):
        self.registros[index] = value

    def __delitem__(self, index):
        del self.registros[index]

class Registro:
    def __init__(self, evolucion, juicio_clinico, exploracion=None, pruebas_complementarias=None, plan_actuacion=None):
        self.evolucion = evolucion
        self.juicio_clinico = juicio_clinico
        self.exploracion = exploracion
        self.pruebas_complementarias = pruebas_complementarias
        self.plan_actuacion = plan_actuacion

    def __str__(self):
        output = f"Evolución: {self.evolucion}\nJuicio Clínico: {self.juicio_clinico}"
        if self.exploracion:
            output += f"\nExploración: {self.exploracion}"
        if self.pruebas_complementarias:
            output += f"\nPruebas Complementarias: {self.pruebas_complementarias}"
        if self.plan_actuacion:
            output += f"\nPlan de Actuación: {self.plan_actuacion}"
        return output