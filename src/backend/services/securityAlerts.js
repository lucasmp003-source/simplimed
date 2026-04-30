/**
 * GALENO-IA - Sistema de Alertas de Seguridad
 * 
 * Detecta patrones en logs de auditoría y envía alertas.
 */

const fs = require('fs');
const path = require('path');
const { AUDIT_EVENTS } = require('./auditLog');
// const emailService = require('./emailService'); // Descomentar integración real

const LOGS_DIR = path.join(__dirname, '../../../logs');
const AUDIT_LOG_FILE = path.join(LOGS_DIR, 'audit.log');

const CRITICAL_EVENTS = [
    AUDIT_EVENTS.LOGIN_FAILED,
    AUDIT_EVENTS.CSRF_VIOLATION,
    AUDIT_EVENTS.UNAUTHORIZED_ACCESS,
    AUDIT_EVENTS.ACCOUNT_LOCKED,
    AUDIT_EVENTS.SECURITY_ALERT
];

/**
 * Analiza eventos recientes para detectar amenazas.
 * Debería ejecutarse periódicamente (ej: cron cada 5-15 min).
 */
function analyzeSecurityEvents() {
    if (!fs.existsSync(AUDIT_LOG_FILE)) return;

    const recentLogs = getRecentLogs(15 * 60 * 1000); // Últimos 15 min

    if (recentLogs.length === 0) return;

    // 1. Detección de Brute Force (Múltiples fallos desde misma IP)
    const failuresByIp = {};
    recentLogs.forEach(log => {
        if (log.outcome === 'FAILED' && log.eventType === 'AUTH') {
            const ip = log.ip || 'unknown';
            if (!failuresByIp[ip]) failuresByIp[ip] = [];
            failuresByIp[ip].push(log);
        }
    });

    for (const [ip, failures] of Object.entries(failuresByIp)) {
        if (failures.length >= 5) { // Umbral: 5 intentos fallidos
            sendAlert({
                severity: 'HIGH',
                type: 'BRUTE_FORCE_ATTEMPT',
                message: `${failures.length} intentos fallidos de login desde IP ${ip}`,
                timestamp: new Date().toISOString()
            });
        }
    }

    // 2. Acceso fuera de horario (Simulado: horario laboral 08:00 - 20:00)
    recentLogs.forEach(log => {
        if (log.eventType === 'ACCESS') { // Acceso a datos
            const hour = new Date(log.timestamp).getHours();
            if (hour < 8 || hour > 20) {
                sendAlert({
                    severity: 'MEDIUM',
                    type: 'OFF_HOURS_ACCESS',
                    message: `Acceso a datos médicos fuera de horario por ${log.userId}`,
                    timestamp: log.timestamp
                });
            }
        }
    });
}

/**
 * Lee logs de los últimos X milisegundos
 */
function getRecentLogs(durationMs) {
    try {
        const data = fs.readFileSync(AUDIT_LOG_FILE, 'utf8');
        const lines = data.split('\n').filter(line => line.trim());
        const now = Date.now();
        const threshold = now - durationMs;

        return lines
            .map(line => {
                try { return JSON.parse(line); } catch (e) { return null; }
            })
            .filter(entry => entry && new Date(entry.timestamp).getTime() > threshold);
    } catch (e) {
        console.error('Error reading logs for analysis:', e);
        return [];
    }
}

/**
 * Envía alerta (Simulado por ahora, integrar con emailService)
 */
function sendAlert(alert) {
    console.error(`[SECURITY_ALERT] [${alert.severity}] ${alert.type}: ${alert.message}`);
    // emailService.send(...)
}

module.exports = {
    analyzeSecurityEvents,
    CRITICAL_EVENTS
};
