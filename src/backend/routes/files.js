const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const chokidar = require('chokidar');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const { StringDecoder } = require('string_decoder');

module.exports = function (deps) {
    const { requireServerAuth } = deps.authMiddleware;
    const { toWslPath } = deps.helpers;
    const { CHATBOT_CONFIG } = deps.chatbotService;

    const localProductionFolder = path.join(__dirname, '../../data/ProductionData');
    const localOutputFolder = path.join(__dirname, '../../data/OutputData');
    const localGenerationFolder = path.join(__dirname, '../../data/GenerationData');

    const H_localProductionFolder = path.join(__dirname, '../../data/H_ProductionData');
    const H_localOutputFolder = path.join(__dirname, '../../data/H_OutputData');
    const localUsersFolder = path.join(__dirname, '../../data/Users');

    // Asegurar existencia de carpetas necesarias
    [localProductionFolder, localOutputFolder, localUsersFolder, path.join(__dirname, '../tempUploads')].forEach(folder => {
        if (!fs.existsSync(folder)) {
            fs.mkdirSync(folder, { recursive: true });
        }
    });

    const clients = []; // SSE clients
    // Mapas para gestionar watchers activos y evitar duplicados
    const activeFileWatchers = new Map();
    const activeProgressWatchers = new Map();

    // Seguridad: timeout de desconexión SSE (1 minuto)
    const SSE_DISCONNECT_TIMEOUT_MS = 60 * 1000; // 1 minuto
    const disconnectTimers = new Map();      // clientId -> timeoutId
    const invalidatedSessions = new Set();   // clientIds que han sido invalidados

    // Función para limpiar archivos de una sesión expirada
    function cleanupExpiredSession(clientId) {
        console.log(`[SERVER] ⏰ Sesión expirada por inactividad SSE (1 min): ${clientId}`);
        invalidatedSessions.add(clientId);
        closeExistingWatchers(clientId);

        // Determinar si es simplificación (.pdf) o generación (token)
        const isSimplification = clientId.toLowerCase().endsWith('.pdf');

        if (isSimplification) {
            const baseName = path.basename(clientId, '.pdf');
            const filesToDelete = [
                path.join(__dirname, '../tempUploads', clientId),
                path.join(localProductionFolder, clientId),
                path.join(localOutputFolder, baseName + '.md'),
                path.join(localOutputFolder, baseName + '.complete'),
                path.join(localOutputFolder, baseName + '.progress.log')
            ];
            filesToDelete.forEach(f => {
                try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (e) { /* ignore */ }
            });
        } else {
            // Generación (token)
            const filesToDelete = [
                path.join(localGenerationFolder, `${clientId}_evolution.pdf`),
                path.join(localGenerationFolder, `${clientId}_anamnesis.pdf`),
                path.join(__dirname, '../tempUploads', `${clientId}_evolution.pdf`),
                path.join(__dirname, '../tempUploads', `${clientId}_anamnesis.pdf`),
                path.join(localOutputFolder, `${clientId}.md`),
                path.join(localOutputFolder, `${clientId}_anamnesis.complete`),
                path.join(localOutputFolder, `${clientId}.progress.log`)
            ];
            filesToDelete.forEach(f => {
                try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (e) { /* ignore */ }
            });
        }
        console.log(`[SERVER] 🗑️ Archivos limpiados para sesión expirada: ${clientId}`);
    }

    function closeExistingWatchers(clientId) {
        if (activeFileWatchers.has(clientId)) {
            activeFileWatchers.get(clientId).close();
            activeFileWatchers.delete(clientId);
        }
        if (activeProgressWatchers.has(clientId)) {
            activeProgressWatchers.get(clientId).close();
            activeProgressWatchers.delete(clientId);
        }
    }

    function sendChunkToClient(clientId, chunk, fileName) {
        const client = clients.find(c => c.id === clientId);
        if (client) {
            client.res.write(`data: ${JSON.stringify({
                type: 'fileChunk',
                chunk: chunk,
                fileName: fileName
            })}\n\n`);
        }
    }

    // Función para enviar mensajes de progreso al cliente
    function sendProgressToClient(clientId, message, logType = 'info') {
        const client = clients.find(c => c.id === clientId);
        if (client) {
            // Check if logType is actually a top-level event type
            const isSpecialEvent = ['reasoning_start', 'reasoning_chunk', 'reasoning_end', 'progress_bar'].includes(logType);

            let payload;
            if (isSpecialEvent) {
                payload = { type: logType };
                if (logType === 'reasoning_chunk') {
                    payload.chunk = message;
                } else if (logType === 'progress_bar') {
                    payload.percentage = message.percentage;
                    payload.message = message.message;
                } else {
                    payload.message = message;
                }
            } else {
                payload = {
                    type: 'progress',
                    message: message,
                    logType: logType
                };
            }

            client.res.write(`data: ${JSON.stringify(payload)}\n\n`);
        }
    }

    // Función para enviar un evento a todos los clientes conectados
    function sendSSEMessage(message) {
        clients.forEach(client => {
            client.res.write(`data: ${JSON.stringify(message)}\n\n`);
        });
    }

    // ==========================================
    // VERSIONING & LOGGING HELPERS
    // ==========================================

    function getUserFolder(email) {
        // Sanitizar email para usar como nombre de carpeta
        const safeEmail = email.replace(/[^a-zA-Z0-9@._-]/g, '_');
        return path.join(localUsersFolder, safeEmail);
    }

    function getProjectFolder(email, type, id) {
        // type: 'simplification' | 'generation'
        // id: filename (uuid.pdf) or token
        const userFolder = getUserFolder(email);
        // Si el id es un archivo (uuid.pdf), usamos el nombre base (uuid)
        const safeId = path.basename(id, path.extname(id));
        return path.join(userFolder, type, safeId);
    }

    function initProjectLog(email, type, id, originalFiles) {
        const projectFolder = getProjectFolder(email, type, id);
        if (!fs.existsSync(projectFolder)) {
            fs.mkdirSync(projectFolder, { recursive: true });
        }

        const logPath = path.join(projectFolder, 'log.json');
        const now = new Date().toISOString();

        const logData = {
            id: id,
            type: type, // 'simplification' or 'generation'
            user: email,
            created_at: now,
            original_files: originalFiles, // Array of filenames
            history: [
                {
                    timestamp: now,
                    action: 'UPLOAD',
                    details: 'Files uploaded and project initialized',
                    actor: email
                }
            ],
            versions: []
        };

        fs.writeFileSync(logPath, JSON.stringify(logData, null, 2));
        return logData;
    }

    function addLogEntry(email, type, id, action, details, actor) {
        const projectFolder = getProjectFolder(email, type, id);
        const logPath = path.join(projectFolder, 'log.json');

        if (fs.existsSync(logPath)) {
            try {
                const logData = JSON.parse(fs.readFileSync(logPath, 'utf8'));
                logData.history.push({
                    timestamp: new Date().toISOString(),
                    action,
                    details,
                    actor: actor || email
                });
                fs.writeFileSync(logPath, JSON.stringify(logData, null, 2));
            } catch (e) {
                console.error(`[VERSIONING] Error updating log for ${id}:`, e);
            }
        }
    }

    function saveVersion(email, type, id, content, versionType, actor) {
        // versionType: 'AI_GENERATED', 'USER_EDIT', 'CHATBOT_EDIT'
        const projectFolder = getProjectFolder(email, type, id);
        if (!fs.existsSync(projectFolder)) return null;

        const logPath = path.join(projectFolder, 'log.json');
        let logData = {};
        try {
            if (fs.existsSync(logPath)) {
                logData = JSON.parse(fs.readFileSync(logPath, 'utf8'));
            }
        } catch (e) { console.error(e); }

        // Determinar número de versión
        const nextVersionNum = (logData.versions && logData.versions.length > 0)
            ? logData.versions.length
            : 0;

        const versionFileName = `version_${nextVersionNum}.md`;
        const versionPath = path.join(projectFolder, versionFileName);

        fs.writeFileSync(versionPath, content, 'utf8');

        // Actualizar log
        const versionEntry = {
            version: nextVersionNum,
            file: versionFileName,
            type: versionType,
            timestamp: new Date().toISOString(),
            actor: actor || 'AI'
        };

        if (!logData.versions) logData.versions = [];
        logData.versions.push(versionEntry);

        logData.history.push({
            timestamp: new Date().toISOString(),
            action: 'NEW_VERSION',
            details: `Created version ${nextVersionNum} (${versionType})`,
            actor: actor || 'AI'
        });

        fs.writeFileSync(logPath, JSON.stringify(logData, null, 2));
        console.log(`[VERSIONING] Version ${nextVersionNum} saved for ${id} (${versionType})`);
        return versionFileName;
    }

    // Configurar multer
    const storage = multer.diskStorage({
        destination: (req, file, cb) => cb(null, path.join(__dirname, '../tempUploads')),
        filename: (req, file, cb) => cb(null, uuidv4() + '.pdf')
    });

    // Filtro de archivo para validar extensión y MIME type básico
    const fileFilter = (req, file, cb) => {
        if (file.mimetype !== 'application/pdf') {
            return cb(new Error('Solo se permiten archivos PDF'), false);
        }
        cb(null, true);
    };

    const upload = multer({
        storage: storage,
        fileFilter: fileFilter,
        limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
    });

    // Helper para sanitizar nombres
    function sanitizeFilename(name) {
        if (!name) return null;
        // Rechazar path traversal explícito
        if (name.includes('..') || name.includes('/') || name.includes('\\')) return null;
        // Rechazar caracteres peligrosos
        if (/[;&|`$]/.test(name)) return null;
        return name.replace(/[^a-zA-Z0-9.\-_]/g, '');
    }

    // Upload endpoint
    // IMPORTANT: requireServerAuth MUST be first to prevent unauthenticated uploads
    router.post('/upload', requireServerAuth, (req, res, next) => {
        upload.single('file')(req, res, (err) => {
            if (err) {
                // Capturar errores de Multer (límites) y fileFilter
                if (err instanceof multer.MulterError) {
                    if (err.code === 'LIMIT_FILE_SIZE') {
                        return res.status(413).send({ message: 'El archivo es demasiado grande. Máximo 10MB.' });
                    }
                }
                if (err.message === 'Solo se permiten archivos PDF') {
                    return res.status(400).send({ message: err.message });
                }
                return res.status(500).send({ message: 'Error inesperado en la subida.' });
            }
            next();
        });
    }, (req, res) => {
        if (!req.file) return res.status(400).send({ message: 'No file uploaded' });

        // Validar Magic Numbers (PDF debe empezar con %PDF)
        const filePath = req.file.path;
        const buffer = Buffer.alloc(4);
        try {
            const fd = fs.openSync(filePath, 'r');
            fs.readSync(fd, buffer, 0, 4, 0);
            fs.closeSync(fd);

            if (buffer.toString('utf8') !== '%PDF') {
                fs.unlinkSync(filePath); // Borrar archivo malicioso
                return res.status(400).send({ message: 'El archivo no es un PDF válido.' });
            }
        } catch (err) {
            console.error('Error leyendo archivo para validación:', err);
            return res.status(500).send({ message: 'Error interno validando archivo.' });
        }

        // Validar nombre original si se provee (para prevenir ataques via metadata/filename)
        // En multer, req.body no tiene los campos text hasta después de procesar el archivo.
        // Pero req.body debería estar disponible aquí.
        const originalName = req.body.originalName || req.file.originalname;
        if (originalName) {
            const sanitized = sanitizeFilename(originalName);
            if (!sanitized) {
                fs.unlinkSync(filePath);
                return res.status(400).send({ message: 'Nombre de archivo inválido o peligroso.' });
            }
        }

        console.log(`Archivo subido y validado: ${filePath}`);

        // --- VERSIONING LOGIC START ---
        if (req.user && req.user.email) {
            try {
                const email = req.user.email;
                const fileId = req.file.filename;
                const projectFolder = getProjectFolder(email, 'simplification', fileId);

                // Crear carpeta
                fs.mkdirSync(projectFolder, { recursive: true });

                // Copiar original a la carpeta de versión
                const originalDest = path.join(projectFolder, 'original.pdf');
                fs.copyFileSync(filePath, originalDest);

                // Inicializar Log
                initProjectLog(email, 'simplification', fileId, ['original.pdf']);

                console.log(`[VERSIONING] Proyecto de simplificación inicializado para ${email} / ${fileId}`);
            } catch (e) {
                console.error('[VERSIONING] Error initializing project:', e);
                // No fallamos el request principal, solo logueamos el error
            }
        }
        // --- VERSIONING LOGIC END ---

        res.send({ message: 'Archivo subido correctamente', fileName: req.file.filename });
    });

    // Error handler para Multer (límites)
    router.use((err, req, res, next) => {
        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(413).send({ message: 'El archivo es demasiado grande. Máximo 10MB.' });
            }
        } else if (err) {
            // Capturar errores de fileFilter
            if (err.message === 'Solo se permiten archivos PDF') {
                return res.status(400).send({ message: err.message });
            }
            return res.status(500).send({ message: 'Error inesperado en la subida.' });
        }
        next();
    });

    // SSE events endpoint
    router.get('/events', (req, res) => {
        const clientId = req.query.clientId;

        // Rechazar sesiones invalidadas
        if (invalidatedSessions.has(clientId)) {
            console.log(`[SERVER] ❌ Conexión SSE rechazada para sesión invalidada: ${clientId}`);
            return res.status(410).json({ message: 'Sesión expirada. Inicie el proceso de nuevo.' });
        }

        // Si hay un timer de desconexión pendiente, cancelarlo (el cliente ha reconectado)
        if (disconnectTimers.has(clientId)) {
            clearTimeout(disconnectTimers.get(clientId));
            disconnectTimers.delete(clientId);
            console.log(`[SERVER] ✓ Timer de desconexión cancelado para ${clientId} (reconexión)`);
        }

        res.set({
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });
        res.flushHeaders();

        clients.push({ id: clientId, res });

        req.on('close', () => {
            const index = clients.findIndex(c => c.id === clientId);
            if (index !== -1) clients.splice(index, 1);

            // Iniciar timer de desconexión (1 min) solo si la sesión no está ya invalidada
            // y solo si el proceso NO ha completado (los completados no necesitan cleanup por timeout)
            if (!invalidatedSessions.has(clientId)) {
                // Verificar si el proceso ya completó
                const isSimp = clientId.toLowerCase().endsWith('.pdf');
                let completePath;
                if (isSimp) {
                    completePath = path.join(localOutputFolder, clientId.replace('.pdf', '.complete'));
                } else {
                    completePath = path.join(localOutputFolder, `${clientId}_anamnesis.complete`);
                }

                if (fs.existsSync(completePath)) {
                    console.log(`[SERVER] ✓ Proceso completado para ${clientId}, no se inicia timer de limpieza.`);
                } else {
                    console.log(`[SERVER] ⏱️ SSE desconectado para ${clientId}, iniciando timer de ${SSE_DISCONNECT_TIMEOUT_MS / 1000}s`);
                    const timerId = setTimeout(() => {
                        const stillConnected = clients.some(c => c.id === clientId);
                        if (!stillConnected) {
                            cleanupExpiredSession(clientId);
                        }
                        disconnectTimers.delete(clientId);
                    }, SSE_DISCONNECT_TIMEOUT_MS);
                    disconnectTimers.set(clientId, timerId);
                }
            }
        });
    });

    // Generate (simplification) endpoint
    router.post('/generate', requireServerAuth, (req, res) => {
        const { fileName } = req.body;
        if (!fileName) return res.status(400).send({ message: 'Falta el nombre del archivo.' });

        const clientId = fileName;

        const localTempPath = path.join(__dirname, '../tempUploads', fileName);
        const prodPath = path.join(localProductionFolder, fileName);
        const outputFileName = fileName.replace('.pdf', '.md');
        const outputFilePath = path.join(localOutputFolder, outputFileName);
        const completeFilePath = path.join(localOutputFolder, fileName.replace('.pdf', '.complete'));

        // Cerrar watchers anteriores si existen para este cliente
        closeExistingWatchers(clientId);

        // Limpiar archivos de ejecuciones anteriores
        const progressLogPath = path.join(localOutputFolder, fileName.replace('.pdf', '.progress.log'));
        try {
            if (fs.existsSync(outputFilePath)) fs.unlinkSync(outputFilePath);
            if (fs.existsSync(completeFilePath)) fs.unlinkSync(completeFilePath);
            if (fs.existsSync(progressLogPath)) fs.unlinkSync(progressLogPath);
            console.log(`[SERVER] Limpieza de archivos anteriores completada para ${fileName}`);
        } catch (e) {
            console.error('[SERVER] Error limpiando archivos anteriores:', e);
        }

        fs.copyFile(localTempPath, prodPath, (err) => {
            if (err) return res.status(500).json({ message: 'Error al copiar el archivo.' });

            console.log(`Archivo ${fileName} copiado correctamente`);

            let lastSize = 0;
            let lastProgressSize = 0;
            const decoder = new StringDecoder('utf8');
            const progressDecoder = new StringDecoder('utf8');

            const watcher = chokidar.watch(outputFilePath, { usePolling: true, interval: 50 });
            activeFileWatchers.set(clientId, watcher);

            watcher.on('change', () => {
                fs.stat(outputFilePath, (err, stats) => {
                    if (err) return;

                    const newSize = stats.size;

                    // Reset pointers if file was truncated
                    if (newSize < lastSize) {
                        console.log(`[SERVER] Output file truncated for ${fileName}, resetting lastSize and decoder.`);
                        lastSize = 0;
                        decoder = new StringDecoder('utf8');
                    }

                    if (newSize > lastSize) {
                        const stream = fs.createReadStream(outputFilePath, {
                            start: lastSize
                        });

                        stream.on('data', chunk => {
                            sendChunkToClient(clientId, decoder.write(chunk), outputFileName);
                        });

                        lastSize = newSize;
                    }
                });
            });

            // Monitorear archivo de progreso - también monitorear el directorio para detectar creación
            console.log(`[SERVER] Configurando watcher para archivo de progreso: ${progressLogPath}`);

            // Monitorear todo el directorio de salida para detectar el archivo cuando se cree
            const progressWatcher = chokidar.watch(localOutputFolder, {
                usePolling: true,
                interval: 100,
                ignoreInitial: false,
                awaitWriteFinish: false,
                depth: 0  // Solo el directorio raíz, no subdirectorios
            });
            activeProgressWatchers.set(clientId, progressWatcher);

            let progressFileCreated = false;

            progressWatcher.on('add', (filePath) => {
                if (path.basename(filePath) === path.basename(progressLogPath) && !progressFileCreated) {
                    progressFileCreated = true;
                    console.log(`[SERVER] ✓ Archivo de progreso detectado para ${fileName}`);
                    sendProgressToClient(clientId, '📂 Iniciando procesamiento del informe...', 'info');
                }
            });

            progressWatcher.on('change', (filePath) => {
                // Solo procesar cambios en nuestro archivo específico
                if (path.basename(filePath) !== path.basename(progressLogPath)) return;

                fs.stat(progressLogPath, (err, stats) => {
                    if (err) return;

                    const newSize = stats.size;

                    if (newSize < lastProgressSize) {
                        console.log(`[SERVER] Progress file truncated for ${fileName}, resetting pointer.`);
                        lastProgressSize = 0;
                    }

                    if (newSize > lastProgressSize) {
                        const stream = fs.createReadStream(progressLogPath, {
                            start: lastProgressSize,
                            end: newSize
                        });

                        let buffer = '';
                        stream.on('data', chunk => {
                            buffer += progressDecoder.write(chunk);
                            const lines = buffer.split('\n');

                            // Procesar todas las líneas completas
                            for (let i = 0; i < lines.length - 1; i++) {
                                const line = lines[i].trim();
                                if (line) {
                                    try {
                                        const logData = JSON.parse(line);
                                        console.log(`[SERVER] Enviando log: ${logData.message}`);
                                        sendProgressToClient(clientId, logData.message, logData.type);
                                    } catch (e) {
                                        // Si no es JSON, enviar como mensaje simple
                                        console.log(`[SERVER] Enviando log (no-JSON): ${line}`);
                                        sendProgressToClient(clientId, line, 'info');
                                    }
                                }
                            }

                            // Guardar la última línea incompleta
                            buffer = lines[lines.length - 1];
                        });

                        lastProgressSize = newSize;
                    }
                });
            });

            progressWatcher.on('error', (error) => {
                console.error(`[SERVER] Error en watcher de progreso:`, error);
            });

            // Monitorear archivo de completado
            const completeWatcher = chokidar.watch(completeFilePath, { usePolling: true, interval: 100 });

            console.log(`[SERVER] Watcher configurado para .complete: ${completeFilePath}`);

            // FALLBACK: Verificar existencia periódicamente por si chokidar falla
            const completeInterval = setInterval(() => {
                if (fs.existsSync(completeFilePath)) {
                    console.log(`[SERVER] (Interval) ✓ DETECTADO archivo .complete para ${fileName}`);
                    notifyCompletion();
                }
            }, 1000);

            let completionNotified = false;

            const notifyCompletion = () => {
                if (completionNotified) return;
                completionNotified = true;

                // FIX: Force final read to ensure no truncated content
                try {
                    if (fs.existsSync(outputFilePath)) {
                        const stats = fs.statSync(outputFilePath);
                        const newSize = stats.size;
                        if (newSize > lastSize) {
                            console.log(`[SERVER] Final flush for ${fileName}: ${lastSize} -> ${newSize}`);
                            const buffer = Buffer.alloc(newSize - lastSize);
                            const fd = fs.openSync(outputFilePath, 'r');
                            fs.readSync(fd, buffer, 0, newSize - lastSize, lastSize);
                            fs.closeSync(fd);
                            sendChunkToClient(clientId, buffer.toString(), outputFileName);
                            lastSize = newSize;
                        }
                    }
                } catch (e) {
                    console.error(`[SERVER] Error in final flush for ${fileName}:`, e);
                }

                console.log(`[SERVER] Simplificación completada para ${fileName}`);
                const client = clients.find(c => c.id === clientId);
                if (client) {
                    console.log(`[SERVER] Enviando evento 'completed' al cliente ${clientId}`);
                    client.res.write(`data: ${JSON.stringify({
                        type: 'completed',
                        fileName: outputFileName
                    })}\n\n`);
                } else {
                    console.log(`[SERVER] ⚠ No se encontró cliente con id ${clientId} para enviar evento 'completed'`);
                }

                clearInterval(completeInterval);
                completeWatcher.close();
                progressWatcher.close();
                watcher.close();

                // --- VERSIONING LOGIC START ---
                if (req.user && req.user.email) {
                    try {
                        const content = fs.readFileSync(outputFilePath, 'utf8');
                        // Version 0: AI Generated
                        saveVersion(req.user.email, 'simplification', fileName, content, 'AI_GENERATED');
                        console.log(`[VERSIONING] Saved version 0 for simplification ${fileName}`);
                    } catch (e) {
                        console.error('[VERSIONING] Error saving version 0:', e);
                    }
                }
                // --- VERSIONING LOGIC END ---

                // Eliminar archivo de progreso después de completar
                setTimeout(() => {
                    if (fs.existsSync(progressLogPath)) {
                        fs.unlinkSync(progressLogPath);
                        console.log(`[SERVER] Archivo de progreso eliminado: ${progressLogPath}`);
                    }
                }, 1000);
            };

            completeWatcher.on('add', () => {
                console.log(`[SERVER] (Watcher) ✓ DETECTADO archivo .complete para ${fileName}`);
                notifyCompletion();
            });

            res.status(200).json({ message: 'Procesamiento iniciado', fileName });
        });
    });

    // Upload generation PDFs (evolución + anamnesis)
    const uploadGeneration = multer({ storage: storage }).fields([
        { name: 'evolution', maxCount: 1 },
        { name: 'anamnesis', maxCount: 1 }
    ]);

    router.post('/upload-generation', requireServerAuth, uploadGeneration, (req, res) => {
        if (!req.files || !req.files.evolution || !req.files.anamnesis) {
            return res.status(400).json({ message: 'Faltan archivos (evolución y/o anamnesis).' });
        }

        const token = uuidv4();
        const evolutionFile = req.files.evolution[0];
        const anamnesisFile = req.files.anamnesis[0];

        const evolutionTempPath = evolutionFile.path;
        const anamnesisTempPath = anamnesisFile.path;

        // Nombres de archivo basados en token
        const evolutionPattern = `${token}_evolution.pdf`;
        const anamnesisPattern = `${token}_anamnesis.pdf`;

        // Solo copiar a tempUploads para preview (NO a GenerationData todavía)
        const evolutionPreviewPath = path.join(__dirname, '../tempUploads', `${token}_evolution.pdf`);
        const anamnesisPreviewPath = path.join(__dirname, '../tempUploads', `${token}_anamnesis.pdf`);

        Promise.all([
            fs.promises.copyFile(evolutionTempPath, evolutionPreviewPath),
            fs.promises.copyFile(anamnesisTempPath, anamnesisPreviewPath)
        ]).then(() => {
            console.log(`[SERVER] [UPLOAD] Archivos copiados a tempUploads para token: ${token}`);

            // --- VERSIONING LOGIC START ---
            if (req.user && req.user.email) {
                try {
                    const email = req.user.email;
                    const projectFolder = getProjectFolder(email, 'generation', token);

                    fs.mkdirSync(projectFolder, { recursive: true });

                    // Guardar originales
                    fs.copyFileSync(evolutionTempPath, path.join(projectFolder, 'evolution.pdf'));
                    fs.copyFileSync(anamnesisTempPath, path.join(projectFolder, 'anamnesis.pdf'));

                    // Init log
                    initProjectLog(email, 'generation', token, ['evolution.pdf', 'anamnesis.pdf']);
                    console.log(`[VERSIONING] Proyecto de generación inicializado para ${email} / ${token}`);
                } catch (e) {
                    console.error('[VERSIONING] Error initializing generation project:', e);
                }
            }
            // --- VERSIONING LOGIC END ---

            res.json({
                message: 'Archivos subidos correctamente para generación',
                evolutionFile: evolutionPattern,
                anamnesisFile: anamnesisPattern,
                generationId: token  // Token único
            });
        }).catch(error => {
            console.error('[SERVER] Error copiando archivos:', error);
            res.status(500).json({ message: 'Error al guardar los archivos.' });
        });
    });

    // Generate report endpoint
    router.post('/generate-report', requireServerAuth, (req, res) => {
        const { token } = req.body;

        if (!token) {
            return res.status(400).json({ message: 'Token requerido.' });
        }

        const clientId = token;

        // Cerrar watchers anteriores si existen
        closeExistingWatchers(clientId);

        // Nombres de archivo basados en token
        const evolutionPattern = `${token}_evolution.pdf`;
        const anamnesisPattern = `${token}_anamnesis.pdf`;
        const outputFileName = `${token}.md`;

        const evolutionDestPath = path.join(localGenerationFolder, evolutionPattern);
        const anamnesisDestPath = path.join(localGenerationFolder, anamnesisPattern);
        const outputFilePath = path.join(localOutputFolder, outputFileName);
        const completeFilePath = path.join(localOutputFolder, `${token}.complete`);

        // Si los archivos no están en GenerationData, copiar desde tempUploads
        const tempEvolution = path.join(__dirname, '../tempUploads', `${token}_evolution.pdf`);
        const tempAnamnesis = path.join(__dirname, '../tempUploads', `${token}_anamnesis.pdf`);

        if (!fs.existsSync(evolutionDestPath) && fs.existsSync(tempEvolution)) {
            fs.copyFileSync(tempEvolution, evolutionDestPath);
            console.log(`[SERVER] [GENERATION] Copiado evolución de tempUploads a GenerationData`);
        }
        if (!fs.existsSync(anamnesisDestPath) && fs.existsSync(tempAnamnesis)) {
            fs.copyFileSync(tempAnamnesis, anamnesisDestPath);
            console.log(`[SERVER] [GENERATION] Copiado anamnesis de tempUploads a GenerationData`);
        }

        // Validar que existan los archivos
        if (!fs.existsSync(evolutionDestPath) || !fs.existsSync(anamnesisDestPath)) {
            console.error(`[SERVER] [GENERATION] Archivos no encontrados para token: ${token}`);
            return res.status(404).json({ message: 'Archivos de generación no encontrados.' });
        }

        console.log(`[SERVER] [GENERATION] Iniciando generación para token: ${token}`);

        const progressLogPath = path.join(localOutputFolder, `${token}.progress.log`);

        // Limpiar archivos de ejecuciones anteriores para evitar corrupción o lastSize incorrecto
        try {
            if (fs.existsSync(outputFilePath)) fs.unlinkSync(outputFilePath);
            if (fs.existsSync(completeFilePath)) fs.unlinkSync(completeFilePath);
            if (fs.existsSync(progressLogPath)) fs.unlinkSync(progressLogPath);
            console.log(`[SERVER] [GENERATION] Limpieza de ejecución anterior completada`);
        } catch (e) {
            console.error('[SERVER] [GENERATION] Error limpiando archivos anteriores:', e);
        }

        let lastSize = 0;
        let lastProgressSize = 0;
        let decoder = new StringDecoder('utf8');
        let progressDecoder = new StringDecoder('utf8');

        // Monitorear archivo de salida
        const watcher = chokidar.watch(outputFilePath, { usePolling: true, interval: 50 });
        activeFileWatchers.set(clientId, watcher);

        watcher.on('change', () => {
            fs.stat(outputFilePath, (err, stats) => {
                if (err) return;
                const newSize = stats.size;

                if (newSize < lastSize) {
                    console.log(`[SERVER] [GENERATION] Output file truncated, resetting pointer and decoder.`);
                    lastSize = 0;
                    decoder = new StringDecoder('utf8');
                }

                if (newSize > lastSize) {
                    const stream = fs.createReadStream(outputFilePath, {
                        start: lastSize
                    });
                    stream.on('data', chunk => {
                        sendChunkToClient(clientId, decoder.write(chunk), outputFileName);
                    });

                    lastSize = newSize;
                }
            });
        });

        // Monitorear archivo de progreso
        console.log(`[SERVER] [GENERATION] Configurando watcher para progreso: ${progressLogPath}`);

        const progressWatcher = chokidar.watch(localOutputFolder, {
            usePolling: true,
            interval: 100,
            ignoreInitial: false,
            awaitWriteFinish: false,
            depth: 0
        });
        activeProgressWatchers.set(clientId, progressWatcher);

        let progressFileCreated = false;

        progressWatcher.on('add', (filePath) => {
            if (path.basename(filePath) === path.basename(progressLogPath) && !progressFileCreated) {
                progressFileCreated = true;
                console.log(`[SERVER] [GENERATION] ✓ Archivo de progreso detectado`);
                sendProgressToClient(clientId, '📂 Iniciando generación del informe de alta...', 'info');
            }
        });

        progressWatcher.on('change', (filePath) => {
            if (path.basename(filePath) !== path.basename(progressLogPath)) return;

            fs.stat(progressLogPath, (err, stats) => {
                if (err) return;

                const newSize = stats.size;

                if (newSize < lastProgressSize) {
                    console.log(`[SERVER] [GENERATION] Progress file truncated, resetting pointer.`);
                    lastProgressSize = 0;
                }

                if (newSize > lastProgressSize) {
                    const stream = fs.createReadStream(progressLogPath, {
                        start: lastProgressSize,
                        end: newSize
                    });

                    let buffer = '';
                    stream.on('data', chunk => {
                        buffer += progressDecoder.write(chunk);
                        const lines = buffer.split('\n');

                        for (let i = 0; i < lines.length - 1; i++) {
                            const line = lines[i].trim();
                            if (line) {
                                try {
                                    const logData = JSON.parse(line);
                                    console.log(`[SERVER] [GENERATION] Log: ${logData.message}`);
                                    sendProgressToClient(clientId, logData.message, logData.type);
                                } catch (e) {
                                    sendProgressToClient(clientId, line, 'info');
                                }
                            }
                        }

                        buffer = lines[lines.length - 1];
                    });

                    lastProgressSize = newSize;
                }
            });
        });

        // Monitorear archivo de completado
        const completeWatcher = chokidar.watch(completeFilePath, { usePolling: true, interval: 100 });

        const completeInterval = setInterval(() => {
            if (fs.existsSync(completeFilePath)) {
                console.log(`[SERVER] [GENERATION] (Interval) ✓ DETECTADO .complete`);
                notifyCompletion();
            }
        }, 1000);

        let completionNotified = false;

        const notifyCompletion = () => {
            if (completionNotified) return;
            completionNotified = true;

            // FIX: Force final read to ensure no truncated content
            try {
                if (fs.existsSync(outputFilePath)) {
                    const stats = fs.statSync(outputFilePath);
                    const newSize = stats.size;
                    if (newSize > lastSize) {
                        console.log(`[SERVER] [GENERATION] Final flush for token ${token}: ${lastSize} -> ${newSize}`);
                        const buffer = Buffer.alloc(newSize - lastSize);
                        const fd = fs.openSync(outputFilePath, 'r');
                        fs.readSync(fd, buffer, 0, newSize - lastSize, lastSize);
                        fs.closeSync(fd);
                        sendChunkToClient(clientId, decoder.write(buffer), outputFileName);
                        lastSize = newSize;
                    }
                }
            } catch (e) {
                console.error(`[SERVER] [GENERATION] Error in final flush for ${token}:`, e);
            }

            // Final push to clear decoder
            try {
                const remnant = decoder.end();
                if (remnant) sendChunkToClient(clientId, remnant, outputFileName);
            } catch (e) { }

            console.log(`[SERVER] [GENERATION] Generación completada para token: ${token}`);
            const client = clients.find(c => c.id === clientId);
            if (client) {
                client.res.write(`data: ${JSON.stringify({
                    type: 'completed',
                    fileName: outputFileName
                })}\n\n`);
            }

            clearInterval(completeInterval);
            completeWatcher.close();
            progressWatcher.close();
            watcher.close();

            // --- VERSIONING LOGIC START ---
            if (req.user && req.user.email) {
                try {
                    const content = fs.readFileSync(outputFilePath, 'utf8');
                    // Version 0: AI Generated
                    saveVersion(req.user.email, 'generation', token, content, 'AI_GENERATED');
                    console.log(`[VERSIONING] Saved version 0 for generation ${token}`);
                } catch (e) {
                    console.error('[VERSIONING] Error saving version 0 for generation:', e);
                }
            }
            // --- VERSIONING LOGIC END ---

            setTimeout(() => {
                if (fs.existsSync(progressLogPath)) {
                    fs.unlinkSync(progressLogPath);
                }
            }, 1000);
        };

        completeWatcher.on('add', () => {
            console.log(`[SERVER] [GENERATION] (Watcher) ✓ DETECTADO .complete`);
            notifyCompletion();
        });


        res.status(200).json({
            message: 'Generación inicia',
            clientId: clientId,
            outputFileName: outputFileName
        });
    });

    // ============================================
    // Analyze Admission Endpoints (Two-Phase)
    // ============================================

    const analysisProcesses = new Map();

    // Helper: spawn Python analysis script
    function spawnAnalysis(phase, token, variables, res) {
        // Check tempUploads first (before generate), then GenerationData (after generate)
        const tempPath = path.join(__dirname, '../tempUploads', `${token}_evolution.pdf`);
        const genPath = path.join(localGenerationFolder, `${token}_evolution.pdf`);
        const evolutionPdfPath = fs.existsSync(tempPath) ? tempPath : genPath;

        if (!fs.existsSync(evolutionPdfPath)) {
            console.error(`[SERVER] [ANALYSIS] Archivo de evolución no encontrado en tempUploads ni GenerationData`);
            return res.status(404).json({ message: 'Archivo de evolución no encontrado.' });
        }

        const outputSuffix = phase === 'discover' ? '_analysis_discovery.json' : '_analysis_extract.json';
        const analysisOutputPath = path.join(localOutputFolder, `${token}${outputSuffix}`);
        const safeEvolutionPath = toWslPath(evolutionPdfPath);
        const safeOutputPath = toWslPath(analysisOutputPath);
        const coreDir = path.join(__dirname, '..', 'core');

        const processKey = token + '_' + phase;
        if (analysisProcesses.has(processKey)) {
            return res.status(202).json({ status: 'processing', message: 'Análisis ya en curso' });
        }

        let command = `eval "$(conda shell.bash hook)" && conda activate ${CHATBOT_CONFIG.CONDA_ENV} && python analyze_admission.py --phase ${phase} --evolution-pdf "${safeEvolutionPath}" --output "${safeOutputPath}"`;

        if (phase === 'extract' && variables) {
            command += ` --variables "${variables}"`;
        }

        console.log(`[SERVER] [ANALYSIS] Fase ${phase} | Token: ${token}`);

        analysisProcesses.set(processKey, true);

        const pythonProcess = spawn('bash', ['-c', command], {
            cwd: coreDir,
            env: { ...process.env, PYTHONUNBUFFERED: '1' }
        });

        // Respond immediately
        res.status(202).json({ status: 'processing', message: 'Análisis iniciado' });

        let scriptOutput = '';
        let scriptError = '';
        let outputBuffer = '';

        pythonProcess.stdout.on('data', (data) => {
            const chunk = data.toString();
            scriptOutput += chunk;
            outputBuffer += chunk;

            const lines = outputBuffer.split('\n');
            // Process all complete lines
            for (let i = 0; i < lines.length - 1; i++) {
                const line = lines[i].trim();
                if (line) {
                    try {
                        // Check if line is a JSON log from our script
                        if (line.startsWith('{') && line.endsWith('}')) {
                            const logData = JSON.parse(line);
                            if (logData.type === 'progress_bar') {
                                sendProgressToClient(token, logData, logData.type);
                            } else if (logData.type === 'reasoning' || logData.type === 'reasoning_start' || logData.type === 'reasoning_chunk' || logData.type === 'reasoning_end') {
                                // Forward these event types directly
                                sendProgressToClient(token, logData.message || logData.chunk, logData.type);
                            }
                        } else if (line.startsWith('[ANALYSIS]')) {
                            // Also send standard analysis logs
                            // sendProgressToClient(token, line, 'info'); // Option to send all logs
                            console.log(line);
                        } else {
                            console.log(`[ANALYSIS] ${line}`);
                        }
                    } catch (e) {
                        console.log(`[ANALYSIS] ${line}`);
                    }
                }
            }
            // Keep the last incomplete line in buffer
            outputBuffer = lines[lines.length - 1];
        });

        pythonProcess.stderr.on('data', (data) => {
            scriptError += data.toString();
            console.error(`[ANALYSIS ERR] ${data.toString().trim()}`);
            // Optional: send errors to client?
            // sendProgressToClient(token, `Error: ${data.toString().trim()}`, 'error');
        });

        pythonProcess.on('error', (err) => {
            console.error(`[SERVER] [ANALYSIS] Error al lanzar proceso: ${err.message}`);
            analysisProcesses.delete(processKey);
        });

        pythonProcess.on('close', (code) => {
            analysisProcesses.delete(processKey);
            if (code === 0 && fs.existsSync(analysisOutputPath)) {
                console.log(`[SERVER] [ANALYSIS] ✓ Fase ${phase} completada para token: ${token}`);
                sendProgressToClient(token, { type: 'analysis_completed', phase: phase }, 'analysis_completed');
            } else {
                console.error(`[SERVER] [ANALYSIS] ✗ Falló. Exit code: ${code}`);
                sendProgressToClient(token, { type: 'analysis_error', message: scriptError || scriptOutput }, 'analysis_error');
            }
        });
    }

    // POST /analyze-admission — Phase 1: Discover plottable variables
    router.post('/analyze-admission', requireServerAuth, (req, res) => {
        const { token } = req.body;
        if (!token) return res.status(400).json({ message: 'Token requerido.' });

        // Check cache
        const cachePath = path.join(localOutputFolder, `${token}_analysis_discovery.json`);
        if (fs.existsSync(cachePath)) {
            try {
                const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
                console.log(`[SERVER] [ANALYSIS] Discovery cache hit para token: ${token}`);
                return res.status(200).json(cached);
            } catch (e) {
                console.error('[SERVER] [ANALYSIS] Cache corrupto, re-analizando');
            }
        }

        spawnAnalysis('discover', token, null, res);
    });

    // GET /analyze-admission-result/:token — Check status and get result
    router.get('/analyze-admission-result/:token', requireServerAuth, (req, res) => {
        const { token } = req.params;
        const cachePath = path.join(localOutputFolder, `${token}_analysis_discovery.json`);

        if (analysisProcesses.has(token + '_discover')) {
            return res.status(202).json({ status: 'processing' });
        }

        if (fs.existsSync(cachePath)) {
            try {
                const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
                return res.status(200).json(cached);
            } catch (e) {
                return res.status(500).json({ error: 'Error leyendo caché del análisis.' });
            }
        }

        return res.status(404).json({ error: 'Resultado no encontrado o análisis fallido.' });
    });

    // POST /analyze-admission-extract — Phase 2: Extract values for selected variables
    router.post('/analyze-admission-extract', requireServerAuth, (req, res) => {
        const { token, variables } = req.body;
        if (!token) return res.status(400).json({ message: 'Token requerido.' });
        if (!variables || !Array.isArray(variables) || variables.length === 0) {
            return res.status(400).json({ message: 'Variables requeridas.' });
        }

        const extractPath = path.join(localOutputFolder, `${token}_analysis_extract.json`);

        if (!fs.existsSync(extractPath)) {
            console.error(`[SERVER] [ANALYSIS] Archivo de extracción no encontrado: ${extractPath}`);
            return res.status(404).json({ message: 'Datos de extracción no encontrados. Por favor, re-ejecuta el análisis completo.' });
        }

        try {
            const rawData = fs.readFileSync(extractPath, 'utf8');
            if (!rawData || rawData.trim() === '') {
                throw new Error('Archivo de extracción vacío');
            }

            const fullData = JSON.parse(rawData);
            const selectedVars = new Set(variables);

            const filteredResult = { registros: [] };

            if (fullData.registros && Array.isArray(fullData.registros)) {
                fullData.registros.forEach(reg => {
                    const newVals = {};
                    if (reg.valores) {
                        for (const [key, val] of Object.entries(reg.valores)) {
                            // key is expected to be lowercase/normalized from Phase 1
                            if (selectedVars.has(key)) {
                                newVals[key] = val;
                            }
                        }
                    }
                    filteredResult.registros.push({
                        registro: reg.registro,
                        valores: newVals
                    });
                });
            }

            console.log(`[SERVER] [ANALYSIS] Extracción filtrada para ${variables.length} variables. Token: ${token}`);
            res.status(200).json(filteredResult);

        } catch (e) {
            console.error('[SERVER] [ANALYSIS] Error procesando extracción:', e);
            res.status(500).json({ message: 'Error procesando los datos de extracción.', details: e.message });
        }
    });


    // Endpoint para edición inteligente mediante Chatbot (editor.py)
    router.post('/api/chat/edit', requireServerAuth, (req, res) => {
        const { clientId, message } = req.body;

        if (!clientId || !message) {
            return res.status(400).json({ error: 'Faltan parámetros (clientId, message)' });
        }

        console.log(`[SERVER][CHAT] Petición de edición para ${clientId}: "${message.substring(0, 50)}..."`);

        // Resolver ruta del archivo
        // Resolver ruta del archivo .md
        // clientId puede ser "token" o "uuid.pdf"
        let baseName = clientId.endsWith('.pdf') ? path.basename(clientId, '.pdf') : path.basename(clientId, '.md');
        const fileName = baseName + '.md';
        const filePath = path.join(localOutputFolder, fileName);

        if (!fs.existsSync(filePath)) {
            console.error(`[SERVER][CHAT] Archivo no encontrado: ${filePath}`);
            return res.status(404).json({ error: 'Informe no encontrado para editar' });
        }

        const scriptPath = path.join(__dirname, '..', 'chatbot', 'editor.py');
        console.log(`[SERVER][CHAT] Lanzando editor.py para ${fileName}`);

        const safeFilePath = toWslPath(filePath);
        const workingDir = path.join(__dirname, '..', 'chatbot');

        // Codificar mensaje en Base64 para evitar problemas de piping y caracteres especiales
        const messageB64 = Buffer.from(message).toString('base64');

        // Add debug echoes to trace where it fails
        const command = `echo "[DEBUG] Starting shell..." && echo "[DEBUG] PATH: $PATH" && eval "$(conda shell.bash hook)" && echo "[DEBUG] Conda Hooked" && conda activate ${CHATBOT_CONFIG.CONDA_ENV} && echo "[DEBUG] Conda Activated" && python editor.py --file "${safeFilePath}" --instruction_b64 "${messageB64}"`;

        console.log(`[SERVER][CHAT] Comando a ejecutar: ${command}`);

        const pythonProcess = spawn('bash', ['-c', command], {
            cwd: workingDir,
            env: { ...process.env, PYTHONUNBUFFERED: '1' }
        });

        // No usamos stdin ya que pasamos el mensaje por argumento codificado
        pythonProcess.stdin.end();

        let scriptOutput = '';
        let scriptError = '';

        pythonProcess.stdout.on('data', (data) => {
            scriptOutput += data.toString();
            console.log(`[EDITOR] ${data.toString().trim()}`);
        });

        pythonProcess.stderr.on('data', (data) => {
            scriptError += data.toString();
            console.error(`[EDITOR ERR] ${data.toString().trim()}`);
        });

        pythonProcess.on('error', (err) => {
            console.error(`[SERVER][CHAT] Error al lanzar proceso: ${err.message}`);
        });

        pythonProcess.on('close', (code) => {
            if (code === 0) {
                console.log(`[SERVER][CHAT] Edición completada con éxito`);

                // --- VERSIONING LOGIC START ---
                if (req.user && req.user.email) {
                    try {
                        const newContent = fs.readFileSync(filePath, 'utf8');
                        // Determinar type y id
                        const isSimp = clientId.endsWith('.pdf');
                        const type = isSimp ? 'simplification' : 'generation';
                        const id = clientId;

                        saveVersion(req.user.email, type, id, newContent, 'CHATBOT_EDIT', 'AI_ASSISTANT');
                    } catch (e) {
                        console.error('[VERSIONING] Error saving chatbot edit version:', e);
                    }
                }
                // --- VERSIONING LOGIC END ---

                res.json({ success: true, message: 'Informe actualizado correctamente' });
            } else {
                console.error(`[SERVER][CHAT] Falló la edición. Exit code: ${code}`);
                console.error(`[SERVER][CHAT] STDOUT FINAL: ${scriptOutput}`);
                console.error(`[SERVER][CHAT] STDERR FINAL: ${scriptError}`);
                res.status(500).json({ error: 'Error al procesar la edición', details: scriptError || scriptOutput });
            }
        });
    });

    // Endpoint para guardar la edición del markdown
    router.post('/save-edit', requireServerAuth, (req, res) => {
        const { fileName, content } = req.body;

        if (!fileName || !content) {
            return res.status(400).json({ message: 'Faltan datos requeridos (fileName o content).' });
        }

        // Determinar rutas
        // Determinar ruta: siempre sobreescribir el .md original para que la vista previa se actualice
        // fileName puede venir como "token.md" o "uuid.pdf"
        let baseName = fileName.endsWith('.pdf') ? path.basename(fileName, '.pdf') : path.basename(fileName, '.md');
        const targetFileName = `${baseName}.md`;
        const targetFilePath = path.join(localOutputFolder, targetFileName);

        try {
            fs.writeFileSync(targetFilePath, content, 'utf8');
            console.log(`[SERVER] Informe actualizado (save-edit): ${targetFilePath}`);

            // --- VERSIONING LOGIC START ---
            if (req.user && req.user.email) {
                try {
                    // Determinar type y id
                    const isSimp = fileName.endsWith('.pdf');
                    const type = isSimp ? 'simplification' : 'generation';
                    const id = fileName;

                    saveVersion(req.user.email, type, id, content, 'USER_EDIT', req.user.email);
                } catch (e) {
                    console.error('[VERSIONING] Error saving user edit version:', e);
                }
            }
            // --- VERSIONING LOGIC END ---

            return res.status(200).json({ message: 'Cambios guardados correctamente', fileName: targetFileName });
        } catch (error) {
            console.error('[SERVER] Error al guardar edición:', error);
            return res.status(500).json({ message: 'Error al guardar los cambios.' });
        }
    });

    // Notify preview exit
    router.post('/notifyPreviewExit', upload.single('file'), async (req, res) => {
        const { fileName } = req.body;

        if (!fileName) {
            return res.status(400).json({ message: 'No se ha proporcionado el nombre del archivo.' });
        }
        console.log('El cliente ha salido');

        const localTempPath = path.join(__dirname, '../tempUploads', fileName);
        const filename_md = path.basename(fileName, '.pdf') + '.md';
        const filename_complete = path.basename(fileName, '.pdf') + '.complete';

        const prodPath = path.join(H_localProductionFolder, fileName);
        const outPath = path.join(H_localOutputFolder, filename_md);

        const localProdFolderPath = path.join(localProductionFolder, fileName);
        const localOutFolderPath = path.join(localOutputFolder, filename_md);
        const localCompleteFolderPath = path.join(localOutputFolder, filename_complete);

        try {
            console.log(`Intentando eliminar el archivo: ${localProdFolderPath}`);
            if (fs.existsSync(localProdFolderPath)) {
                fs.unlinkSync(localProdFolderPath);
                console.log(`[SERVER] Archivo existente borrado en localProductionFolder: ${localProdFolderPath}`);
            }

            await fs.promises.copyFile(localTempPath, prodPath);
            fs.unlinkSync(localTempPath);

            console.log(`Intentando eliminar el archivo: ${localOutFolderPath}`);
            if (fs.existsSync(localOutFolderPath)) {
                await fs.promises.copyFile(localOutFolderPath, outPath);
                fs.unlinkSync(localOutFolderPath);
            }

            // Eliminar archivo .complete si existe
            if (fs.existsSync(localCompleteFolderPath)) {
                fs.unlinkSync(localCompleteFolderPath);
                console.log(`[SERVER] Archivo .complete borrado: ${localCompleteFolderPath}`);
            }

            return res.status(200).send({ message: 'Archivos copiados correctamente', fileName });
        } catch (err) {
            console.error('Error en el proceso de copia/eliminación:', err);
            return res.status(500).json({ message: 'Error al procesar archivos.' });
        }
    });

    // Stream endpoint
    router.get('/stream', (req, res) => {
        res.set({
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });
        res.flushHeaders();

        const interval = setInterval(() => {
            const outputFiles = fs.readdirSync(localOutputFolder);
            const completedFiles = outputFiles.filter(f => f.endsWith('.complete'));
            if (completedFiles.length > 0) {
                res.write(`data: ${JSON.stringify({ completed: true, files: completedFiles })}\n\n`);
            }
        }, 2000);

        req.on('close', () => {
            clearInterval(interval);
        });
    });

    // Check status endpoint for state recovery
    router.get('/check-status/:clientId', requireServerAuth, (req, res) => {
        const { clientId } = req.params;
        if (!clientId) return res.status(400).json({ message: 'Client ID required' });

        // Rechazar sesiones invalidadas
        if (invalidatedSessions.has(clientId)) {
            console.log(`[SERVER] ❌ check-status rechazado para sesión invalidada: ${clientId}`);
            return res.json({ status: 'expired', content: '', logs: [] });
        }

        // Determinar si es generación (token) o simplificación (filename.pdf)
        const isSimplification = clientId.toLowerCase().endsWith('.pdf');

        let outputFileName, progressLogPath, completeFilePath, workingFilePath;

        if (isSimplification) {
            outputFileName = clientId.replace('.pdf', '.md');
            progressLogPath = path.join(localOutputFolder, clientId.replace('.pdf', '.progress.log'));
            completeFilePath = path.join(localOutputFolder, clientId.replace('.pdf', '.complete'));
            workingFilePath = path.join(localOutputFolder, outputFileName);
        } else {
            // Generación (token)
            outputFileName = `${clientId}.md`;
            progressLogPath = path.join(localOutputFolder, `${clientId}.progress.log`);
            completeFilePath = path.join(localOutputFolder, `${clientId}_anamnesis.complete`);
            workingFilePath = path.join(localOutputFolder, outputFileName);
        }

        const statusResponse = {
            status: 'idle',
            content: '',
            logs: []
        };

        // 1. Check if completed
        if (fs.existsSync(completeFilePath)) {
            statusResponse.status = 'completed';
            if (fs.existsSync(workingFilePath)) {
                statusResponse.content = fs.readFileSync(workingFilePath, 'utf8');
            }
            return res.json(statusResponse);
        }

        // 2. Check if in progress
        if (fs.existsSync(progressLogPath)) {
            statusResponse.status = 'processing';

            // Read existing content if any
            if (fs.existsSync(workingFilePath)) {
                statusResponse.content = fs.readFileSync(workingFilePath, 'utf8');
            }

            // Read logs
            try {
                const logsContent = fs.readFileSync(progressLogPath, 'utf8');
                const lines = logsContent.split('\n');
                statusResponse.logs = lines
                    .filter(line => line.trim())
                    .map(line => {
                        try {
                            return JSON.parse(line);
                        } catch (e) {
                            return { message: line, type: 'info' };
                        }
                    });
            } catch (e) {
                console.error(`Error reading progress logs for ${clientId}:`, e);
            }

            return res.json(statusResponse);
        }

        // 3. Fallback: Check if output file exists but no complete/progress (maybe finished but cleanup happened? or just started)
        if (fs.existsSync(workingFilePath)) {
            // If we have content but no complete flag and no progress log, it's ambiguous. 
            // However, usually progress log is deleted ONLY after completion is notified. 
            // If complete file is missing but content exists, maybe it was interrupted or it's an old file.
            // Let's assume 'completed' if significant content exists, or 'idle' if not.
            // For safety, let's just return what we have.
            statusResponse.content = fs.readFileSync(workingFilePath, 'utf8');
            // If it has content, it might be completed from a previous run.
            statusResponse.status = 'completed'; // Assume completed if file exists and no progress log
            return res.json(statusResponse);
        }

        return res.json(statusResponse);
    });

    return router;
};
