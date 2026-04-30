"""Full pipeline test for local medication detection with compound search."""
import os, sys, re
core_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, core_dir)
from utils.buscador_medicamentos import BuscadorMedicamentos
from utils.buscador_abreviaciones import BuscadorAbreviaciones

bm = BuscadorMedicamentos(os.path.join(core_dir, 'dataset', 'medicamentos.json'))
ba = BuscadorAbreviaciones(os.path.join(core_dir, 'dataset', 'abreviaciones.csv'))


def detectar_medicamentos_local(texto, buscador_medicamentos, buscador_abreviaciones):
    """Mirrors the production code in seccionado.py exactly."""
    dosage_pattern = re.compile(r'\d+[\.,/]?\d*\s*(mg|g|ml|UI|mcg|µg|ug)\b', re.IGNORECASE)
    prescription_marker = re.compile(r'^\s*[\*]{2}|^\s*[\-]\s+[A-ZÁÉÍÓÚÑ]')
    marker_pattern = re.compile(r'^\s*[\*\-]+\s*')
    skip_line_patterns = re.compile(
        r'^\s*$|^MEDICACI[ÓO]N|^RESTO\s+DE|^Dieta\b|^Movilizaci[oó]n\b'
        r'|^Ox[ií]geno\b|^Tratamiento\s*$|^implante\b|^comida\b|^\d+[\s\-]',
        re.IGNORECASE
    )
    stop_words = {
        'control', 'seguimiento', 'retirada', 'tolerancia', 'cita',
        'empeoramiento', 'desayuno', 'comida', 'cena', 'noche',
        'comprimido', 'comprimidos', 'pastilla', 'pastillas',
        'horas', 'dias', 'diarias', 'diario', 'semanal',
        'sueño', 'descanso', 'reposo', 'andador', 'nasales',
        'gafas', 'marcapasos', 'electrodo', 'implante',
        'edemas', 'disnea', 'astenia', 'ingreso', 'alta',
        'sal', 'litro', 'litros', 'mes', 'dia', 'semana',
        'beber', 'evitar', 'acudir', 'revisar', 'subir',
        'bajar', 'mantener', 'suspender', 'igual', 'resto',
    }
    sigla_pattern = re.compile(r'^[A-ZÁÉÍÓÚÑ]{2,5}$')
    MIN_SCORE = 80

    medicamentos_encontrados = {}
    candidatas_vistas = set()
    lines = texto.strip().split('\n')

    for line in lines:
        line = line.strip()
        if not line:
            continue
        has_marker = bool(prescription_marker.match(line))
        has_dose = bool(dosage_pattern.search(line))

        clean = marker_pattern.sub('', line).strip()
        clean = re.sub(r'^SUSPENDER\s+', '', clean, flags=re.IGNORECASE).strip()
        if not clean or len(clean) < 3:
            continue
        if skip_line_patterns.match(clean):
            continue

        is_short_name = len(clean.split()) <= 3 and not any(c.isdigit() for c in clean.split()[-1]) if clean.split() else False
        if not has_marker and not has_dose and not is_short_name:
            continue

        dose_match = dosage_pattern.search(clean)
        if dose_match:
            nombre_raw = clean[:dose_match.start()].strip().rstrip(',').strip()
        else:
            nombre_raw = re.split(
                r'\bseg[uú]n\b|\bigual\b|\bal menos\b|\bdurante\b|\ben gafas\b|\bun comprimido\b|\bcada\b',
                clean, flags=re.IGNORECASE
            )[0].strip().rstrip('.').strip()

        if not nombre_raw or len(nombre_raw) < 2:
            continue

        sub_nombres = [n.strip().rstrip('.').strip() for n in nombre_raw.split('.') if n.strip()]

        for nombre in sub_nombres:
            if not nombre or len(nombre) < 2 or len(nombre) > 40 or len(nombre.split()) > 4:
                continue

            if '/' in nombre:
                partes_nombre = []
                for parte in nombre.split('/'):
                    parte = parte.strip()
                    if re.match(r'^\d+[\.,]?\d*\s*(mg|g|ml|UI)?$', parte, re.IGNORECASE):
                        continue
                    parte = re.sub(r'\s+\d+[\.,]?\d*\s*$', '', parte).strip()
                    if parte and len(parte) >= 2:
                        if sigla_pattern.match(parte):
                            expansion = buscador_abreviaciones.buscar_abreviacion(parte)
                            if expansion:
                                exp_text = expansion[0] if isinstance(expansion, list) else expansion
                                parte = exp_text.split('.')[0].strip()
                                print(f"  📋 Sigla → '{parte}'")
                        partes_nombre.append(parte)

                # COMPOUND SEARCH: PA-first resolution with difflib (matches production)
                if len(partes_nombre) >= 2:
                    try:
                        from difflib import get_close_matches, SequenceMatcher
                        
                        # Build PA base-name index
                        pa_index = {}
                        for pa in buscador_medicamentos.principios_activos:
                            base = buscador_medicamentos.quitar_tildes(pa.split()[0].lower())
                            if base not in pa_index:
                                pa_index[base] = pa
                        
                        # Resolve each component to canonical PA
                        pas_resueltos = []
                        todos_resueltos = True
                        for comp in partes_nombre:
                            comp_norm = buscador_medicamentos.quitar_tildes(comp.lower().strip())
                            if comp_norm in pa_index:
                                pas_resueltos.append(pa_index[comp_norm])
                                print(f"  🔍 '{comp}' → PA: '{pa_index[comp_norm]}' (exacto)")
                                continue
                            matches = get_close_matches(comp_norm, pa_index.keys(), n=1, cutoff=0.7)
                            if matches:
                                ratio = SequenceMatcher(None, comp_norm, matches[0]).ratio()
                                pas_resueltos.append(pa_index[matches[0]])
                                print(f"  🔍 '{comp}' → PA: '{pa_index[matches[0]]}' (ratio={ratio:.2f})")
                            else:
                                print(f"  ❌ '{comp}' sin PA match")
                                todos_resueltos = False
                                break
                        
                        if todos_resueltos and len(pas_resueltos) >= 2:
                            n_componentes = len(pas_resueltos)
                            candidatos = []
                            for mid, entry in buscador_medicamentos.data_med.items():
                                entry_pas = {pa.lower() for pa in entry['principiosActivos']}
                                if len(entry['principiosActivos']) == n_componentes:
                                    if all(pa_r in entry_pas for pa_r in pas_resueltos):
                                        candidatos.append(entry)
                            
                            if candidatos:
                                pas_lower = set(pas_resueltos)
                                marca = None
                                for c in candidatos:
                                    llm = buscador_medicamentos.quitar_tildes(c.get('nombre_LLM', '').lower())
                                    if not any(pa in llm for pa in pas_lower):
                                        marca = c
                                        break
                                
                                resultado = marca if marca else candidatos[0]
                                nombre_llm = resultado.get('nombre_LLM', '')
                                nombre_compuesto = '/'.join(partes_nombre)
                                if nombre_llm and nombre_compuesto.lower() not in candidatas_vistas:
                                    candidatas_vistas.add(nombre_compuesto.lower())
                                    medicamentos_encontrados[nombre_compuesto] = resultado
                                    print(f"  ✅ COMPUESTO '{nombre_compuesto}' → {nombre_llm} (PA: {', '.join(resultado['principiosActivos'])})")
                                    continue
                    except Exception as e:
                        print(f"  ⚠️  Compound search failed: {e}")
                    print(f"  ⚠️  Compuesto no encontrado, buscando individual...")
            else:
                partes_nombre = [nombre]

            for candidata in partes_nombre:
                candidata = candidata.strip()
                if not candidata or len(candidata) < 2:
                    continue
                candidata_lower = candidata.lower()
                if candidata_lower in candidatas_vistas or candidata_lower in stop_words:
                    continue
                candidatas_vistas.add(candidata_lower)

                candidatas_busqueda = []
                if sigla_pattern.match(candidata):
                    expansion = buscador_abreviaciones.buscar_abreviacion(candidata)
                    if expansion:
                        exp_text = expansion[0] if isinstance(expansion, list) else expansion
                        candidatas_busqueda.append(exp_text.split('.')[0].strip())
                    else:
                        continue
                else:
                    candidatas_busqueda.append(candidata)

                for busqueda in candidatas_busqueda:
                    try:
                        match_result, _ = buscador_medicamentos.buscar_medicamento(busqueda)
                        if not match_result or match_result.get('score', 0) < MIN_SCORE:
                            continue
                        score = match_result['score']
                        ids = match_result.get('ids', [])
                        if not ids:
                            continue
                        resultado = buscador_medicamentos.mejor_coincidencia([busqueda.lower()])
                        if resultado is None:
                            first_id = ids[0] if isinstance(ids, list) else ids
                            resultado = buscador_medicamentos.data_med.get(first_id)
                        if resultado:
                            nombre_llm = resultado.get('nombre_LLM', '')
                            if nombre_llm and nombre_llm.lower() not in [m.get('nombre_LLM', '').lower() for m in medicamentos_encontrados.values()]:
                                medicamentos_encontrados[candidata] = resultado
                                print(f"  ✅ '{candidata}' → {nombre_llm} (score={score})")
                        break
                    except Exception as e:
                        print(f"  ❌ Error: {e}")

    return medicamentos_encontrados


EJEMPLO_1 = """Tratamiento
Apixabán 5 mg 1-0-1
Bisoprolol 2.5 mg 1-0-0
Espironolactona 5mg 0-1-0
Furosemida 40 mg, 1-1/2-0; a manejar en función de síntomas congestivos.
Olmesartán/Amlodipino/HCT 40/10/12.5mg 1-0-0
Metfromina/Empaglifozina 1000/5mg 1-0-1
Atorvastatina/Ezetimiba 40/10mg 0-0-1
Alopurinol 100mg 0-1-0
Nexium 40 mg, 1-0-0
Acetilcisteína. Spiriva igual."""

EJEMPLO_2 = """Tratamiento
Dieta sin sal. Beber un litro de líquidos diarios máximo.
Movilización con andador según tolerancia.
MEDICACIÓN:
**SUSPENDER Olmesartan/amlodipino/HCT 40/10/25 mg
**SUSPENDER Furosemida/triamtereno 77.6/25 mg
MEDICACIÓN:
**Oxigeno en gafas nasales a 1.5 litros durante 16 horas diarias (sueño y descanso) al menos hasta
implante de TAVI.
** Ácido acetilsalicílico 100 mg cada 24 horas
** Losartán 100 mg un comprimido cada 24 horas en desayuno
** Carvedilol 25 mg un comprimido en desayuno y medio en cena
**Atorvastatina 20 mg cada 24 horas en cena
**Seguril 40 mg 2 comprimidos en desayuno y 1 comprimido en comida (subir a dos comprimidos en
comida si empeoramiento)
RESTO DE MEDICACIÓN IGUAL:
- Insulina Levemir 56 UI cada 24 horas
- Rifaximina 200 mg cada 24 horas
- Omeprazol 40 mg cada 24 horas
- Ácido ibandrónico
- Calcio"""

print("=" * 70)
print("EJEMPLO 1")
print("=" * 70)
r1 = detectar_medicamentos_local(EJEMPLO_1, bm, ba)
print(f"\n📊 Total: {len(r1)}")
for n, i in r1.items():
    print(f"  • {n} → {i['nombre_LLM']} | PA: {', '.join(i['principiosActivos'])}")

print(f"\n{'=' * 70}")
print("EJEMPLO 2")
print("=" * 70)
r2 = detectar_medicamentos_local(EJEMPLO_2, bm, ba)
print(f"\n📊 Total: {len(r2)}")
for n, i in r2.items():
    print(f"  • {n} → {i['nombre_LLM']} | PA: {', '.join(i['principiosActivos'])}")

print(f"\n{'=' * 70}")
print("RESUMEN")
print("=" * 70)
print(f"Ej1: {len(r1)} medicamentos | Ej2: {len(r2)} medicamentos")
