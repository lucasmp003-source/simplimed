/**
 * Helper para verificar la integridad de la cadena de logs
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LOGS_DIR = path.join(__dirname, '../../../logs');
const AUDIT_LOG_FILE = path.join(LOGS_DIR, 'audit.log');

/**
 * Recalcula hash para verificación
 */
function calculateLogHash(entry) {
    const toHash = {
        timestamp: entry.timestamp,
        userId: entry.userId,
        eventType: entry.eventType,
        action: entry.action,
        resource: entry.resource,
        previousHash: entry.previousHash
    };
    const dataString = JSON.stringify(toHash);
    return crypto.createHash('sha256').update(dataString).digest('hex');
}

function verifyLogIntegrity() {
    if (!fs.existsSync(AUDIT_LOG_FILE)) {
        return { valid: true, message: 'No logs found' };
    }

    const data = fs.readFileSync(AUDIT_LOG_FILE, 'utf8').trim();
    if (!data) return { valid: true, message: 'Empty log file' };

    const lines = data.split('\n');
    let prevHash = '0'.repeat(64);
    let brokenAt = null;

    for (let i = 0; i < lines.length; i++) {
        try {
            const line = lines[i];
            if (!line) continue;
            const entry = JSON.parse(line);

            // 1. Verificar encadenado
            if (entry.previousHash !== prevHash) {
                brokenAt = { index: i, reason: 'Broken chain', timestamp: entry.timestamp };
                break;
            }

            // 2. Verificar hash del contenido
            const calculated = calculateLogHash(entry);
            if (calculated !== entry.hash) {
                brokenAt = { index: i, reason: 'Tampered content', timestamp: entry.timestamp };
                break;
            }

            prevHash = entry.hash;
        } catch (e) {
            brokenAt = { index: i, reason: 'JSON Parse Error' };
            break;
        }
    }

    if (brokenAt) {
        return { valid: false, error: brokenAt };
    }
    return { valid: true, count: lines.length };
}

module.exports = { verifyLogIntegrity };
