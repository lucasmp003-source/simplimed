const request = require('supertest');
const app = require('../api'); // Import the app from api.js

describe('Seguridad General - Headers y Configuración', () => {

    test('Debe tener headers de seguridad (helmet)', async () => {
        const response = await request(app).get('/api/session'); // Endpoint válido

        expect(response.headers['x-content-type-options']).toBe('nosniff');
        expect(response.headers['x-frame-options']).toBeDefined();
    });

    test('No debe exponer información del servidor', async () => {
        const response = await request(app).get('/api/session');

        expect(response.headers['x-powered-by']).toBeUndefined();
    });
});
