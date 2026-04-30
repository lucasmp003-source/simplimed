const bcrypt = require('bcrypt');

/**
 * Crea un usuario de prueba con password hasheado
 */
async function createTestUser(email, password, role = 'medico') {
    return {
        email,
        password: await bcrypt.hash(password, 10),
        role,
        createdAt: new Date()
    };
}

/**
 * Genera token de sesión válido para tests
 */
function generateTestToken(userId) {
    const jwt = require('jsonwebtoken');
    return jwt.sign(
        { userId, email: 'test@ujaen.es' },
        process.env.JWT_SECRET || 'test-secret',
        { expiresIn: '1h' }
    );
}

/**
 * Crea archivo PDF mínimo válido para tests
 */
function createMinimalPDF() {
    return Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj\nxref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n0000000052 00000 n\n0000000101 00000 n\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n178\n%%EOF');
}

module.exports = {
    createTestUser,
    generateTestToken,
    createMinimalPDF
};
