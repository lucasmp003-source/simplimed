/**
 * GALENO-IA - Middleware de Protección CSRF
 * 
 * Implementa el patrón "Double Submit Cookie" (recomendado por OWASP 2026).
 * 
 * Flujo:
 * 1. El servidor genera un token CSRF aleatorio y lo establece como cookie
 *    (NO HttpOnly, para que JavaScript pueda leerla).
 * 2. El servidor inyecta el token en un meta tag del HTML.
 * 3. El cliente lee el token del meta tag y lo envía como header X-CSRF-Token.
 * 4. El servidor compara el header con la cookie. Si coinciden, la petición es legítima.
 * 
 * ¿Por qué funciona? Un atacante en otro dominio puede hacer que el navegador
 * envíe la cookie automáticamente, pero NO puede leer su valor (Same-Origin Policy),
 * así que no puede incluirlo en el header.
 */

const crypto = require('crypto');
const { logAuditEvent, AUDIT_EVENTS } = require('../services/auditLog');

// Nombre de la cookie CSRF
const CSRF_COOKIE_NAME = '_csrf';
// Nombre del header que el cliente debe enviar
const CSRF_HEADER_NAME = 'x-csrf-token';
// Longitud del token en bytes (32 bytes = 64 caracteres hex)
const TOKEN_LENGTH = 32;

/**
 * Genera un token CSRF criptográficamente seguro.
 * @returns {string} Token hexadecimal de 64 caracteres
 */
function generateCsrfToken() {
    return crypto.randomBytes(TOKEN_LENGTH).toString('hex');
}

/**
 * Middleware que establece la cookie CSRF si no existe.
 * Debe ejecutarse ANTES de las rutas.
 */
/**
 * Middleware que establece la cookie CSRF si no existe.
 * Debe ejecutarse ANTES de las rutas.
 */
function csrfCookieMiddleware(req, res, next) {
    const token = req.cookies[CSRF_COOKIE_NAME];

    // Configuración de la cookie
    const cookieOptions = {
        httpOnly: false,    // El JS del cliente necesita leerla
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
        maxAge: 8 * 60 * 60 * 1000 // 8 horas (sincronizado con max sesión)
    };

    // Si no hay cookie, generar nueva
    if (!token) {
        const newToken = generateCsrfToken();
        res.cookie(CSRF_COOKIE_NAME, newToken, cookieOptions);
        req.csrfToken = newToken;
    }
    // Si hay cookie, aplicar Sliding Window: renovar si está próxima a expirar
    else {
        // No podemos saber la edad exacta de la cookie desde el servidor sin firmarla/guardarla,
        // pero podemos renovarla incondicionalmente para extender su vida (Sliding Window),
        // O renovarla solo si creemos que es necesario (optimización).
        // Por seguridad y simplicidad, refrescamos la cookie en cada petición GET/navegación
        // para asegurar que mientras el usuario navegue, la cookie CSRF siga viva.

        // Estrategia: Renovar cookie en cada petición para mantenerla sincronizada con la sesión
        // Esto previene que la cookie expire (2h) mientras la sesión sigue viva (8h)
        res.cookie(CSRF_COOKIE_NAME, token, cookieOptions);
        req.csrfToken = token;
    }

    next();
}

/**
 * Middleware que valida el token CSRF en peticiones que modifican estado.
 * Solo valida POST, PUT, DELETE, PATCH.
 * NO valida GET, HEAD, OPTIONS (métodos seguros según HTTP spec).
 */
function csrfValidationMiddleware(req, res, next) {
    // Métodos seguros no necesitan validación CSRF
    const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
    if (safeMethods.includes(req.method)) {
        return next();
    }

    // Solo validar rutas de API
    if (!req.path.startsWith('/api/')) {
        return next();
    }

    // Excluir el endpoint de login de la validación CSRF
    // (el usuario aún no tiene token CSRF cuando llega a la página de login por primera vez)
    // UPDATE: Eliminado para prevenir Login CSRF. El token se inyecta en la página de login.
    // if (req.path === '/api/login') {
    //    return next();
    // }

    const cookieToken = req.cookies[CSRF_COOKIE_NAME];
    const headerToken = req.headers[CSRF_HEADER_NAME];

    // Verificar que ambos tokens existan y coincidan
    if (!cookieToken || !headerToken || cookieToken !== headerToken) {

        // Diagnóstico diferenciado para logs
        const violationType = !cookieToken && headerToken
            ? 'MISSING_COOKIE_HEADER_PRESENT'
            : 'TOKEN_MISMATCH';

        logAuditEvent(AUDIT_EVENTS.CSRF_VIOLATION, {
            req,
            reason: `Cookie: ${cookieToken ? 'presente' : 'ausente'}, Header: ${headerToken ? 'presente' : 'ausente'} (${violationType})`,
            path: req.path
        });

        // CAMBIO DE SEGURIDAD (14-Feb-2026):
        // Si falta la cookie pero hay header, es muy probable que la cookie haya expirado
        // mientras la sesión (auth_token) seguía viva.
        // Devolvemos 401 para forzar al frontend a redirigir al login (re-autenticación)
        // en lugar de mostrar un error 403 bloqueante.
        if (!cookieToken && headerToken) {
            return res.status(401).json({
                success: false,
                message: 'Sesión de seguridad expirada. Por favor, inicia sesión de nuevo.'
            });
        }

        return res.status(403).json({
            success: false,
            message: 'Token de seguridad inválido. Recarga la página e inténtalo de nuevo.'
        });
    }

    next();
}

/**
 * Función helper para obtener el token CSRF actual de un request.
 * Usado por pages.js para inyectarlo en el meta tag del HTML.
 * @param {object} req - Request de Express
 * @returns {string} Token CSRF
 */
function getCsrfToken(req) {
    return req.csrfToken || req.cookies[CSRF_COOKIE_NAME] || '';
}

module.exports = {
    csrfCookieMiddleware,
    csrfValidationMiddleware,
    getCsrfToken,
    CSRF_COOKIE_NAME,
    CSRF_HEADER_NAME
};
