#!/usr/bin/env python3
"""
analyze_admission.py — Simplified clinical value extraction from evolution sheets.

Pipeline (N registers → N+2 LLM calls):
  Phase 1: For each register, ask LLM to extract ALL clinical values (1 call/register)
  Phase 2: Collect all unique keywords → ask LLM to group into canonical variables + aliases (1 call)
  Phase 3: Ask LLM to categorize the variables into clinical groups (1 call)

Usage:
    python analyze_admission.py --phase discover --evolution-pdf <path> --output <path>
    python analyze_admission.py --phase extract --evolution-pdf <path> --output <path> --variables "troponina_t,glucosa"
"""

import os
import sys
import json
import math
import argparse
import re
import yaml

# Add the core directory to the Python path
CORE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, CORE_DIR)

from openai import OpenAI, APITimeoutError
from utils.utils import read_pdf


def load_config():
    """Load the generation config and models config."""
    config_path = os.path.join(CORE_DIR, 'config', 'production_config_generation.yaml')
    models_path = os.path.join(CORE_DIR, 'config', 'models.yaml')

    with open(config_path, 'r') as f:
        config = yaml.safe_load(f)

    with open(models_path, 'r') as f:
        models = yaml.safe_load(f)

    # Force Qwen model for analysis
    config['model']['name'] = 'qwen'
    config['model']['type'] = '8b'

    return config, models


def load_prompt(filename):
    """Load a prompt file."""
    prompt_path = os.path.join(
        CORE_DIR, 'tasks', 'generation', 'google', 'prompts', filename
    )
    with open(prompt_path, 'r', encoding='utf-8') as f:
        return f.read()


def get_client(config, models):
    """Create OpenAI client and return (client, model_path)."""
    model_config = config['model']
    model_name = model_config['name']
    model_type = model_config['type']
    api_key = model_config['api_key']
    base_url = model_config.get('base_url')
    model_path = models[model_name][model_type]

    client_kwargs = {'api_key': api_key}
    if base_url:
        client_kwargs['base_url'] = base_url
    client = OpenAI(**client_kwargs)

    return client, model_path


def preprocess_evolution(pdf_path):
    """Preprocess the evolution PDF. Returns (full_text, list_of_register_texts)."""
    try:
        from preprocess.processor_factory import ProcessorFactory
        from data_structures.Hoja_Evolucion import HojaEvolucion

        processor = ProcessorFactory.create_processor(pdf_path, 'evolucion')
        processor.process()
        args = processor.get_arguments()
        evolucion = HojaEvolucion(args)

        full_parts = ["=== HOJA DE EVOLUCIÓN ===\n"]
        register_texts = []

        if hasattr(evolucion, 'registros') and evolucion.registros:
            registros = evolucion.registros
            print(f"[ANALYSIS] Encontrados {len(registros)} registros")

            for i, registro in enumerate(registros, 1):
                reg_text = f"--- REGISTRO {i} ---\n"
                if hasattr(registro, '__dict__'):
                    for campo, valor in registro.__dict__.items():
                        # Excluir campos de resumen/juicio para no falsear extracción
                        if campo in ['juicio_clinico', 'plan_actuacion']:
                            continue
                        if valor and not campo.startswith('_'):
                            reg_text += f"**{campo.replace('_', ' ').title()}:** {valor}\n"
                else:
                    reg_text += str(registro)
                reg_text += "\n"
                full_parts.append(reg_text)
                register_texts.append(reg_text)
        else:
            raw = str(evolucion)
            full_parts.append(raw)
            register_texts.append(raw)

        return "\n".join(full_parts), register_texts

    except Exception as e:
        print(f"[ANALYSIS] Warning: Preprocessing failed ({e}), falling back to raw PDF")
        raw_text = read_pdf(pdf_path)
        full_text = f"=== HOJA DE EVOLUCIÓN ===\n{raw_text}"
        return full_text, [raw_text]


def strip_think_tags(text):
    """Remove <think>...</think> reasoning traces from model output."""
    return re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL).strip()


def extract_json_from_response(response_text):
    """Extract JSON from model response, handling markdown code blocks and <think> tags.
       Returns (json_obj, thinking_content)."""

    thinking_content = ""
    # Extract <think> tags first (Qwen reasoning traces)
    think_match = re.search(r'<think>(.*?)</think>', response_text, re.DOTALL)
    if think_match:
        thinking_content = think_match.group(1).strip()
        # Remove think block for JSON parsing
        response_text = re.sub(r'<think>.*?</think>', '', response_text, flags=re.DOTALL).strip()
    else:
        response_text = response_text.strip()

    json_obj = None
    # Try direct parse
    try:
        json_obj = json.loads(response_text)
    except json.JSONDecodeError:
        pass

    if json_obj is None:
        # Try markdown code block
        json_match = re.search(r'```(?:json)?\s*\n?(.*?)\n?```', response_text, re.DOTALL)
        if json_match:
            try:
                json_obj = json.loads(json_match.group(1))
            except json.JSONDecodeError as e:
                print(f"[ANALYSIS] JSON Parse Error (markdown): {e}")

    if json_obj is None:
        # Try finding JSON object
        json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
        if json_match:
            try:
                json_obj = json.loads(json_match.group(0))
            except json.JSONDecodeError as e:
                print(f"[ANALYSIS] JSON Parse Error (regex): {e}")

    return json_obj, thinking_content


# ============================================
# Phase 1: Extract values register by register
# ============================================

def phase_extract_all(register_texts, client, model_path):
    """
    For each register, make ONE LLM call to extract ALL clinical values.
    Returns: list of dicts, one per register, each with {keyword: {valor, unidad}}.
    Also returns the set of all unique keywords found.
    """
    prompt = load_prompt('Extraccion_valores_v2.txt')

    all_registers = []
    all_keywords = set()

    print(f"[ANALYSIS] Fase 1: Extrayendo valores de {len(register_texts)} registros...")

    for i, reg_text in enumerate(register_texts, 1):
        # Skip very short registers (likely artifacts)
        if len(reg_text.strip()) < 20:
            all_registers.append({"registro": i, "valores": {}})
            continue

        print(f"[ANALYSIS]   Registro nuevo {i}/{len(register_texts)}...")

        # Send progress bar update
        progress_pct = int(((i - 1) / len(register_texts)) * 100)
        print(json.dumps({"type": "progress_bar", "percentage": progress_pct, "message": f"Analizando registro {i}/{len(register_texts)}..."}, ensure_ascii=False))

        # Send initial progress log
        log_msg = {"type": "reasoning", "message": f"Analizando registro {i}/{len(register_texts)}..."}
        print(json.dumps(log_msg, ensure_ascii=False))

        success = False
        last_error = None
        max_attempts = 3

        for attempt in range(max_attempts):
            try:
                if attempt > 0:
                    print(f"[ANALYSIS]   Intento {attempt + 1}/{max_attempts} para registro {i}...")
                    enable_thinking = False
                else:
                    enable_thinking = True
                stream = client.chat.completions.create(
                    model=model_path,
                    messages=[
                        {"role": "system", "content": prompt},
                        {"role": "user", "content": reg_text}
                    ],
                    max_tokens=4096,
                    temperature=0.0,
                    timeout=300.0,
                    stream=True,
                    extra_body={"chat_template_kwargs": {"enable_thinking": enable_thinking}}
                )

                response_text = ""
                in_think_block = False

                # Signal start of thinking for this register
                print(json.dumps({"type": "reasoning_start", "message": f"🧠 Pensando (Registro {i})..."}, ensure_ascii=False))

                think_buffer = ""

                for chunk in stream:
                    content = chunk.choices[0].delta.content
                    if content:
                        response_text += content

                        # Detect start of think block
                        if "<think>" in content:
                            in_think_block = True
                            content = content.replace("<think>", "")

                        # Detect end of think block
                        if "</think>" in content:
                            in_think_block = False
                            pre_tag, post_tag = content.split("</think>", 1)

                            if pre_tag:
                                think_buffer += pre_tag

                            if think_buffer:
                                print(json.dumps({"type": "reasoning_chunk", "chunk": think_buffer}, ensure_ascii=False))
                                think_buffer = ""

                            print(json.dumps({"type": "reasoning_end"}, ensure_ascii=False))
                            content = post_tag

                        if in_think_block:
                            think_buffer += content
                            if len(think_buffer) > 50 or any(c in think_buffer for c in ".!?\n"):
                                print(json.dumps({"type": "reasoning_chunk", "chunk": think_buffer}, ensure_ascii=False))
                                think_buffer = ""

                # Final flush if anything remains in buffer
                if think_buffer:
                    print(json.dumps({"type": "reasoning_chunk", "chunk": think_buffer}, ensure_ascii=False))

                print(f"[ANALYSIS]   RAW Extracción ({len(response_text)} chars)")

                # FIX: unpack tuple from extract_json_from_response
                result, thinking = extract_json_from_response(response_text)

                if result and "valores" in result:
                    valores = result["valores"]

                    cleaned_valores = {}
                    for kw, val_data in valores.items():
                        kw = kw.lower().strip()
                        
                        if isinstance(val_data, dict):
                            val = val_data.get("valor")
                            unidad = val_data.get("unidad", "")
                        else:
                            # If the LLM returned a raw value e.g. {"glucosa": 120} or NaN
                            val = val_data
                            unidad = ""
                            val_data = {"valor": val, "unidad": unidad}
                            
                        if val is None:
                            continue
                        if isinstance(val, str):
                            if val.lower().strip() in ["none", "null", "nan", "0", "0.0", ""]:
                                continue
                        if isinstance(val, (int, float)):
                            if val == 0 or math.isnan(val) or math.isinf(val):
                                continue
                                
                        cleaned_valores[kw] = val_data
                        all_keywords.add(kw)

                    all_registers.append({"registro": i, "valores": cleaned_valores})

                    if cleaned_valores:
                        print(f"[ANALYSIS]     → {list(cleaned_valores.keys())}")
                        log_msg = {"type": "reasoning", "message": f"✅ Registro {i}: Encontrados {len(cleaned_valores)} valores: {', '.join(list(cleaned_valores.keys())[:5])}..."}
                        print(json.dumps(log_msg, ensure_ascii=False))
                    else:
                        log_msg = {"type": "reasoning", "message": f"ℹ️ Registro {i}: Sin valores relevantes."}
                        print(json.dumps(log_msg, ensure_ascii=False))

                    success = True
                    break

                else:
                    print(f"[ANALYSIS]     ⚠ Intento {attempt + 1}: No se pudo parsear JSON.")
                    last_error = "JSON inválido"

            except APITimeoutError as e:
                print(f"[ANALYSIS]   ⚠ TIMEOUT (300s) en registro {i} (Intento {attempt + 1}).")
                last_error = str(e)

            except Exception as e:
                print(f"[ANALYSIS]   ERROR en registro {i} (Intento {attempt + 1}): {e}")
                last_error = str(e)

        if not success:
            print(f"[ANALYSIS]   ⚠ FALLO FINAL en registro {i} tras {max_attempts} intentos. Error: {last_error}")
            all_registers.append({"registro": i, "valores": {}})

    print(f"[ANALYSIS] ✓ Fase 1 completada: {len(all_registers)} registros, {len(all_keywords)} keywords únicas")
    print(f"[ANALYSIS]   Keywords encontradas: {sorted(all_keywords)}")

    return all_registers, all_keywords


# ============================================
# Phase 2: Group keywords into canonical vars
# ============================================

def phase_group_keywords(all_keywords, client, model_path):
    """
    Single LLM call: given the set of raw keywords found across all registers,
    group them into canonical variable names with aliases and descriptions.
    Returns list of {nombre, unidad, descripcion, aliases}.
    """
    prompt = load_prompt('Agrupar_keywords.txt')
    input_json = json.dumps(sorted(list(all_keywords)), ensure_ascii=False)

    print(f"[ANALYSIS] Fase 2: Agrupando {len(all_keywords)} keywords en variables canónicas...")

    print(f"[DEBUG PHASE 2] Prompt loaded from: Agrupar_keywords.txt")
    print(f"[DEBUG PHASE 2] Prompt length: {len(prompt)} chars")
    print(f"[DEBUG PHASE 2] Prompt preview: {prompt}")
    print(f"[DEBUG PHASE 2] Input payload: {input_json}")

    max_retries = 3
    for attempt in range(max_retries):
        try:
            print(f"[ANALYSIS]   Intento {attempt + 1}/{max_retries}...")
            response = client.chat.completions.create(
                model=model_path,
                messages=[
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": input_json}
                ],
                max_tokens=4096,
                temperature=0.0,
                timeout=120.0,  # FIX: increased from 30s to 120s
                extra_body={"chat_template_kwargs": {"enable_thinking": False}}
            )

            response_text = response.choices[0].message.content
            print(f"[ANALYSIS]   RAW Agrupación ({len(response_text)} chars):\n{response_text}")

            # FIX: unpack tuple from extract_json_from_response
            result, _ = extract_json_from_response(response_text)

            if result:
                unique_vars = []
                if isinstance(result, list):
                    unique_vars = result
                elif isinstance(result, dict) and "variables_unicas" in result:
                    unique_vars = result["variables_unicas"]

                if unique_vars:
                    valid_vars = []
                    for v in unique_vars:
                        if isinstance(v, dict) and "nombre" in v:
                            v["nombre"] = v.get("nombre", "").lower().strip()
                            valid_vars.append(v)

                    if valid_vars:
                        print(f"[ANALYSIS] ✓ Fase 2 completada: {len(valid_vars)} variables canónicas")
                        for v in valid_vars:
                            print(f"[ANALYSIS]     {v['nombre']} ← {v.get('aliases', [])}")
                        return valid_vars

            print(f"[ANALYSIS]   ⚠ Intento {attempt + 1}: Formato incorrecto o respuesta vacía.")

        except APITimeoutError:
            print(f"[ANALYSIS]   ⚠ TIMEOUT (120s) en intento {attempt + 1}. Reintentando...")

        except Exception as e:
            print(f"[ANALYSIS]   Error en intento {attempt + 1}: {e}")

    # Fallback: each keyword becomes its own variable
    print(f"[ANALYSIS]   ⚠ Fallback: cada keyword como variable independiente")
    return [{"nombre": kw.lower().replace(" ", "_"), "unidad": "", "aliases": [kw]} for kw in sorted(all_keywords)]


# ============================================
# Phase 3: Categorize variables
# ============================================

def phase_categorize(unique_vars, client, model_path):
    """
    Single LLM call to group variables into clinical categories.
    Returns list of {nombre_categoria, variables: [nombre]}.
    """
    prompt = load_prompt('Categorizar_variables.txt')
    categorization_input = [{"nombre": v["nombre"], "unidad": v.get("unidad", "")} for v in unique_vars]
    input_json = json.dumps(categorization_input, ensure_ascii=False)

    print(f"[ANALYSIS] Fase 3: Categorizando {len(unique_vars)} variables...")

    try:
        response = client.chat.completions.create(
            model=model_path,
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": input_json}
            ],
            max_tokens=4096,
            temperature=0.0,
            timeout=60.0,  # FIX: added explicit timeout
            extra_body={"chat_template_kwargs": {"enable_thinking": False}}
        )

        response_text = response.choices[0].message.content
        print(f"[ANALYSIS]   RAW Categorización ({len(response_text)} chars):\n{response_text}")

        # FIX: unpack tuple from extract_json_from_response
        result, _ = extract_json_from_response(response_text)

        if result and isinstance(result, dict) and "categorias" in result:
            categorias = result["categorias"]
            print(f"[ANALYSIS] ✓ Fase 3 completada: {len(categorias)} categorías")
            for cat in categorias:
                print(f"[ANALYSIS]     {cat['nombre_categoria']}: {cat['variables']}")
            return categorias
        else:
            print(f"[ANALYSIS]   ⚠ Categorización no devolvió formato esperado")

    except APITimeoutError:
        print(f"[ANALYSIS]   ⚠ TIMEOUT (60s) en categorización.")

    except Exception as e:
        print(f"[ANALYSIS]   Error en categorización: {e}")

    # Fallback: single category with all variables
    return [{"nombre_categoria": "Variables Clínicas", "variables": [v["nombre"] for v in unique_vars]}]


# ============================================
# Remap extraction data: keyword → canonical
# ============================================

def remap_extraction(all_registers, unique_vars):
    """
    Convert the raw extraction data (keyed by keywords) to canonical variable names.
    Uses the aliases mapping from phase 2.
    """
    # Build reverse map: keyword (lowercase) → canonical name
    keyword_to_canon = {}
    for var in unique_vars:
        canon = var["nombre"]
        for alias in var.get("aliases", []):
            if isinstance(alias, str):
                keyword_to_canon[alias.lower()] = canon

    remapped = []
    for reg in all_registers:
        new_vals = {}
        for kw, val_data in reg.get("valores", {}).items():
            canon = keyword_to_canon.get(kw.lower())
            if canon:
                new_vals[canon] = val_data
            else:
                # Keep as-is if no mapping found (shouldn't happen often)
                new_vals[kw.lower().replace(" ", "_")] = val_data
        remapped.append({"registro": reg["registro"], "valores": new_vals})

    return remapped


# ============================================
# Main pipeline: discover
# ============================================

def phase_discover(register_texts, client, model_path_phase_1, model_path_phase_2, output_path=None):
    """
    Simplified discovery pipeline:
    1. Extract all values (1 call/register)
    2. Group keywords (1 call)
    3. Categorize (1 call)
    4. Density filter + remap + save
    """

    # --- Phase 1: Extract ---
    all_registers, all_keywords = phase_extract_all(register_texts, client, model_path_phase_1)

    if len(all_keywords) == 0:
        return {"variables_encontradas": [], "categorias": []}

    # --- Phase 2: Group keywords ---
    unique_vars = phase_group_keywords(all_keywords, client, model_path_phase_2)

    # --- Remap extraction data ---
    remapped = remap_extraction(all_registers, unique_vars)

    # --- Density filtering ---
    total_regs = len(register_texts)
    threshold = math.ceil(total_regs * 0.10)

    print(f"[ANALYSIS] FILTRADO: Umbral = {threshold} registros (Total: {total_regs})")

    var_counts = {}
    var_values = {}

    for reg in remapped:
        for var_name, data in reg.get("valores", {}).items():
            var_counts[var_name] = var_counts.get(var_name, 0) + 1

            if var_name not in var_values:
                var_values[var_name] = set()
            val = data.get("valor")
            if val is not None:
                var_values[var_name].add(str(val).strip().lower())

    final_vars = []
    dropped_vars = []
    kept_names = set()

    for v in unique_vars:
        name = v["nombre"]
        count = var_counts.get(name, 0)
        distinct_count = len(var_values.get(name, set()))

        # Filter 1: Density (10%)
        if count < threshold:
            dropped_vars.append(f"{name}(baja_densidad: {count})")
            continue

        # Filter 2: Unique value check
        if distinct_count <= 1:
            dropped_vars.append(f"{name}(unico_valor)")
            continue

        final_vars.append(v)
        kept_names.add(name)

    print(f"[ANALYSIS] Variables descartadas: {dropped_vars}")
    print(f"[ANALYSIS] Variables conservadas: {len(final_vars)}")

    # --- Phase 3: Categorize (only kept vars) ---
    categorias = phase_categorize(final_vars, client, model_path_phase_2)

    # --- Save extraction result ---
    if output_path:
        extract_path = output_path.replace('_analysis_discovery.json', '_analysis_extract.json')
        filtered_extraction = {"registros": []}
        for reg in remapped:
            new_vals = {k: v for k, v in reg.get("valores", {}).items() if k in kept_names}
            filtered_extraction["registros"].append({"registro": reg["registro"], "valores": new_vals})

        try:
            with open(extract_path, 'w', encoding='utf-8') as f:
                json.dump(filtered_extraction, f, ensure_ascii=False, indent=2)
            print(f"[ANALYSIS] ✓ Extracción guardada en: {extract_path}")
        except Exception as e:
            print(f"[ANALYSIS] ⚠ Error guardando extracción: {e}")

    total_calls = len(register_texts) + 2
    print(f"[ANALYSIS] ✓ Pipeline completado con {total_calls} llamadas al LLM")

    return {
        "variables_encontradas": final_vars,
        "categorias": categorias,
    }


# ============================================
# Main
# ============================================

def main():
    parser = argparse.ArgumentParser(description='Analyze evolution sheet for clinical values')
    parser.add_argument('--phase', required=True, choices=['discover', 'extract'],
                        help='Phase: discover (find variables) or extract (get values)')
    parser.add_argument('--evolution-pdf', required=True, help='Path to evolution PDF')
    parser.add_argument('--output', required=True, help='Path to output JSON')
    parser.add_argument('--variables', default='',
                        help='Comma-separated variable names (required for extract phase)')

    args = parser.parse_args()

    if not os.path.exists(args.evolution_pdf):
        print(f"[ANALYSIS] ERROR: Archivo no encontrado: {args.evolution_pdf}")
        error_result = {"error": "Archivo de evolución no encontrado"}
        with open(args.output, 'w', encoding='utf-8') as f:
            json.dump(error_result, f, ensure_ascii=False, indent=2)
        sys.exit(1)

    print(f"[ANALYSIS] Fase: {args.phase} | PDF: {args.evolution_pdf}")

    # Load config and create client
    config, models = load_config()
    client, model_path = get_client(config, models)

    # Preprocess
    full_text, register_texts = preprocess_evolution(args.evolution_pdf)

    if args.phase == 'discover':
        try:
            gemma_path = models['google']['gemma-12b']
        except KeyError:
            print("[ANALYSIS] ⚠ Model 'gemma-12b' not found in config. Using default.")
            gemma_path = model_path

        print(f"[ANALYSIS] Pipeline configurado. Fase 1: Qwen | Fase 2/3: {os.path.basename(gemma_path)}")

        result = phase_discover(register_texts, client, model_path, gemma_path, output_path=args.output)

    elif args.phase == 'extract':
        if not args.variables:
            print("[ANALYSIS] ERROR: --variables requerido para fase extract")
            sys.exit(1)

        selected = [v.strip() for v in args.variables.split(',') if v.strip()]

        # Check if pre-computed file exists
        if os.path.exists(args.output) and os.path.getsize(args.output) > 10:
            print(f"[ANALYSIS] Detectada extracción pre-computada en {args.output}")
            try:
                with open(args.output, 'r', encoding='utf-8') as f:
                    full_data = json.load(f)

                filtered_result = {"registros": []}
                for reg in full_data.get("registros", []):
                    new_vals = {k: v for k, v in reg.get("valores", {}).items() if k in selected}
                    filtered_result["registros"].append({"registro": reg["registro"], "valores": new_vals})

                result = filtered_result
                print(f"[ANALYSIS] ✓ Usando datos pre-computados ({len(selected)} variables)")

            except Exception as e:
                print(f"[ANALYSIS] ⚠ Error leyendo pre-computación: {e}. Re-extrayendo...")
                all_registers, _ = phase_extract_all(register_texts, client, model_path)
                result = {"registros": all_registers}
        else:
            print(f"[ANALYSIS] Iniciando extracción bajo demanda...")
            all_registers, _ = phase_extract_all(register_texts, client, model_path)
            result = {"registros": all_registers}

    # Write output
    with open(args.output, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"[ANALYSIS] ✓ Resultado escrito en: {args.output}")


if __name__ == '__main__':
    main()