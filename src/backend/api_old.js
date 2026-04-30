const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');

// Server-side session store (In-memory)
// Maps sessionToken -> { userId, email, role, expiry }
const ACTIVE_SESSIONS = new Map();
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

const { spawn } = require('child_process');
let scriptProcess = null;

// ========== SISTEMA DE RECUPERACIÓN DE CONTRASEÑA ==========

// Base de datos de usuarios - Persistida en archivo JSON
// IMPORTANTE: Las contraseñas están hasheadas con bcrypt
const usersFilePath = path.join(__dirname, 'users.json');
let USERS_DATABASE = [];

// Función para cargar usuarios desde el archivo
function loadUsers() {
    try {
        if (fs.existsSync(usersFilePath)) {
            const data = fs.readFileSync(usersFilePath, 'utf8');
            USERS_DATABASE = JSON.parse(data);
            console.log(`[SERVER] ✅ ${USERS_DATABASE.length} usuarios cargados desde ${usersFilePath}`);
        } else {
            console.log('[SERVER] ⚠️  Archivo de usuarios no encontrado. Creando uno por defecto...');
            // Usuarios por defecto
            USERS_DATABASE = [
                {
                    id: 1,
                    email: 'lmolino@ujaen.es',
                    password: '$2b$10$h4arzB4rHLYpQDvdd0SzFuEQeX/MwCFIUhzgcV5zI3O.beXzLbqYG', // lmolino
                    firstName: 'Lucas',
                    lastName: 'Molino Piñar',
                    role: 'admin',
                    institution: 'Universidad de Jaén - SINAI'
                },
                {
                    id: 2,
                    email: 'mcdiaz@ujaen.es',
                    password: '$2b$10$.LeXweFpN1nqF3pKQ5mbpefFenI56QqVcrBKUeYcPcEjqQM5Qp.I.', // mcdiaz
                    firstName: 'Manuel Carlos',
                    lastName: 'Díaz Galiano',
                    role: 'tester',
                    institution: 'Universidad de Jaén - SINAI'
                },
                {
                    id: 3,
                    email: 'maite@ujaen.es',
                    password: '$2b$10$yAzfeqccLA8thntOK5fm1OXWJZBCXIYFeyyHZdQp897687xEEcHXq', // maite
                    firstName: 'Maite',
                    lastName: 'Martín Valdivia',
                    role: 'tester',
                    institution: 'Universidad de Jaén - SINAI'
                }
            ];
            saveUsers(); // Guardar usuarios por defecto
        }
    } catch (error) {
        console.error('[SERVER] ❌ Error al cargar usuarios:', error);
        USERS_DATABASE = [];
    }
}

// Función para guardar usuarios en el archivo
function saveUsers() {
    try {
        fs.writeFileSync(usersFilePath, JSON.stringify(USERS_DATABASE, null, 4), 'utf8');
        console.log(`[SERVER] 💾 Usuarios guardados en ${usersFilePath}`);
    } catch (error) {
        console.error('[SERVER] ❌ Error al guardar usuarios:', error);
    }
}

// Cargar usuarios al iniciar
loadUsers();

// Almacenamiento de tokens de recuperación (en producción usar Redis o BD)
const passwordResetTokens = new Map();

// Configuración de nodemailer para envío de correos
// Cargar configuración desde archivo externo
const smtpConfig = require('./smtp-config/smtp');

const transporter = nodemailer.createTransport(smtpConfig.active);

// Función para generar token de recuperación
function generateResetToken() {
    return crypto.randomBytes(32).toString('hex');
}

// Función para enviar correo de recuperación
async function sendPasswordResetEmail(email, token, userName) {
    const BASE_PATH = process.env.BASE_PATH || '';
    const resetLink = `https://sinai.ujaen.es${BASE_PATH}/reset-password?token=${token}`;

    // Mostrar en consola para debugging
    console.log('\n=== ENVIANDO EMAIL DE RECUPERACIÓN DE CONTRASEÑA ===');
    console.log(`Para: ${email}`);
    console.log(`Nombre: ${userName}`);
    console.log(`Link de recuperación: ${resetLink}`);
    console.log(`El token expira en 1 hora`);

    try {
        // Configurar opciones del correo
        const mailOptions = {
            from: '"GALENO-IA - SINAI" <u0971583494@gmail.com>',
            to: email,
            subject: 'Recuperación de Contraseña - GALENO-IA',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
                    <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                        <div style="text-align: center; margin-bottom: 30px;">
                            <h1 style="color: #d9534f; margin: 0;">GALENO<span style="color: #333;">-IA</span></h1>
                            <p style="color: #666; margin: 5px 0 0 0;">Sistema Inteligente de Simplificación de Informes Cardiológicos</p>
                        </div>
                        
                        <h2 style="color: #333; border-bottom: 2px solid #d9534f; padding-bottom: 10px;">Recuperación de Contraseña</h2>
                        
                        <p style="color: #555; line-height: 1.6;">Hola <strong>${userName}</strong>,</p>
                        
                        <p style="color: #555; line-height: 1.6;">
                            Hemos recibido una solicitud para restablecer la contraseña de tu cuenta en GALENO-IA.
                        </p>
                        
                        <p style="color: #555; line-height: 1.6;">
                            Haz clic en el siguiente botón para crear una nueva contraseña:
                        </p>
                        
                        <div style="text-align: center; margin: 35px 0;">
                            <a href="${resetLink}" 
                               style="background-color: #d9534f; color: white; padding: 15px 40px; 
                                      text-decoration: none; border-radius: 5px; display: inline-block;
                                      font-weight: bold; font-size: 16px;">
                                🔒 Restablecer Contraseña
                            </a>
                        </div>
                        
                        <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 12px; margin: 20px 0;">
                            <p style="margin: 0; color: #856404; font-size: 14px;">
                                ⚠️ <strong>Importante:</strong> Este enlace expirará en <strong>1 hora</strong>.
                            </p>
                        </div>
                        
                        <p style="color: #555; line-height: 1.6; font-size: 14px;">
                            Si no puedes hacer clic en el botón, copia y pega el siguiente enlace en tu navegador:
                        </p>
                        
                        <p style="background-color: #f5f5f5; padding: 10px; border-radius: 5px; word-break: break-all; font-size: 12px; color: #666;">
                            ${resetLink}
                        </p>
                        
                        <div style="background-color: #d1ecf1; border-left: 4px solid #17a2b8; padding: 12px; margin: 20px 0;">
                            <p style="margin: 0; color: #0c5460; font-size: 14px;">
                                🛡️ Si no solicitaste este cambio, puedes ignorar este correo de forma segura. 
                                Tu contraseña no será modificada.
                            </p>
                        </div>
                        
                        <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
                        
                        <div style="text-align: center; color: #666; font-size: 12px;">
                            <p style="margin: 5px 0;">
                                <strong>GALENO-IA</strong><br>
                                Sistema Inteligente de Simplificación de Informes Cardiológicos
                            </p>
                            <p style="margin: 5px 0;">
                                Grupo de Investigación SINAI<br>
                                Universidad de Jaén
                            </p>
                            <p style="margin: 15px 0 5px 0; color: #999; font-size: 11px;">
                                Este es un correo automático, por favor no respondas a este mensaje.
                            </p>
                        </div>
                    </div>
                </div>
            `,
            text: `
GALENO-IA - Recuperación de Contraseña

Hola ${userName},

Hemos recibido una solicitud para restablecer la contraseña de tu cuenta en GALENO-IA.

Para crear una nueva contraseña, accede al siguiente enlace:
${resetLink}

IMPORTANTE: Este enlace expirará en 1 hora.

Si no solicitaste este cambio, puedes ignorar este correo de forma segura. Tu contraseña no será modificada.

---
GALENO-IA
Sistema Inteligente de Simplificación de Informes Cardiológicos
Grupo de Investigación SINAI - Universidad de Jaén
            `
        };

        // Enviar el correo
        const info = await transporter.sendMail(mailOptions);

        console.log('✅ Email enviado exitosamente!');
        console.log('Message ID:', info.messageId);
        console.log('====================================================\n');

        return true;

    } catch (error) {
        console.error('❌ Error al enviar el email:');
        console.error(error.message);
        console.log('====================================================');
        console.log('ℹ️  MODO DESARROLLO ACTIVO');
        console.log('   El enlace arriba es válido y funcional.');
        console.log('   Cópialo y pégalo en tu navegador para continuar.');
        console.log('====================================================\n');

        // En modo desarrollo, continuamos aunque falle el envío
        // El enlace ya se mostró en consola y es funcional
        return true;
    }
}





// ========== SISTEMA DE INVITACIÓN DE USUARIOS ==========

// Almacenamiento de invitaciones pendientes (token -> { email, role, institution, expiry })
const pendingInvitations = new Map();

// Función para generar token de invitación
function generateInvitationToken() {
    return crypto.randomBytes(32).toString('hex');
}

// Función para enviar correo de invitación
async function sendInvitationEmail(email, token, role, institution) {
    const BASE_PATH_EMAIL = process.env.BASE_PATH || '';
    const invitationLink = `https://sinai.ujaen.es${BASE_PATH_EMAIL}/complete-registration?token=${token}`;
    const roleNames = { 'admin': 'Administrador', 'tester': 'Tester', 'user': 'Doctor (Usuario)' };
    const roleName = roleNames[role] || role;

    console.log('\n=== ENVIANDO EMAIL DE INVITACIÓN ===');
    console.log(`Para: ${email}, Rol: ${roleName}, Link: ${invitationLink}`);

    try {
        const mailOptions = {
            from: '"GALENO-IA - SINAI" <u0971583494@gmail.com>',
            to: email,
            subject: 'Invitación a GALENO-IA - Completa tu registro',
            html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;"><div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);"><div style="text-align: center; margin-bottom: 30px;"><h1 style="color: #d9534f; margin: 0;">GALENO<span style="color: #333;">-IA</span></h1></div><h2 style="color: #333; border-bottom: 2px solid #d9534f; padding-bottom: 10px;">¡Has sido invitado!</h2><p style="color: #555;">Has sido invitado a unirte a <strong>GALENO-IA</strong> como <strong>${roleName}</strong>.</p>${institution ? `<p style="color: #555;">Institución: <strong>${institution}</strong></p>` : ''}<div style="text-align: center; margin: 35px 0;"><a href="${invitationLink}" style="background-color: #d9534f; color: white; padding: 15px 40px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">✨ Completar Registro</a></div><div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 12px; margin: 20px 0;"><p style="margin: 0; color: #856404;">⚠️ Este enlace expirará en <strong>48 horas</strong>.</p></div></div></div>`,
            text: `Has sido invitado a GALENO-IA como ${roleName}. Completa tu registro: ${invitationLink}`
        };
        await transporter.sendMail(mailOptions);
        console.log('✅ Email de invitación enviado correctamente');
        return true;
    } catch (error) {
        console.error('❌ Error al enviar email:', error.message);
        console.log('ℹ️  DESARROLLO: Enlace válido ->', invitationLink);
        return true;
    }
}

const app = express();
const port = 8080;

// Configurar base path para despliegue en subdirectorios
// Si se despliega en /galeno, configurar BASE_PATH=/galeno
// Para desarrollo local, dejar BASE_PATH vacío o no configurarlo
const BASE_PATH = process.env.BASE_PATH || '';

app.use(express.json());
app.use(cookieParser());

// Server-Side Auth Middleware
// Checks for HttpOnly cookie 'auth_token' and verifies against memory store
function requireServerAuth(req, res, next) {
    const token = req.cookies.auth_token;

    if (!token || !ACTIVE_SESSIONS.has(token)) {
        // Redirect to login if not authenticated
        const basePath = req.needsGalenoPrefix ? '/galeno' : '';
        console.log(`[AUTH] Access denied to ${req.path} - Redirecting to login`);
        return res.redirect(`${basePath}/login`);
    }

    // Check expiry
    const session = ACTIVE_SESSIONS.get(token);
    if (Date.now() > session.expiry) {
        ACTIVE_SESSIONS.delete(token); // Cleanup expired
        const basePath = req.needsGalenoPrefix ? '/galeno' : '';
        console.log(`[AUTH] Session expired for ${session.email} - Redirecting to login`);
        return res.redirect(`${basePath}/login`);
    }

    // Attach user to request
    req.user = session;
    next();
}

// Middleware to require 'admin' or 'tester' role for metrics access
function requireMetricsRole(req, res, next) {
    if (!req.user) {
        // Should be used after requireServerAuth, but double check
        return res.status(401).send('Unauthorized');
    }

    if (req.user.role === 'admin' || req.user.role === 'tester') {
        next();
    } else {
        console.log(`[AUTH] Access denied to metrics for ${req.user.email} (Role: ${req.user.role})`);
        res.status(403).send('Acceso denegado: Se requieren permisos de Tester o Administrador.');
    }
}

// Middleware to require 'admin' role
function requireAdminRole(req, res, next) {
    if (!req.user) {
        return res.status(401).send('Unauthorized');
    }

    if (req.user.role === 'admin') {
        next();
    } else {
        console.log(`[AUTH] Access denied to admin area for ${req.user.email} (Role: ${req.user.role})`);
        res.status(403).send('Acceso denegado: Se requieren permisos de Administrador.');
    }
}

// Passive Session Check Middleware (does not redirect)
// Used for pages where auth is optional but we want user info if available
function passiveSessionCheck(req, res, next) {
    const token = req.cookies.auth_token;

    if (token && ACTIVE_SESSIONS.has(token)) {
        const session = ACTIVE_SESSIONS.get(token);
        if (Date.now() <= session.expiry) {
            req.user = session;
        } else {
            ACTIVE_SESSIONS.delete(token); // Cleanup
        }
    }
    next();
}

// ========== SECURITY MIDDLEWARE ==========

// Helmet - adds security headers (X-Frame-Options, CSP, etc.)
app.use(helmet({
    contentSecurityPolicy: false, // Disable CSP as it may break inline scripts
    crossOriginEmbedderPolicy: false
}));

// Rate limiting for authentication endpoints (brute force protection)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts per window
    message: {
        success: false,
        message: 'Demasiados intentos de acceso. Por favor, espera 15 minutos.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip || req.connection.remoteAddress
});

// General API rate limiting
const apiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 100, // 100 requests per minute per IP
    message: {
        success: false,
        message: 'Demasiadas solicitudes. Por favor, reduce la frecuencia.'
    },
    standardHeaders: true,
    legacyHeaders: false
});

// Apply rate limiters
app.use('/api/login', authLimiter);
app.use('/api/forgot-password', authLimiter);
app.use('/api/reset-password', authLimiter);
app.use('/api/', apiLimiter);

// ===========================================

// Middleware para detectar si estamos detrás de un proxy (Apache)
// y determinar el BASE_PATH correcto
app.use((req, res, next) => {
    // Debug: mostrar todas las cabeceras en la primera petición HTML
    if (req.path === '/' || req.path === '/login') {
        console.log('[DEBUG] Cabeceras HTTP recibidas:');
        console.log('  X-Forwarded-For:', req.headers['x-forwarded-for']);
        console.log('  X-Forwarded-Proto:', req.headers['x-forwarded-proto']);
        console.log('  X-Forwarded-Host:', req.headers['x-forwarded-host']);
        console.log('  X-Original-URL:', req.headers['x-original-url']);
        console.log('  X-Forwarded-Prefix:', req.headers['x-forwarded-prefix']);
        console.log('  Host:', req.headers['host']);
        console.log('  Origin:', req.headers['origin']);
        console.log('  Referer:', req.headers['referer']);
    }

    // Detectar si venimos de producción (sinai.ujaen.es) o desarrollo (localhost)
    const host = req.headers['x-forwarded-host'] || req.headers['host'] || '';
    const isProduction = host.includes('sinai.ujaen.es');

    // Si estamos en producción, marcar que necesitamos /galeno
    if (isProduction) {
        req.needsGalenoPrefix = true;
    }

    // Si la ruta comienza con /galeno, reescribirla para quitarlo
    // pero guardando la ruta original
    if (req.path.startsWith('/galeno/') || req.path === '/galeno') {
        req.originalPath = req.path; // Guardar ruta original
        req.url = req.url.replace('/galeno', '') || '/';
        req.needsGalenoPrefix = true;
        console.log(`[DEBUG] Normalizando ruta: ${req.originalPath} -> ${req.url}`);
    }

    next();
});

// ========== MIDDLEWARE DE MANTENIMIENTO ==========
// Para activar el modo mantenimiento, establecer MAINTENANCE_MODE=true
const MAINTENANCE_MODE = process.env.MAINTENANCE_MODE === 'true';
const maintenancePath = path.join(__dirname, '../../maintenance.html');

if (MAINTENANCE_MODE) {
    console.log('⚠️  [MANTENIMIENTO] Modo mantenimiento activado');
    console.log(`📄 [MANTENIMIENTO] Página: ${maintenancePath}`);
    if (fs.existsSync(maintenancePath)) {
        console.log('✅ [MANTENIMIENTO] Archivo maintenance.html encontrado');
    } else {
        console.log('❌ [MANTENIMIENTO] ADVERTENCIA: maintenance.html no encontrado, usando página por defecto');
    }
}

app.use((req, res, next) => {
    if (MAINTENANCE_MODE) {
        // Permitir acceso a recursos estáticos de la página de mantenimiento
        if (req.path.includes('.css') || req.path.includes('.js') || req.path.includes('.ico') || req.path.includes('.png') || req.path.includes('.jpg')) {
            return next();
        }

        console.log(`🔧 [MANTENIMIENTO] Bloqueando acceso a: ${req.method} ${req.path}`);

        // Mostrar página de mantenimiento para todas las demás rutas
        if (fs.existsSync(maintenancePath)) {
            return res.status(503).sendFile(maintenancePath);
        } else {
            console.log('⚠️  [MANTENIMIENTO] Usando página de mantenimiento por defecto');
            return res.status(503).send(`
                <!DOCTYPE html>
                <html lang="es">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Mantenimiento - SimpliMed</title>
                    <style>
                        body {
                            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                            min-height: 100vh;
                            display: flex;
                            justify-content: center;
                            align-items: center;
                            margin: 0;
                        }
                        .container {
                            background: white;
                            padding: 50px;
                            border-radius: 20px;
                            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                            text-align: center;
                            max-width: 500px;
                        }
                        h1 { color: #333; margin-bottom: 20px; }
                        p { color: #666; line-height: 1.6; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h1>🔧 Sistema en Mantenimiento</h1>
                        <p>Estamos mejorando SimpliMed para ofrecerte una mejor experiencia.</p>
                        <p>Volveremos pronto. Gracias por tu paciencia.</p>
                    </div>
                </body>
                </html>
            `);
        }
    }
    next();
});
// ================================================

// Middleware de debug para ver qué rutas llegan
app.use((req, res, next) => {
    if (req.path.includes('css') || req.path.includes('js') || req.path.includes('images')) {
        console.log(`[DEBUG] Petición estática: ${req.method} ${req.path} | BASE_PATH='${BASE_PATH}'`);
    }

    // Capturar respuesta para logging
    const originalSend = res.send;
    res.send = function (data) {
        if (req.path.includes('.js')) {
            console.log(`[DEBUG] Respondiendo ${req.path} con Content-Type: ${res.getHeader('Content-Type')} | Status: ${res.statusCode}`);
        }
        originalSend.call(this, data);
    };

    next();
});

const localProductionFolder = path.join(__dirname, '../data/ProductionData');
const localOutputFolder = path.join(__dirname, '../data/OutputData');
const localGenerationFolder = path.join(__dirname, '../data/GenerationData');
const localRunScript = path.join(__dirname, './run_backend.sh'); // Asumiendo que ahora el script es local

const H_localProductionFolder = path.join(__dirname, '../data/H_ProductionData');
const H_localOutputFolder = path.join(__dirname, '../data/H_OutputData');

// Servir configuración del base path como JavaScript
// Gracias al middleware de normalización, funciona tanto con /galeno como sin él
app.get('/config.js', (req, res) => {
    const basePath = req.needsGalenoPrefix ? '/galeno' : (BASE_PATH || '');

    console.log(`[DEBUG] Sirviendo config.js con BASE_PATH='${basePath}' (needsGalenoPrefix: ${req.needsGalenoPrefix})`);

    res.setHeader('Content-Type', 'application/javascript');
    res.send(`window.BASE_PATH = '${basePath}';`);
});

// Archivos estáticos - IMPORTANTE: Servir solo subcarpetas específicas (css, js, images),
// NO toda la carpeta frontend, para evitar que los HTML se sirvan sin inyección de BASE_PATH
// Gracias al middleware de normalización, solo necesitamos definir las rutas sin /galeno

// Opciones para express.static con tipos MIME correctos
const staticOptions = {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript; charset=UTF-8');
        } else if (filePath.endsWith('.css')) {
            res.setHeader('Content-Type', 'text/css; charset=UTF-8');
        }
    }
};

app.use('/public/css', express.static(path.join(__dirname, '../frontend/css'), staticOptions));
app.use('/public/js', express.static(path.join(__dirname, '../frontend/js'), staticOptions));
app.use('/public/images', express.static(path.join(__dirname, '../frontend/images')));
app.use('/frontend/css', express.static(path.join(__dirname, '../frontend/css'), staticOptions));
app.use('/frontend/js', express.static(path.join(__dirname, '../frontend/js'), staticOptions));
app.use('/frontend/images', express.static(path.join(__dirname, '../frontend/images')));

// Metrics Dashboard (web component)
app.use('/metrics', requireServerAuth, requireMetricsRole, express.static(path.join(__dirname, '../frontend/metrics')));

// ==========================================
// API METRICAS (Ported from web/server.js)
// ==========================================
const METRICS_OUTPUT_DIR = path.join(__dirname, '../frontend/metrics/output');

// Helper function to check if file exists
async function fileExists(filePath) {
    try {
        await fs.promises.access(filePath);
        return true;
    } catch {
        return false;
    }
}

// Helper function to find metrics file
async function findMetricsFile(experimentPath) {
    const candidates = ['test_metrics.json', 'test_metrics_vllm.json'];
    for (const candidate of candidates) {
        const filePath = path.join(experimentPath, candidate);
        if (await fileExists(filePath)) {
            return filePath;
        }
    }
    return null;
}

// List all experiments
app.get('/api/experiments', requireServerAuth, requireMetricsRole, async (req, res) => {
    try {
        if (!fs.existsSync(METRICS_OUTPUT_DIR)) {
            return res.json({});
        }
        const families = await fs.promises.readdir(METRICS_OUTPUT_DIR, { withFileTypes: true });
        const result = {};

        for (const family of families) {
            if (!family.isDirectory()) continue;

            const familyPath = path.join(METRICS_OUTPUT_DIR, family.name);
            const models = await fs.promises.readdir(familyPath, { withFileTypes: true });

            const modelList = [];
            for (const model of models) {
                if (!model.isDirectory()) continue;

                const modelPath = path.join(familyPath, model.name);
                const metricsFile = await findMetricsFile(modelPath);

                let hasLlmScore = false;
                if (metricsFile) {
                    try {
                        const metricsData = JSON.parse(await fs.promises.readFile(metricsFile, 'utf8'));
                        hasLlmScore = metricsData.globales?.llm_score !== undefined;
                    } catch (e) {
                        console.error(`Error reading metrics for ${model.name}:`, e);
                    }
                }

                modelList.push({
                    name: model.name,
                    hasLlmScore
                });
            }

            if (modelList.length > 0) {
                result[family.name] = modelList;
            }
        }

        res.json(result);
    } catch (error) {
        console.error("Error listing experiments:", error);
        res.status(500).json({ error: "Failed to list experiments" });
    }
});

// Get metrics for a specific experiment
app.get('/api/experiments/:family/:id/metrics', requireServerAuth, requireMetricsRole, async (req, res) => {
    try {
        const { family, id } = req.params;
        const experimentPath = path.join(METRICS_OUTPUT_DIR, family, id);

        const metricsFile = await findMetricsFile(experimentPath);
        if (!metricsFile) {
            return res.status(404).json({ error: "Metrics not found" });
        }

        const data = await fs.promises.readFile(metricsFile, 'utf8');
        res.json(JSON.parse(data));
    } catch (error) {
        console.error(`Error reading metrics for ${req.params.family}/${req.params.id}:`, error);
        res.status(404).json({ error: "Metrics not found" });
    }
});
// ==========================================

// Helper function to find results/predictions file
async function findResultsFile(experimentPath) {
    const candidates = ['llm_evaluation_results.json', 'test_predictions.json', 'test_predictions_vllm.json'];
    for (const candidate of candidates) {
        const filePath = path.join(experimentPath, candidate);
        if (await fileExists(filePath)) {
            return { path: filePath, type: candidate };
        }
    }
    return null;
}

// Get results/predictions for a specific experiment
app.get('/api/experiments/:family/:id/results', requireServerAuth, requireMetricsRole, async (req, res) => {
    try {
        const { family, id } = req.params;
        const experimentPath = path.join(METRICS_OUTPUT_DIR, family, id);

        const resultsFile = await findResultsFile(experimentPath);
        if (!resultsFile) {
            return res.status(404).json({ error: "Results not found" });
        }

        const data = await fs.promises.readFile(resultsFile.path, 'utf8');
        const parsedData = JSON.parse(data);

        // Normalize response format based on file type
        let response;
        if (resultsFile.type === 'llm_evaluation_results.json') {
            // Already has the expected format with 'details' array
            response = parsedData;
        } else {
            // test_predictions.json or test_predictions_vllm.json - wrap in consistent format
            response = {
                details: Array.isArray(parsedData) ? parsedData : parsedData.predictions || [],
                source: resultsFile.type
            };
        }

        res.json(response);
    } catch (error) {
        console.error(`Error reading results for ${req.params.family}/${req.params.id}:`, error);
        res.status(404).json({ error: "Results not found" });
    }
});

app.use('/ProductionData', express.static(path.join(__dirname, '../data/ProductionData')));
app.use('/data/ProductionData', express.static(path.join(__dirname, '../data/ProductionData')));
app.use('/data/OutputData', express.static(path.join(__dirname, '../data/OutputData')));
app.use('/tempUploads', express.static(path.join(__dirname, './tempUploads')));


// Helper para servir HTML con BASE_PATH inyectado
function serveHtmlWithBasePath(filePath) {
    return (req, res) => {
        fs.readFile(filePath, 'utf8', (err, html) => {
            if (err) {
                res.status(500).send('Error al cargar la página');
                return;
            }

            // Determinar el BASE_PATH correcto basado en la detección de producción
            let baseTag;
            let basePath;

            if (req.needsGalenoPrefix) {
                basePath = '/galeno';
                baseTag = '<base href="/galeno/">';
            } else if (BASE_PATH) {
                basePath = BASE_PATH;
                baseTag = `<base href="${BASE_PATH}/">`;
            } else {
                basePath = '/';
                baseTag = '<base href="/">';
            }

            console.log(`[DEBUG] Sirviendo HTML con BASE_PATH ${basePath} para: ${req.path} (needsGalenoPrefix: ${req.needsGalenoPrefix})`);

            let modifiedHtml = html.replace('<!-- BASE_PLACEHOLDER -->', baseTag);

            // Inject shared footer from partial
            const footerPath = path.join(__dirname, '../frontend/views/partials/footer.html');
            try {
                const footerHtml = fs.readFileSync(footerPath, 'utf8');
                modifiedHtml = modifiedHtml.replace('<!-- FOOTER_PLACEHOLDER -->', footerHtml);
            } catch (e) {
                console.error('[WARN] Could not load footer partial:', e.message);
            }

            // Inject shared header from partial
            const headerPath = path.join(__dirname, '../frontend/views/partials/header.html');
            try {
                const headerHtml = fs.readFileSync(headerPath, 'utf8');
                modifiedHtml = modifiedHtml.replace('<!-- HEADER_PLACEHOLDER -->', headerHtml);
            } catch (e) {
                console.error('[WARN] Could not load header partial:', e.message);
            }

            // Server-Side Injection of User Data
            // Replaces client-side storage. Client reads this global variable.
            if (req.user) {
                const userSafe = JSON.stringify({
                    id: req.user.id,
                    firstName: req.user.firstName,
                    lastName: req.user.lastName,
                    email: req.user.email,
                    institution: req.user.institution,
                    role: req.user.role
                });
                const injection = `<script>window.GALENO_USER = ${userSafe};</script>`;
                modifiedHtml = modifiedHtml.replace('</head>', `${injection}\n</head>`);
            }

            res.send(modifiedHtml);
        });
    };
}

// Rutas HTML - Gracias al middleware de normalización, solo necesitamos definirlas sin /galeno
app.get('/', requireServerAuth, serveHtmlWithBasePath(path.join(__dirname, '../frontend/views', 'index.html')));
app.get('/simplificar', requireServerAuth, serveHtmlWithBasePath(path.join(__dirname, '../frontend/views', 'simplificar.html')));
app.get('/generar', requireServerAuth, serveHtmlWithBasePath(path.join(__dirname, '../frontend/views', 'generar.html')));
app.get('/login', serveHtmlWithBasePath(path.join(__dirname, '../frontend/views', 'login.html')));
app.get('/forgot-password', serveHtmlWithBasePath(path.join(__dirname, '../frontend/views', 'forgot-password.html')));
app.get('/reset-password', serveHtmlWithBasePath(path.join(__dirname, '../frontend/views', 'reset-password.html')));
app.get('/complete-registration', serveHtmlWithBasePath(path.join(__dirname, '../frontend/views', 'complete-registration.html')));
app.get('/account', requireServerAuth, serveHtmlWithBasePath(path.join(__dirname, '../frontend/views', 'account.html')));
app.get('/performance', requireServerAuth, serveHtmlWithBasePath(path.join(__dirname, '../frontend/views', 'performance.html')));
app.get('/preview-simplificar', requireServerAuth, serveHtmlWithBasePath(path.join(__dirname, '../frontend/views', 'preview-simplificar.html')));
app.get('/preview-generar', requireServerAuth, serveHtmlWithBasePath(path.join(__dirname, '../frontend/views', 'preview-generar.html')));

// Rutas legales
app.get('/privacidad', passiveSessionCheck, serveHtmlWithBasePath(path.join(__dirname, '../frontend/views', 'privacidad.html')));
app.get('/terminos', passiveSessionCheck, serveHtmlWithBasePath(path.join(__dirname, '../frontend/views', 'terminos.html')));
app.get('/aviso-legal', passiveSessionCheck, serveHtmlWithBasePath(path.join(__dirname, '../frontend/views', 'aviso-legal.html')));


// Asegurar existencia de carpetas necesarias
[localProductionFolder, localOutputFolder, './tempUploads'].forEach(folder => {
    if (!fs.existsSync(folder)) {
        fs.mkdirSync(folder, { recursive: true });
    }
});

const clients = []; // Esto debe estar fuera de cualquier handler, en el ámbito global del servidor
// Mapas para gestionar watchers activos y evitar duplicados
const activeFileWatchers = new Map();
const activeProgressWatchers = new Map();

function closeExistingWatchers(clientId) {
    if (activeFileWatchers.has(clientId)) {
        console.log(`[SERVER] Cerrando watcher de archivo existente para ${clientId}`);
        activeFileWatchers.get(clientId).close();
        activeFileWatchers.delete(clientId);
    }

    if (activeProgressWatchers.has(clientId)) {
        console.log(`[SERVER] Cerrando watcher de progreso existente para ${clientId}`);
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
        client.res.write(`data: ${JSON.stringify({
            type: 'progress',
            message: message,
            logType: logType
        })}\n\n`);
    }
}




// Configurar multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, './tempUploads'),
    filename: (req, file, cb) => cb(null, uuidv4() + '.pdf')
});
const upload = multer({ storage: storage });



app.post('/upload', requireServerAuth, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).send({ message: 'No file uploaded' });

    // Ruta completa del archivo subido
    const localTempPath = path.join(__dirname, 'tempUploads', req.file.filename);

    console.log(`[SERVER] [UPLOAD] Archivo recibido en temporal: ${localTempPath}`);

    // Enviar el nombre del archivo a la respuesta
    res.status(200).send({ message: 'Archivo subido correctamente', fileName: req.file.filename });
});





// Endpoint para manejar la conexión SSE
app.get('/events', requireServerAuth, (req, res) => {
    const clientId = req.query.clientId;
    if (!clientId) return res.status(400).send('Falta clientId (usa el nombre del archivo)');

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    clients.push({ id: clientId, res });

    req.on('close', () => {
        const index = clients.findIndex(c => c.id === clientId);
        if (index !== -1) clients.splice(index, 1);
    });
});


// Función para enviar un evento a todos los clientes conectados
function sendSSEMessage(message) {
    clients.forEach(client => {
        client.write(`data: ${JSON.stringify(message)}\n\n`);
    });
}





// Lanzar procesamiento con script local
const chokidar = require('chokidar'); // npm install chokidar si no lo tienes

app.post('/generate', requireServerAuth, (req, res) => {
    const { fileName } = req.body;
    if (!fileName) return res.status(400).send({ message: 'Falta el nombre del archivo.' });

    const clientId = fileName;

    const localTempPath = path.join(__dirname, 'tempUploads', fileName);
    const prodPath = path.join(localProductionFolder, fileName);
    const outputFileName = fileName.replace('.pdf', '.md');
    const outputFilePath = path.join(localOutputFolder, outputFileName);
    const completeFilePath = path.join(localOutputFolder, fileName.replace('.pdf', '.complete'));

    // Cerrar watchers anteriores si existen para este cliente
    closeExistingWatchers(clientId);

    fs.copyFile(localTempPath, prodPath, (err) => {
        if (err) return res.status(500).json({ message: 'Error al copiar el archivo.' });

        console.log(`Archivo ${fileName} copiado correctamente`);

        let lastSize = 0;
        let lastProgressSize = 0;

        // Archivo de progreso (.progress.log)
        const progressLogPath = path.join(localOutputFolder, fileName.replace('.pdf', '.progress.log'));

        const watcher = chokidar.watch(outputFilePath, { usePolling: true, interval: 50 });
        activeFileWatchers.set(clientId, watcher);

        watcher.on('change', () => {
            fs.stat(outputFilePath, (err, stats) => {
                if (err) return;

                const newSize = stats.size;

                if (newSize > lastSize) {
                    const stream = fs.createReadStream(outputFilePath, {
                        start: lastSize,
                        end: newSize
                    });

                    stream.on('data', chunk => {
                        sendChunkToClient(clientId, chunk.toString(), outputFileName);
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
            if (filePath === progressLogPath && !progressFileCreated) {
                progressFileCreated = true;
                console.log(`[SERVER] ✓ Archivo de progreso detectado para ${fileName}`);
                sendProgressToClient(clientId, '📂 Iniciando procesamiento del informe...', 'info');
            }
        });

        progressWatcher.on('change', (filePath) => {
            // Solo procesar cambios en nuestro archivo específico
            if (filePath !== progressLogPath) return;

            console.log(`[SERVER] Cambio detectado en archivo de progreso para ${fileName}`);

            fs.stat(progressLogPath, (err, stats) => {
                if (err) {
                    console.error(`[SERVER] Error al leer stats del archivo de progreso:`, err);
                    return;
                }

                const newSize = stats.size;

                if (newSize > lastProgressSize) {
                    const stream = fs.createReadStream(progressLogPath, {
                        start: lastProgressSize,
                        end: newSize,
                        encoding: 'utf8'
                    });

                    let buffer = '';
                    stream.on('data', chunk => {
                        buffer += chunk;
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

                    stream.on('end', () => {
                        console.log(`[SERVER] Stream de progreso procesado, lastSize: ${lastProgressSize} -> ${newSize}`);
                    });

                    stream.on('error', (err) => {
                        console.error(`[SERVER] Error leyendo stream de progreso:`, err);
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

        res.status(200).json({ message: 'Generación iniciada', fileName });
    });
});

// ==========================================
// ENDPOINTS PARA GENERACIÓN DE INFORMES
// ==========================================

// Configurar multer para múltiples archivos de generación
const uploadGeneration = multer({ storage: storage }).fields([
    { name: 'evolution', maxCount: 1 },
    { name: 'anamnesis', maxCount: 1 }
]);

// Endpoint para subir PDFs de generación (evolución + anamnesis)
app.post('/upload-generation', requireServerAuth, uploadGeneration, (req, res) => {
    if (!req.files || !req.files.evolution || !req.files.anamnesis) {
        return res.status(400).json({ message: 'Faltan archivos. Se requieren evolución y anamnesis.' });
    }

    const evolutionFile = req.files.evolution[0];
    const anamnesisFile = req.files.anamnesis[0];


    console.log(`[SERVER] [GENERATION] Archivos recibidos:`);
    console.log(`   - Evolución: ${evolutionFile.filename}`);
    console.log(`   - Anamnesis: ${anamnesisFile.filename}`);

    // Generar un ID único para este par de archivos (este es el token)
    const token = uuidv4();

    // Definir nombres finales con patrón: token_evolution.pdf, token_anamnesis.pdf
    const evolutionDestPath = path.join(localGenerationFolder, `${token}_evolution.pdf`);
    const anamnesisDestPath = path.join(localGenerationFolder, `${token}_anamnesis.pdf`);

    const evolutionTempPath = path.join(__dirname, 'tempUploads', evolutionFile.filename);
    const anamnesisTempPath = path.join(__dirname, 'tempUploads', anamnesisFile.filename);

    // También crear copias en tempUploads con los nombres basados en token para preview
    const evolutionPreviewPath = path.join(__dirname, 'tempUploads', `${token}_evolution.pdf`);
    const anamnesisPreviewPath = path.join(__dirname, 'tempUploads', `${token}_anamnesis.pdf`);

    // Copiar archivos a GenerationData Y a tempUploads (para preview)
    Promise.all([
        fs.promises.copyFile(evolutionTempPath, evolutionDestPath),
        fs.promises.copyFile(anamnesisTempPath, anamnesisDestPath),
        fs.promises.copyFile(evolutionTempPath, evolutionPreviewPath),
        fs.promises.copyFile(anamnesisTempPath, anamnesisPreviewPath)
    ]).then(() => {
        console.log(`[SERVER] [GENERATION] Archivos guardados:`);
        console.log(`   - GenerationData: ${evolutionDestPath}`);
        console.log(`   - GenerationData: ${anamnesisDestPath}`);
        console.log(`   - TempUploads (preview): ${evolutionPreviewPath}`);
        console.log(`   - TempUploads (preview): ${anamnesisPreviewPath}`);

        // Eliminar archivos temporales originales
        fs.promises.unlink(evolutionTempPath).catch(err => console.error('[SERVER] Error eliminando temp evolution:', err));
        fs.promises.unlink(anamnesisTempPath).catch(err => console.error('[SERVER] Error eliminando temp anamnesis:', err));

        // Solo retornar el token (generationId)
        res.status(200).json({
            message: 'Archivos subidos correctamente',
            generationId: token  // Token único
        });
    }).catch(error => {
        console.error('[SERVER] Error copiando archivos:', error);
        res.status(500).json({ message: 'Error al guardar los archivos.' });
    });
});

// Endpoint para iniciar la generación del informe de alta
app.post('/generate-report', requireServerAuth, (req, res) => {
    const { token } = req.body;

    if (!token) {
        return res.status(400).json({ message: 'Token requerido.' });
    }

    console.log(`[SERVER] [GENERATION] Iniciando generación con token: ${token}`);

    const clientId = token;

    // Construir rutas basadas en el token (SIN prefijo "generated_" para coincidir con Python)
    const outputBaseName = token;
    const outputFileName = `${outputBaseName}.md`;
    const outputFilePath = path.join(localOutputFolder, outputFileName);
    const completeFilePath = path.join(localOutputFolder, `${outputBaseName}.complete`);
    const progressLogPath = path.join(localOutputFolder, `${outputBaseName}.progress.log`);

    // Buscar archivos en GenerationData con patrón: token_evolution.pdf, token_anamnesis.pdf
    const evolutionPattern = `${token}_evolution.pdf`;
    const anamnesisPattern = `${token}_anamnesis.pdf`;

    const evolutionDestPath = path.join(localGenerationFolder, evolutionPattern);
    const anamnesisDestPath = path.join(localGenerationFolder, anamnesisPattern);

    // Validar que existan los archivos
    if (!fs.existsSync(evolutionDestPath) || !fs.existsSync(anamnesisDestPath)) {
        console.error(`[SERVER] [GENERATION] Archivos no encontrados para token: ${token}`);
        console.error(`  - Evolución: ${evolutionDestPath} (exists: ${fs.existsSync(evolutionDestPath)})`);
        console.error(`  - Anamnesis: ${anamnesisDestPath} (exists: ${fs.existsSync(anamnesisDestPath)})`);
        return res.status(404).json({ message: 'Archivos no encontrados para este token.' });
    }

    console.log(`[SERVER] [GENERATION] Archivos encontrados:`);
    console.log(`   - ${evolutionDestPath}`);
    console.log(`   - ${anamnesisDestPath}`);

    let lastSize = 0;
    let lastProgressSize = 0;

    // Monitorear archivo de salida
    const watcher = chokidar.watch(outputFilePath, { usePolling: true, interval: 50 });

    watcher.on('change', () => {
        fs.stat(outputFilePath, (err, stats) => {
            if (err) return;

            const newSize = stats.size;

            if (newSize > lastSize) {
                const stream = fs.createReadStream(outputFilePath, {
                    start: lastSize,
                    end: newSize
                });

                stream.on('data', chunk => {
                    sendChunkToClient(clientId, chunk.toString(), outputFileName);
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

    let progressFileCreated = false;

    progressWatcher.on('add', (filePath) => {
        if (filePath === progressLogPath && !progressFileCreated) {
            progressFileCreated = true;
            console.log(`[SERVER] [GENERATION] ✓ Archivo de progreso detectado`);
            sendProgressToClient(clientId, '📂 Iniciando generación del informe de alta...', 'info');
        }
    });

    progressWatcher.on('change', (filePath) => {
        if (filePath !== progressLogPath) return;

        fs.stat(progressLogPath, (err, stats) => {
            if (err) return;

            const newSize = stats.size;

            if (newSize > lastProgressSize) {
                const stream = fs.createReadStream(progressLogPath, {
                    start: lastProgressSize,
                    end: newSize,
                    encoding: 'utf8'
                });

                let buffer = '';
                stream.on('data', chunk => {
                    buffer += chunk;
                    const lines = buffer.split('\n');

                    for (let i = 0; i < lines.length - 1; i++) {
                        const line = lines[i].trim();
                        if (line) {
                            try {
                                const logData = JSON.parse(line);
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

        console.log(`[SERVER] [GENERATION] Generación completada`);
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

        // Limpiar archivo de progreso temporal
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

// Endpoint para edición inteligente mediante Chatbot
app.post('/api/chat/edit', (req, res) => {
    const { clientId, message } = req.body;

    if (!clientId || !message) {
        return res.status(400).json({ error: 'Faltan parámetros (clientId, message)' });
    }

    console.log(`[SERVER][CHAT] Petición de edición para ${clientId}: "${message.substring(0, 50)}..."`);

    // Resolver ruta del archivo
    const fileName = clientId.endsWith('.pdf') ? clientId.replace('.pdf', '.md') : clientId + '.md';
    const filePath = path.join(localOutputFolder, fileName);

    if (!fs.existsSync(filePath)) {
        console.error(`[SERVER][CHAT] Archivo no encontrado: ${filePath}`);
        return res.status(404).json({ error: 'Informe no encontrado para editar' });
    }

    const scriptPath = path.join(__dirname, 'chatbot', 'editor.py');
    console.log(`[SERVER][CHAT] Lanzando editor.py para ${fileName}`);

    // Helper para convertir path de Windows a WSL
    const toWslPath = (winPath) => {
        let p = winPath.replace(/\\/g, '/');
        if (p.match(/^[a-zA-Z]:/)) {
            const drive = p.charAt(0).toLowerCase();
            p = `/mnt/${drive}${p.slice(2)}`;
        }
        return p;
    };

    const safeFilePath = toWslPath(filePath);
    const workingDir = path.join(__dirname, 'chatbot');

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
app.post('/save-edit', (req, res) => {
    const { fileName, content } = req.body;

    if (!fileName || !content) {
        return res.status(400).json({ message: 'Faltan datos requeridos (fileName o content).' });
    }

    // Determinar rutas
    const localOutputFolder = path.join(__dirname, '../data/OutputData');
    const baseName = path.basename(fileName, '.pdf');
    const editedFileName = `${baseName}_edited.md`;
    const editedFilePath = path.join(localOutputFolder, editedFileName);

    try {
        fs.writeFileSync(editedFilePath, content, 'utf8');
        console.log(`[SERVER] Archivo editado guardado: ${editedFilePath}`);
        return res.status(200).json({ message: 'Cambios guardados correctamente', editedFileName });
    } catch (error) {
        console.error('[SERVER] Error al guardar edición:', error);
        return res.status(500).json({ message: 'Error al guardar los cambios.' });
    }
});

app.post('/notifyPreviewExit', upload.single('file'), async (req, res) => {
    const { fileName } = req.body;

    if (!fileName) {
        return res.status(400).json({ message: 'No se ha proporcionado el nombre del archivo.' });
    }
    console.log('El cliente ha salido');

    const localTempPath = path.join(__dirname, 'tempUploads', fileName);
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


app.get('/stream', (req, res) => {
    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });
    res.flushHeaders();

    const interval = setInterval(() => {
        const filePath = 'output.txt';
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf-8');
            res.write(`data: ${content.replace(/\n/g, '\\n')}\n\n`);
        }
    }, 1000); // o sólo una vez si sabes cuándo enviar

    req.on('close', () => {
        clearInterval(interval);
        res.end();
    });
});



















// Comprobar si el archivo de salida existe
app.get('/checkFile/:uniqueName', (req, res) => {
    const localPath = path.join(localOutputFolder, req.params.uniqueName);

    if (fs.existsSync(localPath)) {
        res.status(200).send("El archivo está disponible.");
    } else {
        res.status(404).send("El archivo no está disponible.");
    }
});

// Obtener contenido de archivo de salida
app.get('/OutputData/:uniqueName', (req, res) => {
    const localPath = path.join(localOutputFolder, req.params.uniqueName);

    if (fs.existsSync(localPath)) {
        const content = fs.readFileSync(localPath, 'utf8');
        res.status(200).send(content);
    } else {
        res.status(404).send("El archivo no está disponible.");
    }
});

// ==========================================
// API GESTIÓN DE USUARIOS (ADMIN)
// ==========================================

// Listar todos los usuarios
app.get('/api/users', requireServerAuth, requireAdminRole, (req, res) => {
    // Devolver usuarios sin la contraseña
    const safeUsers = USERS_DATABASE.map(user => {
        const { password, ...userWithoutPassword } = user;
        return userWithoutPassword;
    });
    res.json(safeUsers);
});

// Crear nuevo usuario
app.post('/api/users', requireServerAuth, requireAdminRole, async (req, res) => {
    try {
        const { email, password, firstName, lastName, role, institution } = req.body;

        if (!email || !password || !firstName || !lastName) {
            return res.status(400).json({ error: 'Faltan campos obligatorios' });
        }

        // Verificar si el email ya existe
        if (USERS_DATABASE.some(u => u.email === email)) {
            return res.status(400).json({ error: 'El email ya está registrado' });
        }

        // Hashear contraseña
        const hashedPassword = await bcrypt.hash(password, 10);

        // Generar ID (max id + 1)
        const newId = USERS_DATABASE.length > 0 ? Math.max(...USERS_DATABASE.map(u => u.id)) + 1 : 1;

        const newUser = {
            id: newId,
            email,
            password: hashedPassword,
            firstName,
            lastName,
            role: role || 'user', // Default to user (Doctor)
            institution: institution || ''
        };

        USERS_DATABASE.push(newUser);
        saveUsers();

        console.log(`[ADMIN] Usuario creado: ${email} por ${req.user.email}`);

        const { password: _, ...userWithoutPassword } = newUser;
        res.status(201).json(userWithoutPassword);
    } catch (error) {
        console.error('[ADMIN] Error creando usuario:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Actualizar usuario
app.put('/api/users/:id', requireServerAuth, requireAdminRole, async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const { email, password, firstName, lastName, role, institution } = req.body;

        const userIndex = USERS_DATABASE.findIndex(u => u.id === userId);
        if (userIndex === -1) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        // Actualizar campos si se proporcionan
        if (email) {
            // Verificar unicidad si cambia el email
            if (email !== USERS_DATABASE[userIndex].email && USERS_DATABASE.some(u => u.email === email)) {
                return res.status(400).json({ error: 'El email ya está en uso' });
            }
            USERS_DATABASE[userIndex].email = email;
        }

        if (firstName) USERS_DATABASE[userIndex].firstName = firstName;
        if (lastName) USERS_DATABASE[userIndex].lastName = lastName;
        if (role) USERS_DATABASE[userIndex].role = role;
        if (institution !== undefined) USERS_DATABASE[userIndex].institution = institution;

        // Si se proporciona contraseña, hashearla
        if (password && password.trim() !== '') {
            USERS_DATABASE[userIndex].password = await bcrypt.hash(password, 10);
        }

        saveUsers();
        console.log(`[ADMIN] Usuario actualizado: ID ${userId} por ${req.user.email}`);

        const { password: _, ...userWithoutPassword } = USERS_DATABASE[userIndex];
        res.json(userWithoutPassword);

    } catch (error) {
        console.error('[ADMIN] Error actualizando usuario:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Eliminar usuario
app.delete('/api/users/:id', requireServerAuth, requireAdminRole, (req, res) => {
    try {
        const userId = parseInt(req.params.id);

        // Prevenir auto-eliminación
        if (userId === req.user.userId) { // active session stores userId property
            return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });
        }

        const userIndex = USERS_DATABASE.findIndex(u => u.id === userId);
        if (userIndex === -1) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        const deletedEmail = USERS_DATABASE[userIndex].email;
        USERS_DATABASE.splice(userIndex, 1);
        saveUsers();

        console.log(`[ADMIN] Usuario eliminado: ${deletedEmail} por ${req.user.email}`);
        res.json({ message: 'Usuario eliminado correctamente' });

    } catch (error) {
        console.error('[ADMIN] Error eliminando usuario:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ========== ENDPOINTS DE AUTENTICACIÓN Y GESTIÓN DE CUENTA ==========

// Endpoint para obtener información de la sesión actual
app.get('/api/auth/me', requireServerAuth, (req, res) => {
    // req.user ya está poblado por requireServerAuth
    const { password, ...userWithoutPassword } = req.user;
    res.json(userWithoutPassword);
});

// Endpoint para obtener perfil del usuario
app.get('/api/user/profile', async (req, res) => {
    try {
        const { userId } = req.query;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'ID de usuario requerido'
            });
        }

        const user = USERS_DATABASE.find(u => u.id === parseInt(userId));

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Usuario no encontrado'
            });
        }

        // Retornar datos del usuario (sin contraseña)
        res.json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                role: user.role,
                institution: user.institution
            }
        });

    } catch (error) {
        console.error('Error al obtener perfil:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener perfil'
        });
    }
});

// Endpoint para actualizar perfil (nombre y apellidos)
app.put('/api/user/profile', async (req, res) => {
    try {
        const { userId, firstName, lastName } = req.body;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'ID de usuario requerido'
            });
        }

        if (!firstName || !lastName) {
            return res.status(400).json({
                success: false,
                message: 'Nombre y apellidos son requeridos'
            });
        }

        const user = USERS_DATABASE.find(u => u.id === parseInt(userId));

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Usuario no encontrado'
            });
        }

        // Actualizar datos
        user.firstName = firstName.trim();
        user.lastName = lastName.trim();

        // Guardar cambios en el archivo
        saveUsers();

        console.log(`Perfil actualizado: ${user.email} - ${firstName} ${lastName}`);

        res.json({
            success: true,
            message: 'Perfil actualizado correctamente',
            user: {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                role: user.role,
                institution: user.institution
            }
        });

    } catch (error) {
        console.error('Error al actualizar perfil:', error);
        res.status(500).json({
            success: false,
            message: 'Error al actualizar perfil'
        });
    }
});

// Endpoint para cambiar contraseña
app.put('/api/user/change-password', async (req, res) => {
    try {
        const { userId, currentPassword, newPassword } = req.body;

        if (!userId || !currentPassword || !newPassword) {
            return res.status(400).json({
                success: false,
                message: 'Todos los campos son requeridos'
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'La nueva contraseña debe tener al menos 6 caracteres'
            });
        }

        const user = USERS_DATABASE.find(u => u.id === parseInt(userId));

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Usuario no encontrado'
            });
        }

        // Verificar contraseña actual con bcrypt
        const passwordMatch = await bcrypt.compare(currentPassword, user.password);

        if (!passwordMatch) {
            return res.status(401).json({
                success: false,
                message: 'La contraseña actual es incorrecta'
            });
        }

        // Hashear nueva contraseña
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        user.password = hashedPassword;

        // Guardar cambios en el archivo
        saveUsers();

        console.log(`Contraseña cambiada para usuario: ${user.email}`);

        res.json({
            success: true,
            message: 'Contraseña actualizada correctamente'
        });

    } catch (error) {
        console.error('Error al cambiar contraseña:', error);
        res.status(500).json({
            success: false,
            message: 'Error al cambiar contraseña'
        });
    }
});

// Endpoint para login
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Email y contraseña son requeridos'
            });
        }

        // Buscar usuario por email
        const user = USERS_DATABASE.find(
            u => u.email.toLowerCase() === email.toLowerCase()
        );

        if (!user) {
            // No revelar si el usuario existe o no (seguridad)
            return res.status(401).json({
                success: false,
                message: 'Credenciales incorrectas'
            });
        }

        // Verificar contraseña con bcrypt
        const passwordMatch = await bcrypt.compare(password, user.password);

        if (!passwordMatch) {
            return res.status(401).json({
                success: false,
                message: 'Credenciales incorrectas'
            });
        }

        // Login exitoso - generar token de sesión
        const sessionToken = uuidv4();
        const expiryTime = Date.now() + SESSION_DURATION_MS;

        const userData = {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            role: user.role,
            institution: user.institution
        };

        // Guardar sesión en memoria
        ACTIVE_SESSIONS.set(sessionToken, {
            ...userData,
            expiry: expiryTime
        });

        // Establecer cookie HttpOnly
        res.cookie('auth_token', sessionToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: SESSION_DURATION_MS,
            sameSite: 'strict'
        });

        console.log(`Login exitoso: ${user.email} (Token: ${sessionToken.substring(0, 8)}...)`);

        res.json({
            success: true,
            user: userData
        });

    } catch (error) {
        console.error('Error en login:', error);
        res.status(500).json({
        });
    }
});

// Endpoint para logout
app.post('/api/logout', (req, res) => {
    const token = req.cookies.auth_token;

    // Invalidate session in memory
    if (token && ACTIVE_SESSIONS.has(token)) {
        ACTIVE_SESSIONS.delete(token);
    }

    // Clear cookie
    res.clearCookie('auth_token');

    res.json({ success: true, message: 'Sesión cerrada exitosamente' });
});

// ========== ENDPOINTS DE RECUPERACIÓN DE CONTRASEÑA ==========

// Endpoint para solicitar recuperación de contraseña
app.post('/api/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({
                success: false,
                message: 'El correo electrónico es requerido'
            });
        }

        // Buscar usuario por email
        const user = USERS_DATABASE.find(
            u => u.email.toLowerCase() === email.toLowerCase()
        );

        // Por seguridad, siempre respondemos con éxito aunque el email no exista
        // Esto previene que se pueda enumerar usuarios del sistema
        if (!user) {
            console.log(`Intento de recuperación para email no existente: ${email}`);
            return res.json({
                success: true,
                message: 'Si el correo existe, recibirás instrucciones para recuperar tu contraseña.'
            });
        }

        // Generar token de recuperación
        const token = generateResetToken();
        const expiry = Date.now() + 3600000; // 1 hora

        // Guardar token con expiración
        passwordResetTokens.set(token, {
            userId: user.id,
            email: user.email,
            expiry: expiry,
            used: false
        });

        // Enviar correo de recuperación
        await sendPasswordResetEmail(user.email, token, user.firstName);

        res.json({
            success: true,
            message: 'Si el correo existe, recibirás instrucciones para recuperar tu contraseña.'
        });

    } catch (error) {
        console.error('Error en forgot-password:', error);
        res.status(500).json({
            success: false,
            message: 'Error al procesar la solicitud. Inténtalo de nuevo más tarde.'
        });
    }
});

// Endpoint para verificar validez del token
app.post('/api/verify-reset-token', (req, res) => {
    const { token } = req.body;

    if (!token) {
        return res.status(400).json({
            valid: false,
            message: 'Token no proporcionado'
        });
    }

    const tokenData = passwordResetTokens.get(token);

    if (!tokenData) {
        return res.json({
            valid: false,
            message: 'Token inválido o expirado'
        });
    }

    if (tokenData.used) {
        return res.json({
            valid: false,
            message: 'Este enlace ya ha sido utilizado'
        });
    }

    if (Date.now() > tokenData.expiry) {
        passwordResetTokens.delete(token);
        return res.json({
            valid: false,
            message: 'El enlace ha expirado. Solicita uno nuevo.'
        });
    }

    res.json({
        valid: true,
        email: tokenData.email
    });
});

// Endpoint para resetear la contraseña
app.post('/api/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;

        if (!token || !newPassword) {
            return res.status(400).json({
                success: false,
                message: 'Token y nueva contraseña son requeridos'
            });
        }

        // Validar longitud de contraseña
        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'La contraseña debe tener al menos 6 caracteres'
            });
        }

        const tokenData = passwordResetTokens.get(token);

        if (!tokenData) {
            return res.status(400).json({
                success: false,
                message: 'Token inválido o expirado'
            });
        }

        if (tokenData.used) {
            return res.status(400).json({
                success: false,
                message: 'Este enlace ya ha sido utilizado'
            });
        }

        if (Date.now() > tokenData.expiry) {
            passwordResetTokens.delete(token);
            return res.status(400).json({
                success: false,
                message: 'El enlace ha expirado. Solicita uno nuevo.'
            });
        }

        // Buscar y actualizar la contraseña del usuario
        const user = USERS_DATABASE.find(u => u.id === tokenData.userId);

        if (!user) {
            return res.status(400).json({
                success: false,
                message: 'Usuario no encontrado'
            });
        }

        // Hashear la nueva contraseña antes de guardar
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        user.password = hashedPassword;

        // Guardar cambios en el archivo
        saveUsers();

        // Marcar token como usado
        tokenData.used = true;

        // Eliminar token después de 5 minutos
        setTimeout(() => {
            passwordResetTokens.delete(token);
        }, 300000);

        console.log(`Contraseña actualizada para usuario: ${user.email}`);

        res.json({
            success: true,
            message: 'Contraseña actualizada correctamente'
        });

    } catch (error) {
        console.error('Error en reset-password:', error);
        res.status(500).json({
            success: false,
            message: 'Error al actualizar la contraseña. Inténtalo de nuevo.'
        });
    }
});


// ========== INVITATION SYSTEM ENDPOINTS ==========

// Admin sends invitation to a user
app.post('/api/admin/invite', requireServerAuth, requireAdminRole, async (req, res) => {
    try {
        const { email, role, institution } = req.body;

        if (!email || !role) {
            return res.status(400).json({
                success: false,
                message: 'Email y rol son requeridos'
            });
        }

        // Validate role
        const validRoles = ['admin', 'tester', 'user'];
        if (!validRoles.includes(role)) {
            return res.status(400).json({
                success: false,
                message: 'Rol inválido'
            });
        }

        // Check if email already exists in database
        const existingUser = USERS_DATABASE.find(u => u.email.toLowerCase() === email.toLowerCase());
        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: 'Ya existe un usuario con este email'
            });
        }

        // Check if there's already a pending invitation for this email
        for (const [token, invitation] of pendingInvitations.entries()) {
            if (invitation.email.toLowerCase() === email.toLowerCase()) {
                // Delete old invitation
                pendingInvitations.delete(token);
                break;
            }
        }

        // Generate invitation token (48 hour expiry)
        const token = generateInvitationToken();
        const expiry = Date.now() + (48 * 60 * 60 * 1000); // 48 hours

        pendingInvitations.set(token, {
            email: email.toLowerCase(),
            role,
            institution: institution || '',
            expiry
        });

        // Send invitation email
        await sendInvitationEmail(email, token, role, institution);

        console.log(`[INVITATION] Invitación enviada a ${email} como ${role}`);

        res.json({
            success: true,
            message: `Invitación enviada a ${email}`
        });

    } catch (error) {
        console.error('Error al enviar invitación:', error);
        res.status(500).json({
            success: false,
            message: 'Error al enviar invitación'
        });
    }
});

// Verify invitation token (public endpoint)
app.get('/api/invitation/:token', (req, res) => {
    const { token } = req.params;

    if (!token) {
        return res.status(400).json({
            valid: false,
            message: 'Token no proporcionado'
        });
    }

    const invitation = pendingInvitations.get(token);

    if (!invitation) {
        return res.json({
            valid: false,
            message: 'Invitación inválida o expirada'
        });
    }

    if (Date.now() > invitation.expiry) {
        pendingInvitations.delete(token);
        return res.json({
            valid: false,
            message: 'La invitación ha expirado'
        });
    }

    res.json({
        valid: true,
        email: invitation.email,
        role: invitation.role,
        institution: invitation.institution
    });
});

// Complete registration (public endpoint)
app.post('/api/complete-registration', async (req, res) => {
    try {
        const { token, firstName, lastName, password } = req.body;

        if (!token || !firstName || !lastName || !password) {
            return res.status(400).json({
                success: false,
                message: 'Todos los campos son requeridos'
            });
        }

        if (password.length < 8) {
            return res.status(400).json({
                success: false,
                message: 'La contraseña debe tener al menos 8 caracteres'
            });
        }

        if (!/\d/.test(password)) {
            return res.status(400).json({
                success: false,
                message: 'La contraseña debe contener al menos un número'
            });
        }

        if (!/[!@#$%^&*(),.?":{}|<>_\-+=\[\]\\;'/`~]/.test(password)) {
            return res.status(400).json({
                success: false,
                message: 'La contraseña debe contener al menos un símbolo'
            });
        }

        const invitation = pendingInvitations.get(token);

        if (!invitation) {
            return res.status(400).json({
                success: false,
                message: 'Invitación inválida o expirada'
            });
        }

        if (Date.now() > invitation.expiry) {
            pendingInvitations.delete(token);
            return res.status(400).json({
                success: false,
                message: 'La invitación ha expirado'
            });
        }

        // Check again if email already exists (race condition protection)
        const existingUser = USERS_DATABASE.find(u => u.email.toLowerCase() === invitation.email.toLowerCase());
        if (existingUser) {
            pendingInvitations.delete(token);
            return res.status(400).json({
                success: false,
                message: 'Ya existe un usuario con este email'
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Generate new ID
        const maxId = USERS_DATABASE.length > 0
            ? Math.max(...USERS_DATABASE.map(u => u.id))
            : 0;

        // Create user
        const newUser = {
            id: maxId + 1,
            email: invitation.email,
            password: hashedPassword,
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            role: invitation.role,
            institution: invitation.institution
        };

        USERS_DATABASE.push(newUser);
        saveUsers();

        // Delete used invitation
        pendingInvitations.delete(token);

        console.log(`[REGISTRATION] Usuario registrado: ${newUser.email} (${newUser.role})`);

        res.json({
            success: true,
            message: 'Cuenta creada correctamente. Ya puedes iniciar sesión.'
        });

    } catch (error) {
        console.error('Error en complete-registration:', error);
        res.status(500).json({
            success: false,
            message: 'Error al crear la cuenta'
        });
    }
});


const { generateLatexPdf } = require('./utils/latex_generator');

app.post('/api/generate-pdf', async (req, res) => {
    try {
        console.log('[SERVER] Petición recibida en /api/generate-pdf (LaTeX)');
        const { markdown } = req.body;

        if (!markdown || markdown.trim() === '') {
            console.log('[SERVER] Error: markdown vacío');
            return res.status(400).json({ error: 'Markdown vacío' });
        }

        console.log('[SERVER] Iniciando generación PDF LaTeX...');

        // Detectar tipo de informe para nombre de archivo
        const generationMarkers = [
            /Historia Actual/i,
            /Evolución/i,
            /Pruebas Complementarias/i,
            /Procedimientos.*Intervención/i,
            /Juicio Clínico/i,
            /Plan Terapéutico/i
        ];

        let matches = 0;
        for (const marker of generationMarkers) {
            if (markdown.match(marker)) matches++;
        }

        const reportType = matches >= 3 ? 'generation' : 'simplification';
        const filename = reportType === 'generation' ? 'informe_alta.pdf' : 'informe_simplificado.pdf';

        console.log(`[SERVER] Tipo detectado: ${reportType}, nombre archivo: ${filename}`);

        // Generar PDF usando nuestra utilidad LaTeX
        const pdfPath = await generateLatexPdf(markdown);

        console.log('[SERVER] PDF generado exitosamente en:', pdfPath);

        // Enviar el PDF mediante descarga
        res.download(pdfPath, filename, (err) => {
            if (err) {
                console.error('[SERVER] Error al enviar PDF (res.download):', err);
                // Check if headers are sent. If not, send 500. 
                // If headers are sent (likely for download), we can't send another status, 
                // but logging helps.
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Error durante la descarga del archivo: ' + err.message });
                }
            } else {
                console.log('[SERVER] PDF enviado correctamente. Limpiando...');
                try {
                    const tempDir = path.dirname(pdfPath);
                    if (tempDir.includes('temp_latex_')) {
                        // Delay cleanup slightly to ensure file handles are released 
                        // even though callback implies transfer done.
                        setTimeout(() => {
                            try {
                                fs.rmSync(tempDir, { recursive: true, force: true });
                                console.log(`[SERVER] Directorio temporal borrado: ${tempDir}`);
                            } catch (e) {
                                console.error('[SERVER] Error borrando dir temporal (delayed):', e);
                            }
                        }, 1000);
                    }
                } catch (cleanupErr) {
                    console.error('[SERVER] Warning: Error logic cleanup:', cleanupErr);
                }
            }
        });

    } catch (error) {
        console.error('[SERVER] Error en /api/generate-pdf:', error.message);
        console.error('[SERVER] Stack:', error.stack);

        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
});


// Endpoint para transferir informe generado hacia simplificación
app.post('/api/transfer-generation-to-simplification', async (req, res) => {
    try {
        console.log('[SERVER] Petición recibida en /api/transfer-generation-to-simplification');
        const { fileName } = req.body; // e.g., 'TOKEN.md' or 'TOKEN'

        if (!fileName) {
            return res.status(400).json({ error: 'Falta fileName' });
        }

        // Asegurar extensión .md
        const markdownFileName = fileName.endsWith('.md') ? fileName : `${fileName}.md`;
        const markdownPath = path.join(localOutputFolder, markdownFileName);

        if (!fs.existsSync(markdownPath)) {
            console.error(`[SERVER] Archivo no encontrado: ${markdownPath}`);
            return res.status(404).json({ error: 'El archivo generado no existe.' });
        }

        const markdownContent = fs.readFileSync(markdownPath, 'utf-8');

        // Generar PDF usando LaTeX
        console.log('[SERVER] Generando PDF temporal para simplificación...');
        const pdfPath = await generateLatexPdf(markdownContent);

        // Definir nombre de destino en tempUploads
        const timestamp = Date.now();
        const targetFileName = `Simplification_Transfer_${timestamp}.pdf`;
        const targetPath = path.join(path.join(__dirname, 'tempUploads'), targetFileName);

        // Mover archivo
        console.log(`[SERVER] Moviendo PDF a: ${targetPath}`);

        // Copiar en lugar de mover por si generationLatexPdf limpia automaticamente (aunque aquí no estamos en download callback)
        // generateLatexPdf devuelve path en una carpeta temporal temp_latex_...

        fs.copyFileSync(pdfPath, targetPath);

        // Intentar limpiar carpeta temporal de generación
        try {
            const tempDir = path.dirname(pdfPath);
            if (tempDir.includes('temp_latex_')) {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
        } catch (e) {
            console.warn('[SERVER] No se pudo limpiar carpeta temporal:', e.message);
        }

        console.log('[SERVER] Transferencia exitosa.');
        res.json({
            success: true,
            redirectFileName: targetFileName
        });

    } catch (error) {
        console.error('[SERVER] Error transfiriendo a simplificación:', error);
        res.status(500).json({ error: 'Error interno durante la transferencia.' });
    }
});






// ==========================================
// USER PROFILE ENDPOINTS
// ==========================================

// Get user profile
app.get('/api/user/profile', requireServerAuth, (req, res) => {
    try {
        const userId = parseInt(req.query.userId);

        if (!userId) {
            return res.status(400).json({ success: false, message: 'User ID required' });
        }

        // Security check: ensure user is requesting their own profile or is admin
        if (req.user.id !== userId && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Unauthorized access to this profile' });
        }

        const user = USERS_DATABASE.find(u => u.id === userId);

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        // Return user data without password
        const { password, ...userProfile } = user;

        res.json({
            success: true,
            user: userProfile
        });

    } catch (error) {
        console.error('[API] Error fetching profile:', error);
        res.status(500).json({ success: false, message: 'Server error fetching profile' });
    }
});

// Update user profile
app.put('/api/user/profile', requireServerAuth, (req, res) => {
    try {
        const { userId, firstName, lastName } = req.body;

        if (!userId || !firstName || !lastName) {
            return res.status(400).json({ success: false, message: 'All fields are required' });
        }

        // Security check
        if (req.user.id !== parseInt(userId) && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Unauthorized to update this profile' });
        }

        const userIndex = USERS_DATABASE.findIndex(u => u.id === parseInt(userId));

        if (userIndex === -1) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        // Update fields
        USERS_DATABASE[userIndex].firstName = firstName.trim();
        USERS_DATABASE[userIndex].lastName = lastName.trim();

        // Save changes
        saveUsers();

        // Update active session if it's the current user updating their own profile
        // This ensures subsequent requests have updated data in req.user
        // We find the session by iterating active sessions (inefficient but works for small scale)
        // Or we rely on the client refreshing. 
        // For in-memory store, we can update the specific session object if we had the token.
        // But req.user is derived from token in middleware. 
        // We can't easily update the session store from here without the token unless we passed it.
        // requireServerAuth attaches user to req.user but doesn't pass raw token easily unless we check cookies.

        const token = req.cookies.auth_token;
        if (token && ACTIVE_SESSIONS.has(token)) {
            const session = ACTIVE_SESSIONS.get(token);
            if (session.id === parseInt(userId)) {
                session.firstName = firstName.trim();
                session.lastName = lastName.trim();
                ACTIVE_SESSIONS.set(token, session);
            }
        }

        console.log(`[API] Profile updated for user ${userId}`);

        res.json({
            success: true,
            message: 'Profile updated successfully',
            user: {
                id: userId,
                firstName: USERS_DATABASE[userIndex].firstName,
                lastName: USERS_DATABASE[userIndex].lastName,
                email: USERS_DATABASE[userIndex].email,
                role: USERS_DATABASE[userIndex].role
            }
        });

    } catch (error) {
        console.error('[API] Error updating profile:', error);
        res.status(500).json({ success: false, message: 'Server error updating profile' });
    }
});

// Change password
app.put('/api/user/change-password', requireServerAuth, async (req, res) => {
    try {
        const { userId, currentPassword, newPassword } = req.body;

        if (!userId || !currentPassword || !newPassword) {
            return res.status(400).json({ success: false, message: 'All fields are required' });
        }

        if (req.user.id !== parseInt(userId)) {
            return res.status(403).json({ success: false, message: 'Unauthorized to change this password' });
        }

        const userIndex = USERS_DATABASE.findIndex(u => u.id === parseInt(userId));
        if (userIndex === -1) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const user = USERS_DATABASE[userIndex];

        // Verify current password
        const passwordMatch = await bcrypt.compare(currentPassword, user.password);
        if (!passwordMatch) {
            return res.status(400).json({ success: false, message: 'La contraseña actual es incorrecta' });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update password
        USERS_DATABASE[userIndex].password = hashedPassword;
        saveUsers();

        console.log(`[API] Password changed for user ${user.email}`);

        res.json({
            success: true,
            message: 'Password changed successfully'
        });

    } catch (error) {
        console.error('[API] Error changing password:', error);
        res.status(500).json({ success: false, message: 'Server error changing password' });
    }
});


// Serve Admin Dashboard (Protected)
app.get('/admin', requireServerAuth, requireAdminRole, serveHtmlWithBasePath(path.join(__dirname, '../frontend/views/admin.html')));

// ========== CHATBOT PERSISTENTE ==========
const readline = require('readline');

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

            const workingDir = path.join(__dirname, 'chatbot');
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

            // 👇 Enviar mensaje con conversation_id y action
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

// Configuración del chatbot
const CHATBOT_CONFIG = {
    PYTHON_TIMEOUT: 30000, // 30 segundos
    MAX_MESSAGE_LENGTH: 5000,
    CONDA_ENV: 'galeno'
};

// Sistema de logging para el chatbot
const chatbot_log_file = fs.createWriteStream(path.join(__dirname, 'chatbot', 'debug.log'), { flags: 'a' });
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

// Endpoint del chatbot - VERSIÓN MEJORADA
app.post('/api/chat', async (req, res) => {
    const requestId = Date.now();

    try {
        chatbot_logger.log(`[REQ-${requestId}] Nueva petición recibida`);

        const { message, conversation_id, action = 'chat' } = req.body;  // 👈 AÑADIR conversation_id y action

        // Validación de entrada
        if (!message && action === 'chat') {
            chatbot_logger.error(`[REQ-${requestId}] Mensaje vacío`);
            return res.status(400).json({
                error: 'El mensaje es requerido'
            });
        }

        if (message && typeof message !== 'string') {
            chatbot_logger.error(`[REQ-${requestId}] Tipo de mensaje inválido`);
            return res.status(400).json({
                error: 'El mensaje debe ser una cadena de texto'
            });
        }

        if (message && message.length > CHATBOT_CONFIG.MAX_MESSAGE_LENGTH) {
            chatbot_logger.error(`[REQ-${requestId}] Mensaje demasiado largo`);
            return res.status(400).json({
                error: `El mensaje no puede exceder ${CHATBOT_CONFIG.MAX_MESSAGE_LENGTH} caracteres`
            });
        }

        if (!persistentChatbot.isReady) {
            chatbot_logger.error(`[REQ-${requestId}] Chatbot no está listo`);
            return res.status(503).json({
                error: 'El chatbot se está inicializando',
                retry: true
            });
        }

        chatbot_logger.log(`[REQ-${requestId}] Conv: ${conversation_id}, Action: ${action}`);

        // 👇 Enviar con conversation_id
        const response = await persistentChatbot.sendMessage(message, conversation_id, action);

        if (response.error) {
            chatbot_logger.error(`[REQ-${requestId}] Error: ${response.error}`);
            return res.status(500).json({
                error: response.error,
                details: response.details
            });
        }

        chatbot_logger.log(`[REQ-${requestId}] Respuesta enviada`);
        res.json(response);

    } catch (error) {
        chatbot_logger.error(`[REQ-${requestId}] Error: ${error.message}`);

        if (error.message.includes('cerrado') || error.message.includes('no está listo')) {
            persistentChatbot.restart().catch(err => {
                chatbot_logger.error(`Error al reiniciar: ${err.message}`);
            });
        }

        res.status(500).json({
            error: 'Error interno del servidor',
            details: error.message,
            retry: true
        });
    }
});

// 👇 NUEVO ENDPOINT: Editar informe
app.post('/api/chat/edit', async (req, res) => {
    const requestId = Date.now();
    try {
        chatbot_logger.log(`[REQ-${requestId}] Petición de edición recibida`);

        const { clientId, message } = req.body;

        if (!clientId || !message) {
            chatbot_logger.error(`[REQ-${requestId}] Faltan parámetros (clientId, message)`);
            return res.status(400).json({
                error: 'Faltan parámetros requeridos'
            });
        }

        // Construir el prompt de edición
        // El chatbot python debe saber manejar la acción 'edit'
        // Le pasamos el clientId como conversation_id o como parte del mensaje, 
        // pero idealmente el chatbot mantiene el contexto o lo carga.
        // Asumiremos que el chatbot puede recibir 'edit' como action.

        // Enviar al chatbot persistente
        const response = await persistentChatbot.sendMessage(
            JSON.stringify({ clientId, instruction: message }), // Payload específico para edición
            clientId, // Usamos clientId como conversation_id para mantener contexto del documento
            'edit' // Acción específica
        );

        if (response.error) {
            chatbot_logger.error(`[REQ-${requestId}] Error del chatbot: ${response.error}`);
            return res.status(500).json({ error: response.error });
        }

        chatbot_logger.log(`[REQ-${requestId}] Edición completada`);
        res.json({ success: true, response: response.response });

    } catch (error) {
        chatbot_logger.error(`[REQ-${requestId}] Error interno: ${error.message}`);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// 👇 NUEVO ENDPOINT: Limpiar conversación
app.post('/api/chat/clear', async (req, res) => {
    try {
        const { conversation_id } = req.body;

        if (!conversation_id) {
            return res.status(400).json({
                error: 'conversation_id requerido'
            });
        }

        const response = await persistentChatbot.sendMessage('', conversation_id, 'clear');
        res.json(response);

    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
});

// Endpoint para verificar estado del chatbot
app.get('/api/chat/status', (req, res) => {
    res.json({
        ready: persistentChatbot.isReady,
        status: persistentChatbot.isReady ? 'ready' : 'initializing'
    });
});

// Endpoint para reiniciar el chatbot (solo admin)
app.post('/api/chat/restart', async (req, res) => {
    try {
        chatbot_logger.log('Reiniciando chatbot manualmente...');
        await persistentChatbot.restart();
        res.json({ success: true, message: 'Chatbot reiniciado' });
    } catch (error) {
        chatbot_logger.error(`Error al reiniciar: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});



// ========== MANEJADORES DE SEÑALES (SOLO UNA VEZ) ==========
// ELIMINAR los duplicados y dejar SOLO ESTOS:

process.on('SIGINT', () => {
    console.log('\n[SERVER] 🛑 Deteniendo servidor (SIGINT)...');

    if (global.simpProcess) {
        console.log('[SERVER] Deteniendo proceso de SIMPLIFICACIÓN...');
        global.simpProcess.kill('SIGTERM');
    }

    if (global.genProcess) {
        console.log('[SERVER] Deteniendo proceso de GENERACIÓN...');
        global.genProcess.kill('SIGTERM');
    }

    if (persistentChatbot) {
        console.log('[SERVER] Deteniendo chatbot...');
        persistentChatbot.stop();
    }

    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('[SERVER] 🛑 SIGTERM recibido, cerrando gracefully...');

    if (global.simpProcess) global.simpProcess.kill('SIGTERM');
    if (global.genProcess) global.genProcess.kill('SIGTERM');

    if (persistentChatbot) {
        persistentChatbot.stop();
    }

    process.exit(0);
});

process.on('exit', (code) => {
    console.log(`[SERVER] 👋 Proceso terminando con código ${code}`);

    // Cleanup final por si acaso
    if (global.simpProcess) global.simpProcess.kill('SIGTERM');
    if (global.genProcess) global.genProcess.kill('SIGTERM');

    if (persistentChatbot) {
        persistentChatbot.stop();
    }
});

// ========== SECURITY: PREVENT ROUTE ENUMERATION ==========
// Serve minimal page with JS redirect for unknown routes
// This makes behavior IDENTICAL to protected routes (auth.js does JS redirect)
// Attackers cannot distinguish between protected and non-existent routes.
app.use((req, res) => {
    // Skip API routes - they should return proper errors
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'Not found' });
    }

    // For HTML routes, serve Server-Side Redirect 302
    // This mimics EXACTLY what protected routes do when unauthenticated
    // Attackers cannot distinguish between "Access Denied" and "Not Found"
    console.log(`[SECURITY] Unknown route accessed: ${req.path} -> Server redirect to login`);
    const basePath = req.needsGalenoPrefix ? '/galeno' : '';
    return res.redirect(`${basePath}/login`);
});
// ===========================================================

// ========== INICIALIZACIÓN DEL SERVIDOR ==========

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

// Iniciar servidor
app.listen(port, '0.0.0.0', async () => {
    console.log(`[SERVER] 🚀 Servidor ejecutándose en http://localhost:${port}`);

    // Usar el mismo entorno Conda que el chatbot
    const condaEnv = CHATBOT_CONFIG.CONDA_ENV || 'galeno';
    const condaHook = `eval "$(conda shell.bash hook)" && conda activate ${condaEnv}`;

    // 1. Lanzar proceso de SIMPLIFICACIÓN
    console.log("[SERVER] 📜 Lanzando proceso de backend (Simplification Task)...");
    const simpCommand = `${condaHook} && python core/production.py --config core/config/production_config_simplification.yaml --task simplification`;

    const simpProcess = spawn('bash', ['-c', simpCommand], {
        cwd: __dirname,
        env: { ...process.env, PYTHONUNBUFFERED: '1' }
    });

    simpProcess.stdout.on('data', data => console.log(`[SIMP] ${data.toString().trim()}`));
    simpProcess.stderr.on('data', data => console.error(`[SIMP ERROR] ${data.toString().trim()}`));
    simpProcess.on('close', code => console.log(`[SIMP] Proceso finalizado (código ${code})`));

    // 2. Lanzar proceso de GENERACIÓN
    console.log("[SERVER] 📜 Lanzando proceso de backend (Generation Task)...");
    const genCommand = `${condaHook} && python core/production.py --config core/config/production_config_generation.yaml --task generation`;

    const genProcess = spawn('bash', ['-c', genCommand], {
        cwd: __dirname,
        env: { ...process.env, PYTHONUNBUFFERED: '1' }
    });

    genProcess.stdout.on('data', data => console.log(`[GEN] ${data.toString().trim()}`));
    genProcess.stderr.on('data', data => console.error(`[GEN ERROR] ${data.toString().trim()}`));
    genProcess.on('close', code => console.log(`[GEN] Proceso finalizado (código ${code})`));

    // Guardar referencias globales
    global.simpProcess = simpProcess;
    global.genProcess = genProcess;

    // Inicializar chatbot después de que el servidor esté listo
    await initializeChatbotOnStartup();

    console.log('[SERVER] ✅ Todo inicializado correctamente');
});