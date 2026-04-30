/**
 * GALENO-IA - API Server (Modular)
 * 
 * Archivo orquestador que importa y ensambla todos los módulos.
 * Configurado con protecciones de seguridad OWASP 2026:
 * - CSRF (Double Submit Cookie)
 * - Rate limiting por cuenta + IP
 * - CSP headers
 * - Audit logging
 */

const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const { spawn } = require('child_process');

// ==========================================
// IMPORTS: Services
// ==========================================
const userDatabase = require('./services/userDatabase');
const emailService = require('./services/emailService');
const chatbotService = require('./services/chatbotService');
const auditLog = require('./services/auditLog');

// ==========================================
// IMPORTS: Middleware
// ==========================================
const authMiddleware = require('./middleware/auth');
const { setupSecurity, recordFailedAttempt, isAccountLocked, resetLoginAttempts, getLockoutRemainingMinutes } = require('./middleware/security');
const { setupProxyAndMaintenance } = require('./middleware/proxy');
const { csrfCookieMiddleware, csrfValidationMiddleware } = require('./middleware/csrf');

// ==========================================
// IMPORTS: Utils
// ==========================================
const helpers = require('./utils/helpers');

// ==========================================
// APP SETUP
// ==========================================
const app = express();
const port = 8080;

// Configurar base path para despliegue en subdirectorios
const BASE_PATH = process.env.BASE_PATH || '';

// Core middleware
app.use(express.json());
app.use(cookieParser());

// Security middleware (helmet, rate limiters)
setupSecurity(app);

// Proxy detection and maintenance mode
setupProxyAndMaintenance(app, BASE_PATH);

// CSRF middleware: establecer cookie y validar en peticiones que modifican estado
app.use(csrfCookieMiddleware);
app.use(csrfValidationMiddleware);

// ==========================================
// DEPENDENCY INJECTION CONTAINER
// ==========================================
const deps = {
    authMiddleware,
    userDatabase,
    emailService,
    chatbotService,
    auditLog,
    helpers,
    BASE_PATH,
    // Utilidades de seguridad (lockout, rate limiting por cuenta)
    securityUtils: {
        recordFailedAttempt,
        isAccountLocked,
        resetLoginAttempts,
        getLockoutRemainingMinutes
    }
};

// ==========================================
// MOUNT ROUTES
// ==========================================

// Page routes (static files, HTML pages) - must be before API routes
// Uses app.get() directly since it needs app-level middleware
require('./routes/pages')(app, deps);

// API routes (use express.Router)
app.use(require('./routes/auth')(deps));
app.use(require('./routes/users')(deps));
app.use(require('./routes/invitation')(deps));
app.use(require('./routes/metrics')(deps));
app.use(require('./routes/files')(deps));
app.use(require('./routes/chatbot')(deps));
app.use(require('./routes/pdf')(deps));
app.use('/api/annotation', require('./routes/annotation')(deps));

// ==========================================
// SECURITY: PREVENT ROUTE ENUMERATION
// ==========================================
// Catch-all handler - must be LAST
app.use((req, res) => {
    // Skip API routes - they should return proper errors
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'Not found' });
    }

    const basePath = req.needsGalenoPrefix ? '/galeno' : '';

    // Check if user is authenticated
    const token = req.cookies.auth_token;
    const { ACTIVE_SESSIONS } = authMiddleware;
    if (token && ACTIVE_SESSIONS.has(token)) {
        const session = ACTIVE_SESSIONS.get(token);
        const now = Date.now();
        // Quick validity check (same rules as auth middleware)
        const isValid = (!session.createdAt || (now - session.createdAt) <= 8 * 60 * 60 * 1000)
            && (!session.lastActivity || (now - session.lastActivity) <= 30 * 60 * 1000)
            && now <= session.expiry;

        if (isValid) {
            // Authenticated user hitting a non-existent route -> redirect to index
            return res.redirect(`${basePath}/`);
        }
    }

    // Not authenticated -> redirect to login
    // This mimics EXACTLY what protected routes do when unauthenticated
    // Attackers cannot distinguish between "Access Denied" and "Not Found"
    return res.redirect(`${basePath}/login`);
});

// ==========================================
// SIGNAL HANDLERS
// ==========================================
const { persistentChatbot } = chatbotService;

process.on('SIGINT', () => {
    console.log('\n[SERVER] 🛑 Deteniendo servidor (SIGINT)...');

    if (persistentChatbot) {
        console.log('[SERVER] Deteniendo chatbot...');
        persistentChatbot.stop();
    }

    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('[SERVER] 🛑 SIGTERM recibido, cerrando gracefully...');

    if (persistentChatbot) {
        persistentChatbot.stop();
    }

    process.exit(0);
});

process.on('exit', (code) => {
    console.log(`[SERVER] 👋 Proceso terminando con código ${code}`);

    if (persistentChatbot) {
        persistentChatbot.stop();
    }
});

// ==========================================
// SERVER INITIALIZATION
// ==========================================
// ==========================================
// SERVER INITIALIZATION
// ==========================================
// Only listen if run directly (not imported for tests)
if (require.main === module) {
    app.listen(port, '0.0.0.0', async () => {
        console.log(`[SERVER] 🚀 Servidor ejecutándose en http://localhost:${port}`);

        // Inicializar chatbot después de que el servidor esté listo
        await chatbotService.initializeChatbotOnStartup();

        console.log('[SERVER] ✅ Todo inicializado correctamente');
        console.log('[SERVER] 🔒 Protecciones de seguridad activas: CSRF, Rate Limiting, CSP, Audit Log');
    });
}

module.exports = app;