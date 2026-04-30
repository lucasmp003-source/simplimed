#!/usr/bin/env python3
"""
analyze_admission.py — Two-phase clinical value extraction from evolution sheets.

Phase 1 (--phase discover):
    Reads evolution PDF → sends to model → returns list of found variable names (compact)

Phase 2 (--phase extract):
    Reads evolution PDF + selected variables → iterates register by register →
    asks model for values of selected variables per register → outputs combined JSON

Usage:
    python analyze_admission.py --phase discover --evolution-pdf <path> --output <path>
    python analyze_admission.py --phase extract --evolution-pdf <path> --output <path> --variables "troponina,glucosa,saturacion_o2"
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

from openai import OpenAI
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


def extract_json_from_response(response_text):
    """Extract JSON from model response, handling markdown code blocks and <think> tags."""
    
    # Remove <think> tags first (Qwen reasoning traces)
    response_text = re.sub(r'<think>.*?</think>', '', response_text, flags=re.DOTALL).strip()

    # Try direct parse
    try:
        return json.loads(response_text)
    except json.JSONDecodeError:
        pass

    # Try markdown code block
    json_match = re.search(r'```(?:json)?\s*\n?(.*?)\n?```', response_text, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group(1))
        except json.JSONDecodeError:
            pass

    # Try finding JSON object
    json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group(0))
        except json.JSONDecodeError:
            pass

    return None


# ============================================
# Phase 1: Discover plottable variables
# ============================================

def phase_discover(register_texts, client, model_path, output_path=None):
    """
    Ask the model what plottable variables exist, iterating REGISTER BY REGISTER.
    Aggregates unique variables found across all registers, then normalizes,
    EXTRACTS (pre-computes values), FILTERS by density, and categorizes.
    """
    prompt = load_prompt('Analisis_ingreso.txt')
    
    unique_vars = {} # Map nombre -> var_info to keep unique by name
    
    print(f"[ANALYSIS] Fase 1: Descubriendo variables en {len(register_texts)} registros...")
    
    for i, reg_text in enumerate(register_texts, 1):
        # Skip very short registers (likely artifacts)
        if len(reg_text.strip()) < 20:
            continue
            
        print(f"[ANALYSIS]   Explorando registro {i}/{len(register_texts)}...")
        
        try:
            response = client.chat.completions.create(
                model=model_path,
                messages=[
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": reg_text}
                ],
                max_tokens=2048,
                temperature=0.0,
            )

            response_text = response.choices[0].message.content
            print(f"[ANALYSIS]   Respuesta RAW Descubrimiento ({len(response_text)} chars):\n{response_text}")
            
            # Strip markdown code fences
            cleaned = response_text.strip()
            if cleaned.startswith('```'):
                first_newline = cleaned.find('\n')
                if first_newline != -1:
                    cleaned = cleaned[first_newline + 1:]
                if cleaned.rstrip().endswith('```'):
                    cleaned = cleaned.rstrip()[:-3].rstrip()
            
            result = extract_json_from_response(cleaned)
            if not result:
                result = extract_json_from_response(response_text)
                
            if result and "variables_encontradas" in result:
                for var in result["variables_encontradas"]:
                    name = var.get("nombre", "").strip()
                    if name and name not in unique_vars:
                        unique_vars[name] = var
                        print(f"[ANALYSIS]     + Nueva variable: {name} ({var.get('unidad', '?')})")
            
        except Exception as e:
            print(f"[ANALYSIS]   Error en registro {i}: {e}")
            continue

    raw_list = list(unique_vars.values())
    print(f"[ANALYSIS] ✓ Fase 1 completada: {len(raw_list)} variables crudas encontradas")

    if len(raw_list) == 0:
        return {"variables_encontradas": [], "categorias": []}

    # --- Phase 1b: Normalize variable names ---
    normalized_vars = phase_normalize(raw_list, client, model_path)

    # --- Phase 2: FULL EXTRACTION (Pre-computation) ---
    print(f"[ANALYSIS] PRE-COMPUTACIÓN: Extrayendo valores para {len(normalized_vars)} variables...")
    all_vars_names = [v["nombre"] for v in normalized_vars]
    
    # Pass normalized_vars directly
    full_extraction = phase_extract(register_texts, all_vars_names, client, model_path, variable_objects=normalized_vars)
    
    # --- Phase 3: DENSITY FILTERING ---
    # Threshold: 10% of registers must have a value
    total_regs = len(register_texts)
    threshold = math.ceil(total_regs * 0.10)
    
    print(f"[ANALYSIS] FILTRADO: Umbral de densidad = {threshold} registros con valor (Total: {total_regs})")
    
    kept_vars_names = set()
    var_counts = {}
    
    # Count non-null values per variable
    for reg in full_extraction["registros"]:
        vals = reg.get("valores", {})
        for var_name, val_data in vals.items():
            # Check if val_data has a value (already filtered 0 in extract)
            if val_data:
                var_counts[var_name] = var_counts.get(var_name, 0) + 1

    final_vars = []
    dropped_vars = []
    
    for v in normalized_vars:
        name = v["nombre"]
        count = var_counts.get(name, 0)
        if count >= threshold:
            final_vars.append(v)
            kept_vars_names.add(name)
        else:
            dropped_vars.append(f"{name}({count})")
            
    print(f"[ANALYSIS] Variables descartadas por baja densidad: {dropped_vars}")
    print(f"[ANALYSIS] Variables conservadas: {len(final_vars)}")
    
    # --- Phase 1c: Categorize variables (ONLY KEPT) ---
    categorias = phase_categorize(final_vars, client, model_path)

    # --- SAVE EXTRACTION RESULT (Side Effect) ---
    if output_path:
        extract_path = output_path.replace('_analysis_discovery.json', '_analysis_extract.json')
        filtered_extraction = {"registros": []}
        for reg in full_extraction["registros"]:
            new_vals = {}
            for k, v in reg.get("valores", {}).items():
                if k in kept_vars_names:
                    new_vals[k] = v
            filtered_extraction["registros"].append({"registro": reg["registro"], "valores": new_vals})
            
        try:
            with open(extract_path, 'w', encoding='utf-8') as f:
                json.dump(filtered_extraction, f, ensure_ascii=False, indent=2)
            print(f"[ANALYSIS] ✓ Pre-computación guardada en: {extract_path}")
        except Exception as e:
            print(f"[ANALYSIS] ⚠ Error guardando pre-computación: {e}")

    return {
        "variables_encontradas": final_vars,
        "categorias": categorias,
    }


# ============================================
# Phase 1b: Normalize / deduplicate variables
# ============================================

def phase_normalize(raw_vars, client, model_path):
    """
    Single LLM call to unify variable names that refer to the same clinical concept.
    Returns list of unique vars, each with an 'aliases' field listing original forms.
    """
    # --- Pre-processing: Case-insensitive deduplication & Garbage Filtering ---
    # raw_vars may contain {"nombre": "Cr"}, {"nombre": "cr"} -> treat as same before LLM
    pre_map = {} # lowercase_name -> { "original_forms": set(), "units": [] }
    
    import re
    
    for v in raw_vars:
        name = v.get("nombre", "").strip()
        if not name: continue
        
        # --- GARBAGE FILTER ---
        # 1. Remove pure numbers (e.g. "40", "50")
        if re.match(r'^\d+(\.\d+)?$', name):
            continue
        # 2. Remove very short variables unless known (e.g. "K", "P" are ok, but "a", "b" maybe not? Keep length >= 2 generally, or whitelist single letters)
        # Actually "K", "P", "Na" are common. "PA148" is definitely garbage (looks like value/code).
        # Remove if it looks like "PA" + number
        if re.match(r'^[A-Za-z]+\d+$', name): # e.g. PA148
            continue
            
        low_name = name.lower()
        if low_name not in pre_map:
            pre_map[low_name] = {"original_forms": set(), "units": []}
            
        pre_map[low_name]["original_forms"].add(name)
        if v.get("unidad"):
            pre_map[low_name]["units"].append(v["unidad"])

    # Build reduced input list for LLM
    llm_input = []
    for low_name, data in pre_map.items():
        # Pick most common unit
        unit = ""
        if data["units"]:
            # Simple mode calculation
            unit = max(set(data["units"]), key=data["units"].count)
        
        llm_input.append({"nombre": low_name, "unidad": unit})

    # --- LLM Call ---
    prompt = load_prompt('Normalizar_variables.txt')
    input_json = json.dumps(llm_input, ensure_ascii=False)

    print(f"[ANALYSIS] Fase 1b: Normalizando {len(raw_vars)} (raw) → {len(llm_input)} (pre-processed) variables...")

    max_retries = 3
    for attempt in range(max_retries):
        try:
            print(f"[ANALYSIS]   Intento {attempt+1}/{max_retries}...")
            response = client.chat.completions.create(
                model=model_path,
                messages=[
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": input_json}
                ],
                max_tokens=4096,
                temperature=0.0,
            )

            response_text = response.choices[0].message.content
            print(f"[ANALYSIS]   Respuesta RAW completa ({len(response_text)} chars):\n{response_text}")
            
            # Strip markdown code fences if present
            cleaned = response_text.strip()
            if cleaned.startswith('```'):
                first_newline = cleaned.find('\n')
                if first_newline != -1:
                    cleaned = cleaned[first_newline + 1:]
                if cleaned.rstrip().endswith('```'):
                    cleaned = cleaned.rstrip()[:-3].rstrip()
            
            result = extract_json_from_response(cleaned)
            if not result:
                result = extract_json_from_response(response_text)

            if result and "variables_unicas" in result:
                unique_vars = result["variables_unicas"]
                print(f"[ANALYSIS] ✓ Fase 1b completada: {len(unique_vars)} variables canónicas identificadas")
                
                # --- Post-processing: Expand aliases ---
                final_vars = []
                for v in unique_vars:
                    # Enforce lowercase canonical name
                    canon_name = v.get("nombre", "").lower().strip()
                    v["nombre"] = canon_name
                    
                    # Expand aliases
                    llm_aliases = v.get("aliases", [canon_name])
                    expanded_aliases = set()
                    
                    for alias_low in llm_aliases:
                        alias_low = alias_low.lower().strip()
                        if alias_low in pre_map:
                            expanded_aliases.update(pre_map[alias_low]["original_forms"])
                        else:
                            expanded_aliases.add(alias_low)
                    
                    v["aliases"] = list(expanded_aliases)
                    # if len(v["aliases"]) > 1:
                    #     print(f"[ANALYSIS]     {canon_name} ← {v['aliases']}")
                    
                    final_vars.append(v)

                print(f"[ANALYSIS]   JSON Normalizado Final:\n{json.dumps({'variables_unicas': final_vars}, ensure_ascii=False, indent=2)}")
                return final_vars
            else:
                print(f"[ANALYSIS]   ⚠ Intento {attempt+1}: Formato incorrecto. Ver respuesta completa arriba.")
        
        except Exception as e:
            print(f"[ANALYSIS]   Error en intento {attempt+1}: {e}")
            if 'response_text' in locals():
                print(f"[ANALYSIS]   Respuesta parcial al error:\n{response_text}")

    # Fallback: use pre_map deduplication (already garbage-filtered and case-merged)
    print(f"[ANALYSIS]   ⚠ Todos los intentos fallaron. Usando fallback de pre_map con {len(pre_map)} variables únicas")
    fallback_vars = []
    for low_name, data in pre_map.items():
        unit = ""
        if data["units"]:
            unit = max(set(data["units"]), key=data["units"].count)
        fallback_vars.append({
            "nombre": low_name,
            "unidad": unit,
            "descripcion": "",
            "aliases": list(data["original_forms"])
        })
    return fallback_vars


# ============================================
# Phase 1c: Categorize variables
# ============================================

def phase_categorize(unique_vars, client, model_path):
    """
    Single LLM call to group variables into clinical categories.
    Returns list of {nombre_categoria, variables: [nombre]}.
    """
    prompt = load_prompt('Categorizar_variables.txt')
    # Optimize input: only send name and unit to LLM, aliases are not needed for categorization
    categorization_input = [{"nombre": v["nombre"], "unidad": v.get("unidad", "")} for v in unique_vars]
    input_json = json.dumps(categorization_input, ensure_ascii=False)

    print(f"[ANALYSIS] Fase 1c: Categorizando {len(unique_vars)} variables...")
    canon_names = [v["nombre"] for v in categorization_input]
    print(f"[ANALYSIS]   Input a categorización: {canon_names}")

    try:
        response = client.chat.completions.create(
            model=model_path,
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": input_json}
            ],
            max_tokens=4096,
            temperature=0.0,
        )

        response_text = response.choices[0].message.content
        print(f"[ANALYSIS]   Respuesta RAW Categorización ({len(response_text)} chars):\n{response_text}")
        
        # Strip markdown code fences if present
        cleaned = response_text.strip()
        if cleaned.startswith('```'):
            first_newline = cleaned.find('\n')
            if first_newline != -1:
                cleaned = cleaned[first_newline + 1:]
            if cleaned.rstrip().endswith('```'):
                cleaned = cleaned.rstrip()[:-3].rstrip()
        
        result = extract_json_from_response(cleaned)
        if not result:
            result = extract_json_from_response(response_text)

        if result and "categorias" in result:
            categorias = result["categorias"]
            print(f"[ANALYSIS] ✓ Fase 1c completada: {len(categorias)} categorías")
            for cat in categorias:
                print(f"[ANALYSIS]     {cat['nombre_categoria']}: {cat['variables']}")
            print(f"[ANALYSIS]   JSON Agrupado Final:\n{json.dumps(categorias, ensure_ascii=False, indent=2)}")
            return categorias
        else:
            print(f"[ANALYSIS]   ⚠ Categorización no devolvió formato esperado")
            print(f"[ANALYSIS]   Respuesta LLM (primeros 500 chars): {response_text[:500]}")
    except Exception as e:
        print(f"[ANALYSIS]   Error en categorización: {e}")

    # Fallback: single category with all variables
    return [{"nombre_categoria": "Variables Clínicas", "variables": [v["nombre"] for v in unique_vars]}]


# ============================================
# Phase 2: Extract values register by register
# ============================================

def phase_extract(register_texts, selected_variables, client, model_path, discovery_path=None, variable_objects=None):
    """
    For each register, check if any alias of the selected variables appears in the text.
    Only call the LLM if at least one keyword match is found — prevents hallucinations.
    """
    prompt_template = load_prompt('Extraccion_valores.txt')

    # Build alias lookup: canonical_name -> [alias1, alias2, ...]
    aliases_map = {}
    target_units_map = {}
    target_desc_map = {}
    
    if variable_objects:
        for var in variable_objects:
            name = var.get("nombre", "")
            aliases_map[name] = var.get("aliases", [name])
            target_units_map[name] = var.get("unidad", "")
            target_desc_map[name] = var.get("descripcion", "")
        print(f"[ANALYSIS] Aliases y unidades cargados desde memoria ({len(aliases_map)} variables)")
    elif discovery_path and os.path.exists(discovery_path):
        try:
            with open(discovery_path, 'r', encoding='utf-8') as f:
                discovery_data = json.load(f)
            for var in discovery_data.get("variables_encontradas", []):
                name = var.get("nombre", "")
                aliases_map[name] = var.get("aliases", [name])
                target_units_map[name] = var.get("unidad", "")
                target_desc_map[name] = var.get("descripcion", "")
            print(f"[ANALYSIS] Aliases cargados desde discovery cache")
        except Exception as e:
            print(f"[ANALYSIS] ⚠ No se pudieron cargar aliases: {e}")

    # Ensure every selected variable has at least itself as alias
    for var_name in selected_variables:
        if var_name not in aliases_map:
            aliases_map[var_name] = [var_name]


    registros_result = []

    for i, reg_text in enumerate(register_texts, 1):
        # Pre-filter: check which selected variables have at least one alias in this register
        # AND track which keyword matched
        reg_text_lower = reg_text.lower()
        vars_with_keywords = [] # list of (canonical_name, matched_keyword)
        for var_name in selected_variables:
            aliases = aliases_map.get(var_name, [var_name])
            
            # Prepare candidates: aliases as-is AND aliases with underscores replaced by spaces
            # We want to check them using regex boundaries: (?<![a-zA-Z])keyword(?![a-zA-Z])
            
            match_found = False
            for alias in aliases:
                candidates = [alias]
                if '_' in alias:
                    candidates.append(alias.replace('_', ' '))
                
                for cand in candidates:
                    # Escape special chars in candidate (e.g. +, ., -)
                    escaped_cand = re.escape(cand)
                    # Pattern: No letter before, Candidate, No letter after
                    # Case insensitive search
                    pattern = r'(?<![a-zA-Z])' + escaped_cand + r'(?![a-zA-Z])'
                    
                    if re.search(pattern, reg_text, re.IGNORECASE):
                        vars_with_keywords.append((var_name, cand))
                        match_found = True
                        break # Found a match for this alias variant
                
                if match_found:
                    break # Found a match for this variable, move to next variable

        if not vars_with_keywords:
            # print(f"[ANALYSIS] Fase 2: Registro {i}/{len(register_texts)} — sin keywords relevantes, saltando")
            registros_result.append({"registro": i, "valores": {}})
            continue

        var_names_found = [v[0] for v in vars_with_keywords]
        unique_var_names_found = sorted(list(set(var_names_found)))
        print(f"[ANALYSIS] Fase 2: Extrayendo registro {i}/{len(register_texts)}... ({len(unique_var_names_found)} variables candidatas: {unique_var_names_found})")

        # --- BATCH EXTRACTION: ONE CALL PER REGISTER ---
        
        # Build prompt listing ALL candidate variables found in this register
        vars_list_text = ""
        for canon_name in unique_var_names_found:
            target_unit = target_units_map.get(canon_name, "")
            target_desc = target_desc_map.get(canon_name, "")
            
            # Find which keyword matched (just for context, though we send all candidates)
            # We can pick the first matching keyword for this variable from vars_with_keywords
            # or just list the variable details.
            # To be precise, let's look up the keyword that triggered the match
            matched_kws = [k for v, k in vars_with_keywords if v == canon_name]
            kw_display = matched_kws[0] if matched_kws else "?"
            
            vars_list_text += f"- {canon_name} ({target_desc}) (unidad esperada: {target_unit}) (keyword encontrada: \"{kw_display}\")\n"

        register_prompt = prompt_template.replace("{VARIABLES_SOLICITADAS}", vars_list_text)

        register_values = {}
        
        try:
            response = client.chat.completions.create(
                model=model_path,
                messages=[
                    {"role": "system", "content": register_prompt},
                    {"role": "user", "content": reg_text}
                ],
                max_tokens=2048, # Increased for batch response
                temperature=0.0,
            )

            response_text = response.choices[0].message.content
            print(f"[ANALYSIS]   RAW Extracción Batch ({len(response_text)} chars):\n{response_text}") 
            result = extract_json_from_response(response_text)

            if result and "valores" in result:
                batch_values = result["valores"]
                
                # Iterate over EXTRACTED values
                for canon_name, val_data in batch_values.items():
                    # Sanity check: is this a variable we asked for?
                    if canon_name not in unique_var_names_found:
                        continue
                        
                    val = val_data.get("valor")
                    
                    # --- UNIT NORMALIZATION (Python Safeguard) ---
                    try:
                        unit = val_data.get("unidad", "").lower().strip()
                        # Diuresis: Liters -> cc
                        if canon_name in ["diuresis", "volumen_orina"] and isinstance(val, (int, float)):
                            if "l" == unit or "litro" in unit or "litros" in unit:
                                if val < 30: # Heuristic: <30 likely Liters, >30 likely cc
                                    print(f"[ANALYSIS]     ⚠ Conversión: {val} {unit} -> {val*1000} cc")
                                    val = val * 1000
                                    val_data["valor"] = val
                                    val_data["unidad"] = "cc"
                    except Exception as e:
                        pass
                    # ---------------------------------------------
                    
                    # Filter out None, 0, "0", "None", "null"
                    if val is None:
                        continue
                    if isinstance(val, str):
                        if val.lower().strip() in ["none", "null", "nan", "0", "0.0", ""]:
                            continue
                    if isinstance(val, (int, float)):
                        if val == 0:
                            continue

                    # --- CONFIRMATION STEP (Auditor) ---
                    # Performed INDIVIDUALLY for safety
                    try:
                        confirm_prompt_template = load_prompt('Confirmacion_valor.txt')
                        confirm_msg = confirm_prompt_template.replace('{VARIABLE}', canon_name)\
                                                             .replace('{VALOR}', str(val))\
                                                             .replace('{UNIDAD}', str(val_data.get('unidad', '')))\
                                                             .replace('{TEXTO_REGISTRO}', reg_text)
                        
                        audit_response = client.chat.completions.create(
                            model=model_path,
                            messages=[
                                {"role": "system", "content": "Eres un auditor estricto."},
                                {"role": "user", "content": confirm_msg}
                            ],
                            max_tokens=10,
                            temperature=0.0,
                        )
                        audit_result = audit_response.choices[0].message.content.strip().upper()
                        print(f"[ANALYSIS]   RAW Auditoría ({canon_name}):\n{audit_result}") 
                        
                        if "INCORRECTO" in audit_result:
                            # print(f"[ANALYSIS]   ⚠ AUDITORÍA: Valor DESCARTADO: {val} para {canon_name}")
                            continue # Skip this value
                            
                    except Exception as e:
                        print(f"[ANALYSIS]   Error en auditoría: {e}")
                    # -----------------------------------
                        
                    register_values[canon_name] = val_data
                    print(f"[ANALYSIS]     -> {canon_name}: {val} {val_data.get('unidad', '')}")

        except Exception as e:
            print(f"[ANALYSIS]   ERROR en extracción batch registro {i}: {e}")
            if 'response_text' in locals():
                 print(f"[ANALYSIS]   Respuesta parcial batch:\n{response_text}")

        registros_result.append({
            "registro": i,
            "valores": register_values
        })
        
        if register_values:
            print(f"[ANALYSIS]   Registro {i}: encontró {list(register_values.keys())}")
        else:
            # optional debug
            pass

    print(f"[ANALYSIS] ✓ Fase 2 completada: {len(registros_result)} registros procesados")
    return {"registros": registros_result}


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
        result = phase_discover(register_texts, client, model_path, output_path=args.output)
    elif args.phase == 'extract':
        if not args.variables:
            print("[ANALYSIS] ERROR: --variables requerido para fase extract")
            sys.exit(1)
            
        selected = [v.strip() for v in args.variables.split(',') if v.strip()]
        
        # Check if pre-computed file exists (created by discover phase)
        # args.output matches the path where discover saved the side-effect extract file
        if os.path.exists(args.output) and os.path.getsize(args.output) > 10:
            print(f"[ANALYSIS] Detectada extracción pre-computada en {args.output}")
            try:
                with open(args.output, 'r', encoding='utf-8') as f:
                    full_data = json.load(f)
                
                filtered_result = {"registros": []}
                for reg in full_data.get("registros", []):
                    new_vals = {}
                    for k, v in reg.get("valores", {}).items():
                        if k in selected:
                            new_vals[k] = v
                    filtered_result["registros"].append({"registro": reg["registro"], "valores": new_vals})
                
                result = filtered_result
                print(f"[ANALYSIS] ✓ Usando datos pre-computados ({len(selected)} variables seleccionadas)")
                
            except Exception as e:
                print(f"[ANALYSIS] ⚠ Error leyendo pre-computación: {e}. Reintentando extracción manual...")
                discovery_path = args.output.replace('_analysis_extract.json', '_analysis_discovery.json')
                result = phase_extract(register_texts, selected, client, model_path, discovery_path)
        else:
            # Fallback legacy
            print(f"[ANALYSIS] Iniciando extracción bajo demanda (no pre-computada)...")
            discovery_path = args.output.replace('_analysis_extract.json', '_analysis_discovery.json')
            result = phase_extract(register_texts, selected, client, model_path, discovery_path)

    # Write output
    with open(args.output, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"[ANALYSIS] ✓ Resultado escrito en: {args.output}")


if __name__ == '__main__':
    main()
