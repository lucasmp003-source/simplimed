/**
 * GALENO-IA - Middleware de Seguridad
 * 
 * Configura protecciones de seguridad del servidor:
 * - Helmet (headers de seguridad, CSP)
 * - Rate limiting por cuenta (no por IP) para autenticación
 * - Account lockout tras intentos fallidos
 * - Rate limiting general para API
 */

const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { logAuditEvent, AUDIT_EVENTS } = require('../services/auditLog');

// ==========================================
// ACCOUNT LOCKOUT STORE
// ==========================================
// Almacena intentos fallidos por email: { intentos: number, bloqueadoHasta: timestamp }
const loginAttempts = new Map();

// Configuración de lockout
const MAX_LOGIN_ATTEMPTS = 5;        // Intentos máximos antes del bloqueo
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutos de bloqueo
const ATTEMPT_WINDOW_MS = 60 * 1000;        // Ventana de 1 minuto para contar intentos

/**
 * Registra un intento fallido de login para un email.
 * @param {string} email - Email normalizado
 * @param {object} req - Request de Express (para logging)
 * @returns {boolean} true si la cuenta queda bloqueada
 */
function recordFailedAttempt(email, req) {
    const normalizedEmail = email.toLowerCase();
    const now = Date.now();

    let record = loginAttempts.get(normalizedEmail);

    if (!record) {
        record = { attempts: 0, firstAttempt: now, lockedUntil: 0 };
    }

    // Si la ventana de intentos ha expirado, reiniciar contador
    if (now - record.firstAttempt > ATTEMPT_WINDOW_MS && record.lockedUntil < now) {
        record = { attempts: 0, firstAttempt: now, lockedUntil: 0 };
    }

    record.attempts++;

    // Si se supera el máximo, bloquear la cuenta
    if (record.attempts >= MAX_LOGIN_ATTEMPTS) {
        record.lockedUntil = now + LOCKOUT_DURATION_MS;
        loginAttempts.set(normalizedEmail, record);

        logAuditEvent(AUDIT_EVENTS.ACCOUNT_LOCKED, {
            email: normalizedEmail,
            req,
            reason: `${MAX_LOGIN_ATTEMPTS} intentos fallidos en ${ATTEMPT_WINDOW_MS / 1000}s`
        });

        return true; // Cuenta bloqueada
    }

    loginAttempts.set(normalizedEmail, record);
    return false; // Cuenta no bloqueada (aún)
}

/**
 * Verifica si una cuenta está bloqueada.
 * @param {string} email - Email normalizado
 * @returns {boolean} true si la cuenta está bloqueada
 */
function isAccountLocked(email) {
    const normalizedEmail = email.toLowerCase();
    const record = loginAttempts.get(normalizedEmail);

    if (!record) return false;

    if (record.lockedUntil > Date.now()) {
        return true; // Todavía bloqueada
    }

    // Si el bloqueo expiró, limpiar el registro
    if (record.lockedUntil > 0 && record.lockedUntil <= Date.now()) {
        loginAttempts.delete(normalizedEmail);
    }

    return false;
}

/**
 * Reinicia los intentos fallidos tras un login exitoso.
 * @param {string} email - Email normalizado
 */
function resetLoginAttempts(email) {
    loginAttempts.delete(email.toLowerCase());
}

/**
 * Obtiene los minutos restantes de bloqueo.
 * @param {string} email - Email normalizado
 * @returns {number} Minutos restantes de bloqueo
 */
function getLockoutRemainingMinutes(email) {
    const record = loginAttempts.get(email.toLowerCase());
    if (!record || record.lockedUntil <= Date.now()) return 0;
    return Math.ceil((record.lockedUntil - Date.now()) / 60000);
}

// ==========================================
// SETUP DE SEGURIDAD
// ==========================================

function setupSecurity(app) {
    // Helmet - headers de seguridad con CSP configurado
    // Helmet - headers de seguridad con CSP configurado
    const helmetConfig = {
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: [
                    "'self'",
                    "'unsafe-inline'",
                    "https://cdnjs.cloudflare.com",
                    "https://cdn.jsdelivr.net",
                    "https://uicdn.toast.com",
                    "https://unpkg.com",
                    "https://cdn.tailwindcss.com"
                ],
                scriptSrcAttr: ["'self'", "'unsafe-inline'"], // ✅ Permitir onclick="..." handlers
                styleSrc: [
                    "'self'",
                    "'unsafe-inline'",
                    "https://fonts.googleapis.com",
                    "https://cdnjs.cloudflare.com",
                    "https://uicdn.toast.com"
                ],
                fontSrc: [
                    "'self'",
                    "https://fonts.gstatic.com",
                    "https://cdnjs.cloudflare.com"
                ],
                imgSrc: ["'self'", "data:", "blob:"],
                connectSrc: [
                    "'self'",
                    "https://cdn.jsdelivr.net",
                    "https://cdnjs.cloudflare.com"
                ],
                frameSrc: ["'none'"],
                objectSrc: ["'none'"],
                baseUri: ["'self'"],
                formAction: ["'self'"],
                upgradeInsecureRequests: null // ❌ Desactivar upgrade automático para evitar HTTPS en localhost
            }
        },
        crossOriginEmbedderPolicy: false,
        // X-Frame-Options: DENY (evita clickjacking)
        frameguard: { action: 'deny' }
    };

    // Strict-Transport-Security SOLO para producción
    if (process.env.NODE_ENV === 'production') {
        helmetConfig.contentSecurityPolicy.directives.upgradeInsecureRequests = []; // Activar upgrade en prod
        helmetConfig.hsts = {
            maxAge: 31536000,
            includeSubDomains: true,
            preload: true
        };
    }

    app.use(helmet(helmetConfig));

    // Rate limiting general para API (por IP)
    const apiLimiter = rateLimit({
        windowMs: 60 * 1000, // 1 minuto
        max: 100,            // 100 requests por minuto por IP
        message: {
            success: false,
            message: 'Demasiadas solicitudes. Por favor, reduce la frecuencia.'
        },
        standardHeaders: true,
        legacyHeaders: false
    });

    // Rate limiting para autenticación (por IP como fallback adicional)
    const authIpLimiter = rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutos
        max: 20,                   // 20 intentos por IP (más permisivo, el lockout por cuenta es más estricto)
        message: {
            success: false,
            message: 'Demasiados intentos de acceso desde esta dirección. Por favor, espera 15 minutos.'
        },
        standardHeaders: true,    // ← Use Draft 6 standard headers
        legacyHeaders: false,     // ← Disable X-RateLimit-* legacy headers
        // keyGenerator removed to use default which handles IPv6 correctly
    });

    // Aplicar rate limiters
    app.use('/api/login', authIpLimiter);
    app.use('/api/forgot-password', authIpLimiter);
    app.use('/api/reset-password', authIpLimiter);
    app.use('/api/complete-registration', authIpLimiter);
    app.use('/api/', apiLimiter);
}

module.exports = {
    setupSecurity,
    recordFailedAttempt,
    isAccountLocked,
    resetLoginAttempts,
    getLockoutRemainingMinutes,
    MAX_LOGIN_ATTEMPTS,
    LOCKOUT_DURATION_MS
};
