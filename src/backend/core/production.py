
import os
import sys
import threading
import time
import fcntl

from config.production_config import BaseConfig
from builder_production import Builder
from utils.utils import get_input_data, load_processed_files, save_processed_files, get_relative_path

# Lock global para acceso seguro
lock = threading.Lock()


def acquire_task_lock(task_type):
    """Previene que dos instancias de production.py con la misma tarea corran simultáneamente."""
    lock_path = f"/tmp/simplimed_{task_type}.lock"
    lock_file = open(lock_path, 'w')
    try:
        fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        lock_file.write(str(os.getpid()))
        lock_file.flush()
        print(f"[MAIN] ✓ Lock de tarea adquirido: {lock_path} (PID {os.getpid()})")
        return lock_file  # Mantener referencia para que no se cierre/libere
    except BlockingIOError:
        print(f"[MAIN] ❌ Otra instancia de production.py --task {task_type} ya está corriendo!")
        print(f"[MAIN] Archivo lock: {lock_path}")
        lock_file.close()
        sys.exit(1)

def get_processed_files_path(baseConfig):
    """Obtiene la ruta del archivo de persistencia desde la configuración"""
    return get_relative_path(baseConfig.config["yaml-config"]["paths"]["internal"]["processed_files"])


def get_output_folder(baseConfig):
    """Obtiene la carpeta de salida desde la configuración"""
    return get_relative_path(baseConfig.config["yaml-config"]["paths"]["output"]["output_folder"])


def handle_launcher(file, baseConfig, processed_files, processed_files_path, lock):
    try:
        print(f"[HILO] Procesando archivo: {file}")
        with lock:
            processed_files[file] = "launched"
            save_processed_files(processed_files, processed_files_path)
        builder = Builder(baseConfig)
        launcher = builder.build(file)
        launcher.run()

        with lock:
            processed_files[file] = "executed"
            save_processed_files(processed_files, processed_files_path)
        
        # Crear archivo de señal de completado
        output_folder = get_output_folder(baseConfig)
        
        # Para generation, normalizar el nombre (quitar _anamnesis)
        task_type = baseConfig.config.get("yaml-config", {}).get("task", "simplification")
        if task_type == "generation":
            complete_file_base = file.replace('_anamnesis.pdf', '.complete')
        else:
            complete_file_base = file.replace('.pdf', '.complete')
            
        complete_file = os.path.join(output_folder, complete_file_base)
        print(f"[HILO] Creando archivo .complete en: {complete_file}")
        try:
            with open(complete_file, 'w') as f:
                f.write('completed')
                f.flush()
                os.fsync(f.fileno())
            print(f"[HILO] Archivo .complete creado exitosamente")
        except Exception as e:
            print(f"[HILO] ERROR creando archivo .complete: {e}")
        
        print(f"[HILO] Archivo ejecutado correctamente: {file}")
    except Exception as e:
        print(f"[HILO] Error procesando archivo {file}: {e}")
        with lock:
            save_processed_files(processed_files, processed_files_path)


def monitor_directory(directory, builder, processed_files, processed_files_path, lock):
    # Obtener el task type para decidir si filtrar archivos
    task_type = builder.config.get("yaml-config", {}).get("task", "simplification")
    
    while True:
        try:
            current_files = set(os.listdir(directory))
            with lock:
                already_processed = set(processed_files.keys())
            new_files = current_files - already_processed

            for file in new_files:
                full_path = os.path.join(directory, file)
                if os.path.isfile(full_path):
                    # Para generation: solo procesar _anamnesis.pdf como trigger
                    # El archivo _evolution.pdf se marca como procesado pero no se ejecuta
                    if task_type == "generation" and "_evolution.pdf" in file:
                        print(f"[MONITOR] Archivo de evolución detectado (solo marcando): {file}")
                        with lock:
                            processed_files[file] = "paired"  # Marcado como par, no ejecutar
                            save_processed_files(processed_files, processed_files_path)
                        continue
                    
                    print(f"[MONITOR] Nuevo archivo detectado: {file}")
                    with lock:
                        processed_files[file] = "launched"
                        save_processed_files(processed_files, processed_files_path)
                    
                    # Para generation, también marcar el archivo _evolution.pdf como procesado
                    if task_type == "generation" and "_anamnesis.pdf" in file:
                        evolution_file = file.replace("_anamnesis.pdf", "_evolution.pdf")
                        with lock:
                            if evolution_file not in processed_files:
                                processed_files[evolution_file] = "paired"
                                save_processed_files(processed_files, processed_files_path)
                                print(f"[MONITOR] Archivo de evolución pareado: {evolution_file}")

                    threading.Thread(
                        target=handle_launcher,
                        args=(file, builder, processed_files, processed_files_path, lock),
                        daemon=True
                    ).start()

            time.sleep(1)
        except Exception as e:
            print(f"[MONITOR] Error monitoreando el directorio: {e}")



def main():
    baseConfig = BaseConfig()
    task_type = baseConfig.config["runtime-config"].get("task", "simplification")
    
    # Adquirir lock de proceso para evitar instancias duplicadas
    task_lock_handle = acquire_task_lock(task_type)
    
    production_data_path = get_input_data(baseConfig)
    processed_files_path = get_processed_files_path(baseConfig)

    processed_files = load_processed_files(processed_files_path)
    print(f"[MAIN] Archivos ya procesados: {processed_files}")

    monitor_thread = threading.Thread(
        target=monitor_directory,
        args=(production_data_path, baseConfig, processed_files, processed_files_path, lock),
        daemon=True
    )
    monitor_thread.start()

    # Mantener el hilo principal activo
    while True:
        time.sleep(10)


if __name__ == "__main__":
    main()
