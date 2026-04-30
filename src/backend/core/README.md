# Proyecto de Generación y Simplificación de Informes Médicos (GALENO-IA)

Este proyecto permite procesar y ensamblar diferentes tipos de documentos médicos (hojas de evolución, hojas de anamnesis e informes de alta) para generar informes completos, al igual que para simplificarlos y facilitar su entendimiento para usuarios no profesionales utilizando modelos de lenguaje entrenados para tareas específicas. Está diseñado para trabajar con grandes volúmenes de datos médicos previamente anonimizados.

## Estructura del Proyecto

- **run.py**: Se encarga de ejecutar el flujo principal del proyecto donde carga la configuración, construye el entorno (buid) para previamente ejecutarlo (run).
- **builder.py**: Clase principal que maneja el flujo de construcción y procesamiento de informes médicos.
- **config/**: Contiene los archivos de configuración del proyecto.
  - `config.yaml`: Configuración específica de rutas de entrada/salida y modelos.
  - `price_config.yaml`: Configuración de precios para calcular el costo de ejecución para modelos de pago como GPT.
- **dataset/**: Carpeta que contiene los datos médicos anonimizados que se procesarán.
- **data_structures/**: Define las estructuras de los documentos médicos.
  - `Anamnesis.py`: Define la estructura de las hojas de anamnesis.
  - `Hoja_Evolucion.py`: Define la estructura de las hojas de evolución.
  - `Informe_Alta.py`: Define la estructura de los informes de alta.
  - `Ingreso.py`: Define la estructura de un ingreso médico completo.
- **preprocess/**: Contiene los scripts de preprocesamiento para los distintos documentos.
  - `processor_alta.py`: Procesa los informes de alta.
  - `processor_anamnesis.py`: Procesa las hojas de anamnesis.
  - `processor_evol.py`: Procesa las hojas de evolución.
- **tasks/**: Contiene las tareas de generación y simplificación de informes.
  - **generation/**: Carpeta con scripts de generación de informes.
  - **simplification/**: Carpeta con scripts de simplificación.
- **utils/**: Funciones utilitarias.
  - `utils.py`: Funciones auxiliares para el procesamiento de archivos.
  - `pricing.py`: Función para calcular el costo de procesamiento.
  - `template.html`: Plantilla para generar reportes en formato HTML para modelo GPT.

## Configuración

El proyecto utiliza un archivo de configuración `config.yaml` para especificar rutas de entrada y salida, modelos de lenguaje y opciones de ejecución. A continuación se muestra un ejemplo de la estructura de la configuración:

```yaml
paths:
  input:
    input_data: ruta hacia la carpeta donde se encuentra el dataset (anamnesis, alta y evolución)
    evol: ruta hacia la carpeta donde se encuentran las Hojas de Evolución
    alta: ruta hacia la carpeta donde se encuentran los Informes de Alta
    anamnesis: ruta hacia la carpeta donde se encuentran las Hojas de Anamnesis
  output:
    preprocessed_ingresos: ruta hacia donde se crearar los objtos pickle de los informes una vez preprocesados
    output_data: ruta hacia la carpeta donde se guardarán los informes generados
    results_name: nombre de la carpeta dentro de la carpeta resultados

model:
  name: nombre del modelo a ejecutar (debe de tener el mismo nombre que la carpeta donde se encuentren los scripts dentro del directorio tasks)
  type: para modelos GPT, el tipo de modelo a usar
  api_key: en caso de utilizar un modelo de pago, la key de la api
  policy: la política de generación, es decir, cómo se utilizará el modelo, si se le pasará el informe al completo o se hará por partes
  output_format: el formato de salida para modelos como el GPT, puede ser text o JSON  
```

## Uso

### Preprocesamiento de Datos

El preprocesamiento toma los documentos médicos y los transforma en un formato estructurado para su posterior procesamiento.

```bash
python run.py --preprocess
```

### Generación de Informes

Tras el preprocesamiento, se ensamblan informes médicos utilizando el modelo especificado en la configuración.

```bash
python run.py --task generation
```

```bash
python run.py --task simplification
```

### Otras Opciones

- `--log`: Activa el registro de eventos en el sistema.
- `--price`: Calcula el costo de procesamiento utilizando el archivo `price_config.yaml`.

## Estructura de Tareas

- **tasks/generation**: Incluye módulos como `GPT/completo.py` y `GPT/seccionado.py` para generar informes completos o seccionados según la política definida.
- **tasks/simplification**: Contiene modelos de simplificación como `llama/` y `biomistral/`, que simplifican los informes generados.

Aquí tienes la nota agregada:

## Instalación

1. Clona este repositorio:
   ```bash
   git clone <https://github.com/lmolino03/cardiologia>
   cd cardiologia-main
   ```

2. Instala las dependencias:
   ```bash
   pip install -r requirements.txt
   ```

3. Ejecuta el script principal:
   ```bash
   python run.py --preprocess
   ```

**Importante:**  
El parámetro `--preprocess` es necesario solo la primera vez que se ejecuta el script, ya que el preprocesamiento de datos puede tardar un tiempo. Una vez que los datos han sido preprocesados, no es necesario volver a ejecutar el script con este parámetro a menos que se realicen cambios en los archivos de entrada.


