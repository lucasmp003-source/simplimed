const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const readline = require('readline');

// Configuración del chatbot
const CHATBOT_CONFIG = {
    PYTHON_TIMEOUT: 30000, // 30 segundos
    MAX_MESSAGE_LENGTH: 5000,
    CONDA_ENV: 'galeno'
};

// Sistema de logging para el chatbot
const chatbot_log_file = fs.createWriteStream(path.join(__dirname, '..', 'chatbot', 'debug.log'), { flags: 'a' });
const chatbot_logger = {
    log: (message) => {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] ${message}`;
        chatbot_log_file.write(logMessage + '\n');
        console.log(logMessage);
    },
    error: (message) => {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] ERROR: ${message}`;
        chatbot_log_file.write(logMessage + '\n');
        console.error(logMessage);
    }
};

class PersistentChatbot {
    constructor() {
        this.process = null;
        this.isReady = false;
        this.messageQueue = [];
        this.pendingRequests = new Map();
        this.requestIdCounter = 0;
    }

    async start() {
        return new Promise((resolve, reject) => {
            console.log('[CHATBOT] 🚀 Iniciando proceso persistente del chatbot...');

            const workingDir = path.join(__dirname, '..', 'chatbot');
            const command = `eval "$(conda shell.bash hook)" && conda activate ${CHATBOT_CONFIG.CONDA_ENV} && python chatbot.py`;

            this.process = spawn('bash', ['-c', command], {
                cwd: workingDir,
                env: {
                    ...process.env,
                    PYTHONUNBUFFERED: '1'
                }
            });

            // Crear interfaces de lectura
            const stdoutReader = readline.createInterface({
                input: this.process.stdout,
                crlfDelay: Infinity
            });

            const stderrReader = readline.createInterface({
                input: this.process.stderr,
                crlfDelay: Infinity
            });

            // Manejar salida estándar (respuestas JSON)
            stdoutReader.on('line', (line) => {
                try {
                    const response = JSON.parse(line);

                    // Si hay una petición pendiente, resolverla
                    const pendingRequest = this.messageQueue.shift();
                    if (pendingRequest) {
                        pendingRequest.resolve(response);
                    }
                } catch (e) {
                    console.error('[CHATBOT] ❌ Error parseando respuesta:', e.message);
                    console.error('[CHATBOT] Línea recibida:', line);
                }
            });

            // Manejar errores y logs
            stderrReader.on('line', (line) => {
                console.log(`[CHATBOT] ${line}`);

                // Detectar cuando el chatbot está listo
                if (line.includes('Servidor listo para recibir peticiones') ||
                    line.includes('✅ Chatbot inicializado y listo')) {
                    this.isReady = true;
                    console.log('[CHATBOT] ✅ Chatbot listo para recibir peticiones');
                    resolve();
                }
            });

            // Manejar errores del proceso
            this.process.on('error', (error) => {
                console.error('[CHATBOT] ❌ Error en proceso:', error);
                this.isReady = false;
                reject(error);
            });

            // Manejar cierre del proceso
            this.process.on('close', (code) => {
                console.log(`[CHATBOT] ⚠️  Proceso cerrado con código ${code}`);
                this.isReady = false;

                // Rechazar todas las peticiones pendientes
                this.messageQueue.forEach(req => {
                    req.reject(new Error('Proceso del chatbot cerrado'));
                });
                this.messageQueue = [];
            });

            // Timeout de 60 segundos para inicialización
            setTimeout(() => {
                if (!this.isReady) {
                    reject(new Error('Timeout inicializando chatbot'));
                }
            }, 300000);
        });
    }

    async sendMessage(message, conversationId = null, action = 'chat') {
        if (!this.isReady) {
            throw new Error('Chatbot no está listo');
        }

        return new Promise((resolve, reject) => {
            this.messageQueue.push({ resolve, reject });

            // Enviar mensaje con conversation_id y action
            const jsonMessage = JSON.stringify({
                message,
                conversation_id: conversationId,
                action: action
            }) + '\n';

            this.process.stdin.write(jsonMessage);

            setTimeout(() => {
                const index = this.messageQueue.findIndex(req => req.resolve === resolve);
                if (index !== -1) {
                    this.messageQueue.splice(index, 1);
                    reject(new Error('Timeout esperando respuesta del chatbot'));
                }
            }, CHATBOT_CONFIG.PYTHON_TIMEOUT);
        });
    }

    stop() {
        if (this.process) {
            console.log('[CHATBOT] 🛑 Deteniendo proceso del chatbot...');
            this.process.kill('SIGTERM');
            this.isReady = false;
        }
    }

    restart() {
        console.log('[CHATBOT] 🔄 Reiniciando chatbot...');
        this.stop();
        return this.start();
    }
}

// Instancia global del chatbot
const persistentChatbot = new PersistentChatbot();

// Inicializar el chatbot al arrancar el servidor
async function initializeChatbotOnStartup() {
    console.log('[SERVER] 🤖 Inicializando chatbot persistente al arrancar...');
    try {
        await persistentChatbot.start();
        console.log('[SERVER] ✅ Chatbot inicializado correctamente');
    } catch (error) {
        console.error('[SERVER] ❌ Error al inicializar chatbot:', error);
        console.error('[SERVER] ⚠️  El chatbot no estará disponible hasta que se reinicie manualmente');
    }
}

module.exports = {
    PersistentChatbot,
    persistentChatbot,
    CHATBOT_CONFIG,
    chatbot_logger,
    initializeChatbotOnStartup
};
