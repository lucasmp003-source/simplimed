/* annotation.js */

if (!authManager.isAuthenticated()) {
    window.urlHelper.navigateTo('/login');
}

let abbreviations = {};
let processedData = [];
let currentAbbrIndex = null;

function getCsrfToken() {
    return document.querySelector('meta[name="csrf-token"]')?.content || '';
}

function getElement(id) {
    const el = document.getElementById(id);
    if (!el) console.warn(`No element with id ${id}`);
    return el;
}

window.addEventListener('DOMContentLoaded', async () => {
    try {
        const r = await window.urlHelper.fetchWithBasePath('/api/annotation/abreviaciones');
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        if (!data.success) throw new Error(data.error || 'No data');
        abbreviations = data.abbreviations || {};

        // Cargar el primer texto de la cola una vez cargado el diccionario
        fetchNextText();
    } catch (e) {
        console.error('Error cargando diccionario:', e);
        const queueStatus = getElement('queue-status');
        if (queueStatus) queueStatus.textContent = 'Error cargando diccionario';
    }
});

async function fetchNextText() {
    const out = getElement('tokenizedText');
    const saveBtn = getElement('saveNextBtn');
    const emptyMsg = getElement('empty-queue-message');
    const queueStatus = getElement('queue-status');

    if (!out || !saveBtn || !emptyMsg) return;

    out.style.display = 'block';
    emptyMsg.style.display = 'none';
    saveBtn.style.display = 'block';
    saveBtn.disabled = true;
    saveBtn.textContent = 'Guardar y Siguiente';
    out.textContent = 'Buscando siguiente texto en la cola...';
    if (queueStatus) queueStatus.textContent = 'Buscando...';

    try {
        const r = await window.urlHelper.fetchWithBasePath('/api/annotation/next');
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();

        if (data.progress) {
            updateProgressUI(data.progress);
        }

        if (data.empty) {
            out.style.display = 'none';
            saveBtn.style.display = 'none';
            emptyMsg.style.display = 'block';
            if (queueStatus) queueStatus.textContent = 'Cola vacía';
            return;
        }

        if (!data.success) throw new Error(data.error || 'Error server');

        getElement('currentFileName').value = data.filename;
        getElement('currentDocId').value = data.docId;
        getElement('currentOriginalText').value = data.originalText;
        if (queueStatus) queueStatus.textContent = `Archivo: ${data.filename}`;

        processedData = data.tokens.map(t => {
            if (t.type === 'abbreviation') {
                let selected = null;
                let isAuto = false;
                if (t.options && t.options.length === 1) {
                    selected = t.options[0].meaning;
                    isAuto = true;
                }
                return { ...t, selected: selected, isAuto: isAuto };
            }
            return t;
        });

        renderTokens(processedData);
    } catch (e) {
        out.textContent = `Error al cargar siguiente texto: ${e.message}`;
        console.error('fetchNextText error', e);
        if (queueStatus) queueStatus.textContent = 'Error';
    }
}

function updateProgressUI(progress) {
    const progressText = getElement('progress-text');
    const progressBarFill = getElement('progress-bar-fill');
    
    if (progressText && progressBarFill) {
        const { annotated, total } = progress;
        progressText.textContent = `${annotated} / ${total} anotados`;
        
        let percentage = 0;
        if (total > 0) {
            percentage = (annotated / total) * 100;
        }
        
        progressBarFill.style.width = `${percentage}%`;
        
        // Change color based on completion
        if (percentage === 100) {
            progressBarFill.style.backgroundColor = '#28a745'; // Green
        } else {
            progressBarFill.style.backgroundColor = '#007bff'; // Blue
        }
    }
}

function renderTokens(tokens) {
    const container = getElement('tokenizedText');
    if (!container) return;
    container.innerHTML = '';

    tokens.forEach(token => {
        if (token.type === 'abbreviation') {
            const span = document.createElement('span');
            span.classList.add('abbreviation');

            const disp = (token.text || '').replace(/\r/g, '');
            span.textContent = disp;
            span.dataset.index = token.index;

            if (token.selected === 'IGNORAR') {
                span.classList.add('ignored');
            } else if (token.selected) {
                if (token.isAuto) {
                    span.classList.add('auto-selected');
                    span.title = "Automático (Única opción) - Haz clic para confirmar";
                } else {
                    span.classList.add('selected');
                }
            } else if (token.options && token.options.length > 0) {
                span.classList.add('pending');
            }

            span.addEventListener('click', () => openModalForIndex(token.index));
            container.appendChild(span);
        } else {
            container.appendChild(document.createTextNode((token.text || '').replace(/\r/g, '')));
        }
    });

    container.onmouseup = () => {
        const sel = window.getSelection().toString().trim();
        if (sel) {
            // Permitir seleccionar cualquier texto corto para añadirlo como abreviación (no solo mayúsculas/puntos)
            const isPotentialAbbr = sel.length > 0 && sel.length <= 30;
            if (isPotentialAbbr) {
                showAddNewModal(sel);
            }
        }
    };

    const saveBtn = getElement('saveNextBtn');
    if (saveBtn) saveBtn.disabled = !tokens.some(t => t.type === 'abbreviation' && t.selected && t.selected !== 'IGNORAR');
}

function openModalForIndex(index) {
    const modal = getElement('modal');
    const options = getElement('optionsContainer');
    const modalText = getElement('modalAbbrText');
    const selectBtn = getElement('selectContextBtn');
    if (!modal || !options || !modalText || !selectBtn) return;

    const token = processedData.find(t => t.type === 'abbreviation' && t.index === index);
    if (!token) return;
    currentAbbrIndex = index;

    modalText.textContent = token.clean;
    options.innerHTML = '';
    const opts = (token.options || []);

    opts.forEach(opt => {
        const div = document.createElement('div');
        div.className = 'option';
        div.innerHTML = `<p style="font-weight:600;">${opt.meaning}</p>` + (opt.context === 'SI' ? '<span style="font-size:12px; background:#457b9d; color:white; padding:2px 6px; border-radius:4px; margin-left:10px;">Facultativo</span>' : '');
        div.addEventListener('click', () => {
            token.selected = opt.meaning;
            token.isAuto = false;
            renderTokens(processedData);
            modal.style.display = 'none';
        });
        options.appendChild(div);
    });

    const customDiv = document.createElement('div');
    customDiv.style.marginTop = '15px';
    customDiv.innerHTML = `<label style='display:block; font-weight:600; margin-bottom:5px;'>Añadir definición:</label><input id='modalCustomMeaning' style='width:100%; padding:10px; border:1px solid #ccc; border-radius:4px;' placeholder='Nueva definición...'>`;
    options.appendChild(customDiv);

    selectBtn.textContent = 'Guardar otra definición';
    selectBtn.disabled = true;

    setTimeout(() => {
        const inputEl = document.getElementById('modalCustomMeaning');
        if (inputEl) {
            inputEl.addEventListener('input', () => {
                selectBtn.disabled = !(inputEl.value && inputEl.value.trim().length > 0);
            });
            inputEl.addEventListener('keydown', async (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (!selectBtn.disabled) selectBtn.click();
                }
            });
        }
    }, 0);

    selectBtn.onclick = async () => {
        const custom = getElement('modalCustomMeaning').value.trim();
        if (!custom) return;
        const res = await addNewAbbreviation(token.clean, custom, true);
        if (res && res.success) {
            token.selected = custom;
            token.isAuto = false;
            renderTokens(processedData);
            modal.style.display = 'none';
        }
    };

    getElement('selectIgnoreBtn').onclick = () => {
        token.selected = 'IGNORAR';
        token.isAuto = false;
        renderTokens(processedData);
        modal.style.display = 'none';
    };

    modal.style.display = 'flex';
}

function showAddNewModal(selectedText) {
    const modal = getElement('modal');
    const options = getElement('optionsContainer');
    const modalText = getElement('modalAbbrText');
    const selectBtn = getElement('selectContextBtn');
    if (!modal || !options || !modalText || !selectBtn) return;

    modalText.textContent = selectedText;
    options.innerHTML = '';

    const customDiv = document.createElement('div');
    customDiv.innerHTML = `<label style='display:block; font-weight:600; margin-bottom:5px;'>Definición para "${selectedText}":</label><input id='modalCustomMeaning' style='width:100%; padding:10px; border:1px solid #ccc; border-radius:4px;' placeholder='Definición...'/>`;
    options.appendChild(customDiv);

    selectBtn.textContent = 'Guardar definición';
    selectBtn.disabled = true;
    setTimeout(() => {
        const inputEl = document.getElementById('modalCustomMeaning');
        if (inputEl) {
            inputEl.addEventListener('input', () => {
                selectBtn.disabled = !(inputEl.value && inputEl.value.trim().length > 0);
            });
            inputEl.addEventListener('keydown', async (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (!selectBtn.disabled) selectBtn.click();
                }
            });
        }
    }, 0);

    selectBtn.onclick = async () => {
        const custom = getElement('modalCustomMeaning').value.trim();
        if (!custom) return;
        const res = await addNewAbbreviation(selectedText, custom, true);
        if (res && res.success) {
            // Actualizar tokens en processedData
            const selectedLc = selectedText.trim().toLowerCase();
            let newProcessedData = [];
            
            processedData.forEach(t => {
                if (t.type === 'text') {
                    // Dividir nodo de texto si contiene la abreviatura (case insensitive)
                    let rawText = t.text;
                    let startIndex = 0;
                    let matchIndex;
                    while ((matchIndex = rawText.toLowerCase().indexOf(selectedLc, startIndex)) !== -1) {
                        // Extraer el texto original que emparejó
                        const matchedOriginalText = rawText.substring(matchIndex, matchIndex + selectedLc.length);
                        
                        // Validar límites de palabra (opcional, pero ayuda a evitar falsos positivos dentro de otras palabras largas)
                        // Por ahora lo hacemos simple, convertimos la selección exacta
                        if (matchIndex > startIndex) {
                            newProcessedData.push({ type: 'text', text: rawText.substring(startIndex, matchIndex) });
                        }
                        
                        newProcessedData.push({
                            type: 'abbreviation',
                            text: matchedOriginalText,
                            clean: selectedText,
                            index: Date.now() + Math.random(), // fake index para que funcione el click
                            options: [{meaning: custom}],
                            selected: custom,
                            isAuto: true
                        });
                        
                        startIndex = matchIndex + selectedLc.length;
                    }
                    if (startIndex < rawText.length) {
                        newProcessedData.push({ type: 'text', text: rawText.substring(startIndex) });
                    }
                } else if (t.type === 'abbreviation') {
                    const cleanLc = ((t.clean || t.text || '') + '').trim().toLowerCase();
                    if (cleanLc === selectedLc || cleanLc.includes(selectedLc) || selectedLc.includes(cleanLc)) {
                        t.selected = custom;
                        t.isAuto = false;
                        if (!t.options) t.options = [];
                        t.options.push({meaning: custom});
                    }
                    newProcessedData.push(t);
                } else {
                    newProcessedData.push(t);
                }
            });
            
            processedData = newProcessedData;
            renderTokens(processedData);
            modal.style.display = 'none';
        }
    };

    getElement('selectIgnoreBtn').onclick = () => modal.style.display = 'none';
    modal.style.display = 'flex';
}

async function addNewAbbreviation(abbr, meaning, facultativoFlag = false) {
    try {
        const r = await window.urlHelper.fetchWithBasePath('/api/annotation/add-abbreviation', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': getCsrfToken()
            },
            body: JSON.stringify({ abbreviation: abbr, meaning: meaning })
        });
        if (!r.ok) {
            const text = await r.text();
            throw new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`);
        }
        const data = await r.json();
        if (!data.success) throw new Error(data.error || 'Error añadiendo abreviación');

        if (!abbreviations[abbr]) abbreviations[abbr] = [];
        abbreviations[abbr].push({ meaning: meaning, context: facultativoFlag ? 'SI' : '' });
        return { success: true };
    } catch (e) {
        console.error('Error al añadir abreviación', e);
        alert('Error al añadir abreviación: ' + e.message);
        return { success: false, error: e.message };
    }
}

async function saveAndNext() {
    const docid = getElement('currentDocId').value;
    const filename = getElement('currentFileName').value;
    const text = getElement('currentOriginalText').value;
    const abbreviationsOut = [];
    let searchIndex = 0;

    const saveBtn = getElement('saveNextBtn');
    const oldBtnText = saveBtn.textContent;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Guardando...';

    processedData.forEach(token => {
        let tokenText = (token.clean || token.text || '').trim();

        if (!tokenText) {
            while (searchIndex < text.length && /\s/.test(text[searchIndex])) {
                searchIndex++;
            }
            return;
        }

        const foundAt = text.indexOf(tokenText, searchIndex);

        if (foundAt !== -1) {
            const char_begin = foundAt;
            const char_end = foundAt + tokenText.length;
            searchIndex = char_end;

            if (token.type === 'abbreviation' && token.selected && token.selected !== 'IGNORAR') {
                abbreviationsOut.push({
                    char_begin: char_begin,
                    char_end: char_end,
                    text: tokenText,
                    meaning: token.selected
                });
            }
        }
    });

    try {
        const r = await window.urlHelper.fetchWithBasePath('/api/annotation/save', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': getCsrfToken()
            },
            body: JSON.stringify({ docid, filename, text, abbreviations: abbreviationsOut })
        });

        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        if (!data.success) throw new Error(data.error || 'Error saving file');

        // Immediately fetch next
        fetchNextText();
    } catch (e) {
        console.error('Error saving and next', e);
        alert('Error al guardar: ' + e.message);
        saveBtn.disabled = false;
        saveBtn.textContent = oldBtnText;
    }
}

(() => {
    const saveBtn = document.getElementById('saveNextBtn');
    if (saveBtn) saveBtn.addEventListener('click', saveAndNext);

    document.querySelectorAll('.close').forEach(b => b.addEventListener('click', () => {
        const m = getElement('modal'); if (m) m.style.display = 'none';
    }));

    window.addEventListener('click', (e) => { if (e.target.classList && e.target.classList.contains('modal')) e.target.style.display = 'none'; });
})();
