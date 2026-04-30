const express = require('express');
const fs = require('fs');
const path = require('path');

function parseCSV(content) {
    const lines = content.split(/\r?\n/);
    if (lines.length === 0) return { records: [], headers: [] };
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const records = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;

        // simple parsing supporting inner quotes
        let cols = [];
        let inQuote = false;
        let curr = '';
        for (let j = 0; j < line.length; j++) {
            if (line[j] === '"') {
                inQuote = !inQuote;
            } else if (line[j] === ',' && !inQuote) {
                cols.push(curr);
                curr = '';
            } else {
                curr += line[j];
            }
        }
        cols.push(curr);

        const record = {};
        headers.forEach((h, idx) => {
            record[h] = cols[idx] ? cols[idx].replace(/^"|"$/g, '').trim() : '';
        });
        records.push(record);
    }
    return { records, headers };
}

module.exports = function (deps) {
    const router = express.Router();
    const { requireServerAuth, requireDoctorOrAdminRole } = deps.authMiddleware;
    const csvPath = path.join(__dirname, '../../data/abreviaciones.csv');

    let abbreviationsDb = {};

    // In-memory lock system preventing concurrent annotations on the same file
    // Map of filename -> { lockedBy: userId, lockedAt: timestamp }
    const fileLocks = new Map();
    const LOCK_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

    // Helper to cleanup expired locks
    function cleanupLocks() {
        const now = Date.now();
        for (const [filename, lockInfo] of fileLocks.entries()) {
            if (now - lockInfo.lockedAt > LOCK_TIMEOUT_MS) {
                fileLocks.delete(filename);
            }
        }
    }

    function loadAbbreviations() {
        abbreviationsDb = {};
        if (!fs.existsSync(csvPath)) {
            return { count: 0, totalDefinitions: 0 };
        }

        let content = fs.readFileSync(csvPath, 'utf8');
        if (content.charCodeAt(0) === 0xFEFF) {
            content = content.slice(1);
        }

        const { records } = parseCSV(content);

        let count = 0;
        records.forEach(row => {
            const abbr = row['abreviacion'] || row['Abreviacion'];
            const meaning = row['definicion'] || row['Definicion'];
            const context = row['facultativo'] || row['Facultativo'] || '';

            if (abbr && meaning) {
                if (!abbreviationsDb[abbr]) {
                    abbreviationsDb[abbr] = [];
                    count++;
                }
                abbreviationsDb[abbr].push({ meaning, context });
            }
        });

        return { count, totalDefinitions: records.length };
    }

    router.get('/abreviaciones', requireServerAuth, requireDoctorOrAdminRole, (req, res) => {
        try {
            if (!fs.existsSync(csvPath)) {
                return res.status(404).json({
                    success: false,
                    error: 'No se encontró el archivo abreviaciones.csv en el servidor.'
                });
            }
            const stats = loadAbbreviations();
            res.json({
                success: true,
                message: `Cargadas ${stats.count} abreviaciones únicas.`,
                abbreviations: abbreviationsDb
            });
        } catch (error) {
            console.error('[Annotation API] Error loading CSV:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.post('/process-text', requireServerAuth, requireDoctorOrAdminRole, (req, res) => {
        try {
            if (Object.keys(abbreviationsDb).length === 0) {
                loadAbbreviations();
            }

            const text = req.body.text || '';
            if (!text) {
                return res.status(400).json({ error: 'No se proporcionó texto' });
            }

            const normalizedText = text.replace(/\r/g, '');

            const words = [];
            let currentWord = '';

            for (let i = 0; i < normalizedText.length; i++) {
                const char = normalizedText[i];
                if (' \t\n'.includes(char)) {
                    if (currentWord) {
                        words.push(currentWord);
                        currentWord = '';
                    }
                    if ('\n\t'.includes(char)) {
                        words.push(' ');
                    } else {
                        words.push(char);
                    }
                } else {
                    currentWord += char;
                }
            }
            if (currentWord) {
                words.push(currentWord);
            }

            const result = [];
            let abbrIndex = 0;

            words.forEach(word => {
                const cleanWord = word.replace(/^[.,;:\!\?\(\)]+|[.,;:\!\?\(\)]+$/g, '');

                let finalWord = word;
                if (!cleanWord && ('\n\t'.includes(word))) {
                    finalWord = ' ';
                }

                if (cleanWord && abbreviationsDb[cleanWord]) {
                    result.push({
                        type: 'abbreviation',
                        text: finalWord,
                        clean: cleanWord,
                        index: abbrIndex,
                        options: abbreviationsDb[cleanWord]
                    });
                    abbrIndex++;
                } else {
                    result.push({
                        type: 'text',
                        text: finalWord
                    });
                }
            });

            res.json({
                success: true,
                tokens: result
            });

        } catch (error) {
            console.error('[Annotation API] Error processing text:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/add-abbreviation', requireServerAuth, requireDoctorOrAdminRole, (req, res) => {
        try {
            const abbr = (req.body.abbreviation || '').trim();
            const meaning = (req.body.meaning || '').trim();

            if (!abbr || !meaning) {
                return res.status(400).json({ success: false, error: 'Faltan campos abbreviation o meaning' });
            }

            if (!fs.existsSync(csvPath)) {
                fs.writeFileSync(csvPath, 'Abreviacion,Definicion,Facultativo\n', 'utf8');
            }

            const existingMeanings = abbreviationsDb[abbr] ? abbreviationsDb[abbr].map(m => m.meaning) : [];
            if (existingMeanings.includes(meaning)) {
                return res.json({ success: true, message: 'Definición ya existente' });
            }

            const escapedMeaning = meaning.includes(',') ? `"${meaning.replace(/"/g, '""')}"` : meaning;
            const escapedAbbr = abbr.includes(',') ? `"${abbr.replace(/"/g, '""')}"` : abbr;
            fs.appendFileSync(csvPath, `${escapedAbbr},${escapedMeaning},SI\n`);

            if (!abbreviationsDb[abbr]) abbreviationsDb[abbr] = [];
            abbreviationsDb[abbr].push({ meaning, context: '' });

            res.json({ success: true, message: 'Añadida correctamente' });
        } catch (error) {
            console.error('[Annotation API] Error adding abbreviation:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // --- QUEUE SYSTEM ENDPOINTS ---

    const toAnnotateDir = path.join(__dirname, '../../data/ToAnnotate');
    const annotatedDir = path.join(__dirname, '../../data/Annotated');

    // Helper: Ensure directories exist
    function ensureDirs() {
        if (!fs.existsSync(toAnnotateDir)) fs.mkdirSync(toAnnotateDir, { recursive: true });
        if (!fs.existsSync(annotatedDir)) fs.mkdirSync(annotatedDir, { recursive: true });
    }

    router.get('/next', requireServerAuth, requireDoctorOrAdminRole, (req, res) => {
        try {
            ensureDirs();

            // Re-load abbreviations just in case it's empty
            if (Object.keys(abbreviationsDb).length === 0) {
                loadAbbreviations();
            }

            cleanupLocks();

            // Find first file in ToAnnotate
            const files = fs.readdirSync(toAnnotateDir);
            const pendingFiles = files.filter(f => f.endsWith('.txt') || f.endsWith('.json'));

            // Count annotated files
            const annotatedFiles = fs.readdirSync(annotatedDir).filter(f => f.endsWith('.txt') || f.endsWith('.json'));
            const annotatedCount = annotatedFiles.length;
            const pendingCount = pendingFiles.length;
            const totalFiles = annotatedCount + pendingCount;

            if (pendingFiles.length === 0) {
                return res.json({ success: true, empty: true, message: 'No hay más textos pendientes en la cola.', progress: { annotated: annotatedCount, total: totalFiles, pending: pendingCount } });
            }

            let activeFile = null;
            const userId = req.user.id;

            // Check if user already has a lock on a file
            for (const [filename, lockInfo] of fileLocks.entries()) {
                if (lockInfo.lockedBy === userId && pendingFiles.includes(filename)) {
                    activeFile = filename;
                    // Refresh lock
                    lockInfo.lockedAt = Date.now();
                    break;
                }
            }

            // If no existing lock, find first available unlocked file
            if (!activeFile) {
                for (const file of pendingFiles) {
                    if (!fileLocks.has(file)) {
                        activeFile = file;
                        fileLocks.set(file, { lockedBy: userId, lockedAt: Date.now() });
                        break;
                    }
                }
            }

            if (!activeFile) {
                // Todas las notas pendientes están siendo anotadas por otros usuarios
                return res.json({ success: true, empty: true, message: 'Todos los textos pendientes están siendo anotados por otros usuarios ahora mismo.', progress: { annotated: annotatedCount, total: totalFiles, pending: pendingCount } });
            }

            const filePath = path.join(toAnnotateDir, activeFile);

            let textValue = '';
            let preloadedAbbreviations = null;
            const rawContent = fs.readFileSync(filePath, 'utf8');

            const isJson = activeFile.trim().toLowerCase().endsWith('.json');
            console.log(`[Annotation API] Loading file: ${activeFile} (isJson: ${isJson})`);

            if (isJson) {
                try {
                    const parsed = JSON.parse(rawContent);
                    textValue = parsed.text || parsed.texto || parsed.Registro || rawContent;
                    preloadedAbbreviations = Array.isArray(parsed.abbreviations) ? parsed.abbreviations : [];
                } catch (e) {
                    console.error(`[Annotation API] Error parsing JSON ${activeFile}:`, e);
                    textValue = rawContent;
                    preloadedAbbreviations = []; // Ensure it's not null to prevent CSV fallback
                }
            } else {
                textValue = rawContent;
                preloadedAbbreviations = null; // Explicitly null for .txt files
            }

            const normalizedText = textValue.replace(/\r/g, '');
            const result = [];
            const docId = activeFile.substring(0, activeFile.lastIndexOf('.')) || activeFile;

            // CRITICAL: If it's a JSON file, WE ONLY USE preloadedAbbreviations. NO FALLBACK.
            if (isJson || preloadedAbbreviations) {
                console.log(`[Annotation API] Using STICKY tokenization for JSON/Preloaded.`);
                // --- BUILD TOKENS FROM PRE-POPULATED ABBREVIATIONS ---
                // Sort by char_begin to process in order
                const abbrs = [...preloadedAbbreviations].sort((a, b) => a.char_begin - b.char_begin);
                let cursor = 0;
                let abbrIndex = 0;

                for (const abbr of abbrs) {
                    // Text before this abbreviation
                    if (abbr.char_begin > cursor) {
                        result.push({ type: 'text', text: normalizedText.slice(cursor, abbr.char_begin) });
                    }
                    // The abbreviation token — convert meanings array to options format
                    // NO FALLBACK TO DICTIONARY - Respect JSON strictly
                    const options = (abbr.meanings || []).map(m => ({ meaning: m, context: '' }));

                    result.push({
                        type: 'abbreviation',
                        text: normalizedText.slice(abbr.char_begin, abbr.char_end),
                        clean: abbr.text,
                        index: abbrIndex,
                        options: options
                    });
                    abbrIndex++;
                    cursor = abbr.char_end;
                }
                // Remaining text after last abbreviation
                if (cursor < normalizedText.length) {
                    result.push({ type: 'text', text: normalizedText.slice(cursor) });
                }

            } else {
                // --- FALLBACK: CSV-BASED TOKENIZATION ---
                const words = [];
                let currentWord = '';

                for (let i = 0; i < normalizedText.length; i++) {
                    const char = normalizedText[i];
                    if (' \t\n'.includes(char)) {
                        if (currentWord) {
                            words.push(currentWord);
                            currentWord = '';
                        }
                        if ('\n\t'.includes(char)) {
                            words.push(' ');
                        } else {
                            words.push(char);
                        }
                    } else {
                        currentWord += char;
                    }
                }
                if (currentWord) words.push(currentWord);

                let abbrIndex = 0;
                words.forEach(word => {
                    // 1. First, split punctuation from word
                    const startMatch = word.match(/^[.,;:\!\?\(\)\[\]\{\}\-\+\/\\]+/);
                    const endMatch = word.match(/[.,;:\!\?\(\)\[\]\{\}\-\+\/\\]+$/);
                    
                    const prefix = startMatch ? startMatch[0] : '';
                    const suffix = endMatch ? endMatch[0] : '';
                    const cleanWord = word.substring(prefix.length, word.length - suffix.length);

                    // 2. Junk filtering: 
                    // - Must have 2+ characters
                    // - Must have at least one uppercase letter (usually)
                    // - Must be in dictionary
                    const isCandidate = cleanWord.length > 1 && /[A-Z]/.test(cleanWord) && abbreviationsDb[cleanWord];

                    if (isCandidate) {
                        if (prefix) result.push({ type: 'text', text: prefix });
                        result.push({
                            type: 'abbreviation', 
                            text: cleanWord, 
                            clean: cleanWord, 
                            index: abbrIndex, 
                            options: abbreviationsDb[cleanWord]
                        });
                        abbrIndex++;
                        if (suffix) result.push({ type: 'text', text: suffix });
                    } else {
                        result.push({ type: 'text', text: word });
                    }
                });
                console.log(`[Annotation API] Auto-discovery found ${abbrIndex} abbreviations in TXT.`);
            }

            return res.json({
                success: true,
                empty: false,
                docId: docId,
                filename: activeFile,
                tokens: result,
                originalText: textValue,
                progress: {
                    annotated: annotatedCount,
                    total: totalFiles,
                    pending: pendingCount
                }
            });

        } catch (error) {
            console.error('[Annotation API] Error in /next:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.post('/save', requireServerAuth, requireDoctorOrAdminRole, (req, res) => {
        try {
            ensureDirs();
            const { docid, text, abbreviations, filename } = req.body;

            if (!filename) {
                return res.status(400).json({ success: false, error: 'No se especificó filename.' });
            }

            // Save the output JSON
            const outputFilename = `${docid || 'documento'}_anotado.json`;
            const outputPath = path.join(annotatedDir, outputFilename);

            fs.writeFileSync(outputPath, JSON.stringify({ docid, text, abbreviations }, null, 2), 'utf8');

            // Move the original file out of the queue (to avoid reprocessing)
            const sourcePath = path.join(toAnnotateDir, filename);
            if (fs.existsSync(sourcePath)) {
                // Delete or move to an archive folder. For now, delete.
                fs.unlinkSync(sourcePath);
            }

            // Liberar el lock
            if (fileLocks.has(filename)) {
                fileLocks.delete(filename);
            }

            res.json({ success: true, message: 'Anotación guardada en cola correctamente.' });
        } catch (error) {
            console.error('[Annotation API] Error in /save:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    return router;
};
