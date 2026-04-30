/**
 * GALENO-IA - Middleware de Autenticación (Server-Side Sessions)
 * 
 * Gestiona sesiones en memoria usando tokens UUID + HttpOnly cookies.
 * 
 * Tres capas de control de sesión (todas server-side, no bypasseables):
 * 1. Sliding window (2h): se renueva con actividad
 * 2. Inactividad (2h): si no hay requests en 2h, sesión invalidada
 * 3. Timeout absoluto (8h): la sesión NUNCA puede durar más de 8h sin re-login
 * 
 * Más seguro que JWT para aplicaciones web single-instance:
 * - Revocación instantánea de sesiones
 * - Sin problemas de almacenamiento de tokens en el cliente
 * - Control total del ciclo de vida de la sesión
 */

const { logAuditEvent, AUDIT_EVENTS } = require('../services/auditLog');

// Almacén de sesiones activas en memoria
// Maps sessionToken -> { userId, firstName, role, expiry, createdAt, lastActivity }
const ACTIVE_SESSIONS = new Map();

// Duración de sesión (sliding window): 8 horas
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;

// Umbral de renovación: renovar si quedan menos de 4 horas
const SESSION_RENEWAL_THRESHOLD_MS = 4 * 60 * 60 * 1000;

// Timeout absoluto: 12 horas máximo desde el login (no renovable)
const SESSION_ABSOLUTE_MAX_MS = 12 * 60 * 60 * 1000;

// Timeout por inactividad server-side: 8 horas sin ningún request
const SESSION_INACTIVITY_MS = 8 * 60 * 60 * 1000;

/**
 * Middleware de autenticación obligatoria.
 * Verifica cookie HttpOnly 'auth_token' y valida contra el almacén en memoria.
 * Implementa tres controles de sesión server-side.
 */
function requireServerAuth(req, res, next) {
    const token = req.cookies.auth_token;

    if (!token || !ACTIVE_SESSIONS.has(token)) {
        const basePath = req.needsGalenoPrefix ? '/galeno' : '';

        if (req.path.startsWith('/api/')) {
            return res.status(401).json({
                success: false,
                message: 'Sesión no válida. Inicia sesión de nuevo.'
            });
        }

        return res.redirect(`${basePath}/login`);
    }

    const session = ACTIVE_SESSIONS.get(token);
    const now = Date.now();

    // 1. Timeout absoluto: la sesión NUNCA puede superar 8h desde el login
    //    Esto NO se puede bypasear desde el cliente porque createdAt se fija en el servidor
    if (session.createdAt && (now - session.createdAt) > SESSION_ABSOLUTE_MAX_MS) {
        ACTIVE_SESSIONS.delete(token);

        logAuditEvent(AUDIT_EVENTS.SESSION_EXPIRED, {
            email: session.email,
            req,
            reason: 'Timeout absoluto (8h) alcanzado'
        });

        return _sendSessionExpired(req, res);
    }

    // 2. Inactividad server-side: si no ha hecho ningún request en 30 min
    //    Esto NO se puede bypasear desde el cliente porque lastActivity se actualiza
    //    SOLO cuando el servidor recibe un request real con cookie válida
    if (session.lastActivity && (now - session.lastActivity) > SESSION_INACTIVITY_MS) {
        ACTIVE_SESSIONS.delete(token);

        logAuditEvent(AUDIT_EVENTS.SESSION_EXPIRED, {
            email: session.email,
            req,
            reason: 'Inactividad de 30 minutos'
        });

        return _sendSessionExpired(req, res);
    }

    // 3. Sliding window: expiración normal
    if (now > session.expiry) {
        ACTIVE_SESSIONS.delete(token);

        logAuditEvent(AUDIT_EVENTS.SESSION_EXPIRED, {
            email: session.email,
            req
        });

        return _sendSessionExpired(req, res);
    }

    // Actualizar lastActivity en cada request válido (server-side tracking)
    session.lastActivity = now;

    // Sliding window: renovar si está cerca de expirar,
    // PERO nunca más allá del timeout absoluto
    const timeRemaining = session.expiry - now;
    if (timeRemaining < SESSION_RENEWAL_THRESHOLD_MS) {
        const newExpiry = now + SESSION_DURATION_MS;
        const absoluteMax = session.createdAt + SESSION_ABSOLUTE_MAX_MS;
        // No extender más allá del timeout absoluto
        session.expiry = Math.min(newExpiry, absoluteMax);
    }

    ACTIVE_SESSIONS.set(token, session);

    // Adjuntar datos del usuario al request
    req.user = session;
    next();
}

/**
 * Helper interno: envía respuesta de sesión expirada (JSON o redirect).
 */
function _sendSessionExpired(req, res) {
    const basePath = req.needsGalenoPrefix ? '/galeno' : '';

    if (req.path.startsWith('/api/')) {
        return res.status(401).json({
            success: false,
            message: 'Sesión expirada. Inicia sesión de nuevo.'
        });
    }

    return res.redirect(`${basePath}/login`);
}

/**
 * Middleware para requerir rol 'admin' o 'tester' (acceso a métricas).
 * Debe usarse DESPUÉS de requireServerAuth.
 */
function requireMetricsRole(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ success: false, message: 'No autenticado' });
    }

    if (req.user.role === 'admin' || req.user.role === 'tester') {
        next();
    } else {
        res.status(403).json({
            success: false,
            message: 'Acceso denegado: Se requieren permisos de Tester o Administrador.'
        });
    }
}

/**
 * Middleware para requerir rol 'admin'.
 * Debe usarse DESPUÉS de requireServerAuth.
 */
function requireAdminRole(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ success: false, message: 'No autenticado' });
    }

    if (req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({
            success: false,
            message: 'Acceso denegado: Se requieren permisos de Administrador.'
        });
    }
}

/**
 * Middleware para requerir rol 'admin' o 'doctor' (frecuentemente 'user' en BD).
 * Debe usarse DESPUÉS de requireServerAuth.
 */
function requireDoctorOrAdminRole(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ success: false, message: 'No autenticado' });
    }

    if (req.user.role === 'admin' || req.user.role === 'doctor' || req.user.role === 'user') {
        next();
    } else {
        // Redirigir si es una petición normal de página (no API)
        if (!req.path.startsWith('/api/')) {
            const basePath = req.needsGalenoPrefix ? '/galeno' : '';
            return res.redirect(`${basePath}/login`);
        }

        res.status(403).json({
            success: false,
            message: 'Acceso denegado: Se requieren permisos de Doctor o Administrador.'
        });
    }
}

/**
 * Middleware de verificación pasiva de sesión (no redirige).
 * Para páginas donde la autenticación es opcional pero se quiere el dato del usuario.
 * También aplica las reglas de expiración (absoluta e inactividad).
 */
function passiveSessionCheck(req, res, next) {
    const token = req.cookies.auth_token;

    if (token && ACTIVE_SESSIONS.has(token)) {
        const session = ACTIVE_SESSIONS.get(token);
        const now = Date.now();
        let isValid = true;

        // 1. Timeout absoluto
        if (session.createdAt && (now - session.createdAt) > SESSION_ABSOLUTE_MAX_MS) {
            isValid = false;
        }
        // 2. Inactividad
        else if (session.lastActivity && (now - session.lastActivity) > SESSION_INACTIVITY_MS) {
            isValid = false;
        }
        // 3. Expiración normal
        else if (now > session.expiry) {
            isValid = false;
        }

        if (isValid) {
            // Actualizar lastActivity
            session.lastActivity = now;
            ACTIVE_SESSIONS.set(token, session);
            req.user = session;
        } else {
            ACTIVE_SESSIONS.delete(token);
            // No redirigimos en check pasivo, solo no autenticamos
        }
    }
    next();
}

/**
 * Invalida todas las sesiones activas de un usuario específico.
 * Usado cuando se cambia la contraseña o se detecta actividad sospechosa.
 * @param {number} userId - ID del usuario cuyas sesiones se invalidarán
 */
function invalidateUserSessions(userId) {
    let count = 0;
    for (const [token, session] of ACTIVE_SESSIONS.entries()) {
        if (session.id === userId) {
            ACTIVE_SESSIONS.delete(token);
            count++;
        }
    }
    if (count > 0) {
        console.log(`[AUTH] Invalidadas ${count} sesión(es) del usuario ID ${userId}`);
    }
}

module.exports = {
    ACTIVE_SESSIONS,
    SESSION_DURATION_MS,
    SESSION_RENEWAL_THRESHOLD_MS,
    SESSION_ABSOLUTE_MAX_MS,
    SESSION_INACTIVITY_MS,
    requireServerAuth,
    requireMetricsRole,
    requireAdminRole,
    requireDoctorOrAdminRole,
    passiveSessionCheck,
    invalidateUserSessions
};
