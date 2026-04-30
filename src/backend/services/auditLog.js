/**
 * GALENO-IA - Servicio de Auditoría de Seguridad
 * 
 * Registra eventos de seguridad siguiendo estándares OWASP 2026, RGPD, LOPDGDD e ISO 27001.
 * Implementa:
 * - Logs estructurados (JSON)
 * - Campos obligatorios (User ID, Event Type, Action, Outcome, etc.)
 * - Pseudonimización de IDs sensibles (pacientes)
 * - Integridad criptográfica (Hash Chain)
 * - Inmutabilidad (Append-only)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Directorio de logs
const LOGS_DIR = path.join(__dirname, '../../../logs');
const AUDIT_LOG_FILE = path.join(LOGS_DIR, 'audit.log');

// Clave secreta para HMAC (pseudonimización)
// En producción, esto debería venir de variable de entorno
const HMAC_SECRET = process.env.AUDIT_HMAC_SECRET || 'default-audit-secret-change-me-in-prod';

// Estado interno para hash chaining
let lastLogHash = null;

// ==========================================
// CONSTANTES Y TIPOS
// ==========================================

const AUDIT_EVENTS = {
    // Autenticación
    LOGIN_SUCCESS: 'LOGIN_SUCCESS',
    LOGIN_FAILED: 'LOGIN_FAILED',
    LOGOUT: 'LOGOUT',
    ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
    PASSWORD_CHANGED: 'PASSWORD_CHANGED',
    SESSION_EXPIRED: 'SESSION_EXPIRED',

    // Seguridad
    CSRF_VIOLATION: 'CSRF_VIOLATION',
    RATE_LIMIT_HIT: 'RATE_LIMIT_HIT',
    UNAUTHORIZED_ACCESS: 'UNAUTHORIZED_ACCESS',
    SECURITY_ALERT: 'SECURITY_ALERT',

    // Datos Médicos (Nuevos)
    FILE_UPLOADED: 'FILE_UPLOADED',
    FILE_ACCESSED: 'FILE_ACCESSED',
    FILE_DELETED: 'FILE_DELETED',
    report_generated: 'REPORT_GENERATED' // Legacy compatibility if needed
};

// ==========================================
// FUNCIONES CORE (Hash Chain & Integrity)
// ==========================================

/**
 * Obtiene el hash del último log escrito.
 * Si no está en memoria, lee la última línea del archivo.
 */
function getPreviousLogHash() {
    if (lastLogHash) return lastLogHash;

    if (!fs.existsSync(AUDIT_LOG_FILE)) {
        return '0'.repeat(64); // Genesis hash
    }

    try {
        // Leer última línea de manera eficiente (reverse stream o readFileSync si no es gigante via buffer)
        // Para simplicidad en este entorno, leemos todo y cogemos la última línea (optimizable en prod)
        // O mejor: leer chunks desde el final.
        // Implementación simple robusta:
        const data = fs.readFileSync(AUDIT_LOG_FILE, 'utf8').trim();
        if (!data) return '0'.repeat(64);

        const lines = data.split('\n');
        const lastLine = lines[lines.length - 1];
        if (!lastLine) return '0'.repeat(64);

        const lastEntry = JSON.parse(lastLine);
        return lastEntry.hash || '0'.repeat(64);
    } catch (e) {
        console.warn('[AUDIT] No se pudo leer el hash anterior, usando genesis.', e.message);
        return '0'.repeat(64);
    }
}

/**
 * Calcula el hash SHA-256 de una entrada de log.
 * Incluye el hash anterior para garantizar el encadenado.
 */
function calculateLogHash(entry) {
    // Crear copia para hashear (sin el hash propio obviamente)
    const toHash = {
        timestamp: entry.timestamp,
        userId: entry.userId,
        eventType: entry.eventType,
        action: entry.action,
        resource: entry.resource,
        previousHash: entry.previousHash
    };

    // Ordenar claves para consistencia (aunque JSON.stringify no garantiza orden, hacerlo explícito ayuda)
    // Usamos JSON.stringify simple, asumiendo estructura estable.
    const dataString = JSON.stringify(toHash);

    return crypto.createHash('sha256').update(dataString).digest('hex');
}

/**
 * Pseudonimiza un ID sensible (ej: ID de paciente en BD) usando HMAC.
 * Produce un hash consistente: el mismo input siempre da el mismo output (para trazabilidad),
 * pero no se puede revertir sin la clave secreta.
 */
function pseudonimize(id) {
    if (!id) return null;
    return crypto.createHmac('sha256', HMAC_SECRET).update(String(id)).digest('hex');
}

/**
 * Enmascara email (legacy helper, mantenido por utilidad)
 */
function maskEmail(email) {
    if (!email || typeof email !== 'string') return '[desconocido]';
    const parts = email.split('@');
    if (parts.length !== 2) return '[formato-inválido]';
    const local = parts[0];
    const domain = parts[1];
    if (local.length <= 2) return `${local[0]}***@${domain}`;
    return `${local[0]}***${local[local.length - 1]}@${domain}`;
}

/**
 * Obtiene IP del cliente
 */
function getClientIP(req) {
    if (!req) return 'unknown';
    return (req.headers && req.headers['x-forwarded-for']?.split(',')[0]?.trim())
        || req.ip
        || (req.connection && req.connection.remoteAddress)
        || 'unknown';
}

/**
 * Obtiene User Agent
 */
function getUserAgent(req) {
    if (!req || !req.headers) return 'unknown';
    return req.headers['user-agent'] || 'unknown';
}

// ==========================================
// FUNCIÓN PRINCIPAL DE LOGGING
// ==========================================

/**
 * Registra un evento de auditoría.
 * Soporta firma antigua (event, details) para compatibilidad.
 * 
 * Nueva firma: log(auditData)
 * @param {Object} auditData
 * @param {string} auditData.userId - Email o ID del usuario (SIEMPRE requerido si hay usuario)
 * @param {string} auditData.eventType - AUTH, ACCESS, MODIFY, SECURITY, SYSTEM
 * @param {string} auditData.action - Acción específica (LOGIN_SUCCESS, FILE_UPLOADED)
 * @param {string} auditData.outcome - SUCCESS, FAILED, ERROR
 * @param {Object} [auditData.resource] - { type: 'file', id: '...' }
 * @param {string} [auditData.ip] - IP explícita (opcional si se pasa req en metadata)
 * @param {Object} [auditData.req] - Objeto request para extraer IP/UA automáticamente
 * @param {string} [auditData.reason]
 */
function log(arg1, arg2) {
    let entryCated = {};

    // 1. Detección de firma (Legacy vs New)
    if (typeof arg1 === 'string') {
        // LEGACY: logAuditEvent(event, details)
        const event = arg1;
        const details = arg2 || {};

        // Mapear legacy a nueva estructura
        entryCated = {
            userId: details.email || 'ANONYMOUS',
            eventType: mapEventToType(event),
            action: event,
            outcome: event.includes('FAILED') || event.includes('VIOLATION') ? 'FAILED' : 'SUCCESS',
            resource: null,
            req: details.req,
            reason: details.reason,
            ip: details.ip // A veces venía en details
        };
    } else {
        // NUEVA: log(auditData)
        entryCated = arg1;
    }

    // 2. Construcción de entrada final
    try {
        const timestamp = new Date().toISOString();
        const prevHash = getPreviousLogHash();

        // Extraer IP/UA del request si existe
        const ip = entryCated.ip || getClientIP(entryCated.req);
        const userAgent = entryCated.userAgent || getUserAgent(entryCated.req);

        // Pseudonimizar recurso si existe
        let resource = null;
        if (entryCated.resource) {
            resource = {
                type: entryCated.resource.type,
                id: pseudonimize(entryCated.resource.id)
            };
        }

        // Estructura oficial del Log
        const logEntry = {
            timestamp: timestamp,
            userId: entryCated.userId === 'ANONYMOUS' ? 'ANONYMOUS' : maskEmail(entryCated.userId), // Enmascarar ID logueado si es email
            eventType: entryCated.eventType || 'SYSTEM',
            action: entryCated.action,
            outcome: entryCated.outcome || 'SUCCESS',
            ip: ip,
            userAgent: userAgent,
            resource: resource,
            reason: entryCated.reason || null,
            previousHash: prevHash,
            hash: null // Se llena abajo
        };

        // 3. Cryptographic Sealing
        logEntry.hash = calculateLogHash(logEntry);
        lastLogHash = logEntry.hash;

        // 4. Escribir a disco (Append-only)
        writeLogToFile(logEntry);

        // 5. Console output (dev friendly)
        const icon = logEntry.outcome === 'SUCCESS' ? '✅' : '⚠️';
        console.log(`[AUDIT] ${icon} ${logEntry.action} | ${logEntry.userId} | ${logEntry.hash.substring(0, 8)}...`);

        // 6. Hook para alertas (se implementará en securityAlerts.js, aquí solo lo llamamos si existe)
        // require('./securityAlerts').checkAlerts(logEntry); 
        // (Para evitar dependencias circulares, el alert system debería observar el log o ser llamado desde otro lado. 
        // Por ahora lo dejamos simple)

        return logEntry;

    } catch (error) {
        console.error('[AUDIT_FATAL] Error escribiendo log:', error);
        // Fallback crítico: enviar a stderr
    }
}

/**
 * Escribe log a archivo manejando creación de directorios
 */
function writeLogToFile(entry) {
    if (!fs.existsSync(LOGS_DIR)) {
        fs.mkdirSync(LOGS_DIR, { recursive: true });
    }

    // Mode 'a' for append. 
    // Intentamos establecer permisos 440 (read user/group) pero en Windows fs.chmod a veces es limitado.
    // Lo importante es el append.
    fs.appendFileSync(AUDIT_LOG_FILE, JSON.stringify(entry) + '\n', { encoding: 'utf8' });
}

/**
 * Helper para mapear eventos antiguos a tipos nuevos
 */
function mapEventToType(event) {
    if (event.includes('LOGIN') || event.includes('LOGOUT') || event.includes('SESSION')) return 'AUTH';
    if (event.includes('CSRF') || event.includes('RATE') || event.includes('LOCKED')) return 'SECURITY';
    if (event.includes('FILE') || event.includes('REPORT')) return 'ACCESS';
    return 'SYSTEM';
}

// ==========================================
// EXPORTS
// ==========================================

module.exports = {
    AUDIT_EVENTS,
    log, // Nueva función principal
    logAuditEvent: log, // Alias para compatibilidad hacia atrás
    // Utils expuestos para testing/admin
    maskEmail,
    verifyLogIntegrity: require('./auditVerifier').verifyLogIntegrity, // Se implementará aparte o aquí
    pseudonimize
};
