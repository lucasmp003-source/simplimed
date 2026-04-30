const request = require('supertest');
const express = require('express');
const csrfMiddleware = require('../middleware/csrf');
const cookieParser = require('cookie-parser');

describe('Protección CSRF - Tests de Seguridad', () => {
    let app;

    beforeAll(() => {
        app = express();
        app.use(cookieParser());
        app.use(express.json());
        app.use(csrfMiddleware.csrfCookieMiddleware);
        app.use(csrfMiddleware.csrfValidationMiddleware);

        app.post('/api/protected', (req, res) => {
            res.json({ success: true });
        });

        app.get('/api/get-token', (req, res) => {
            res.json({ success: true });
        });
    });

    test('GET debe pasar sin token CSRF', async () => {
        const response = await request(app).get('/api/get-token');
        expect(response.status).toBe(200);
    });

    test('POST sin token CSRF debe fallar con 403', async () => {
        const response = await request(app)
            .post('/api/protected')
            .send({ data: 'test' });

        expect(response.status).toBe(403);
        expect(response.body.message).toMatch(/Token de seguridad inválido/i);
    });

    test('POST con token CSRF inválido debe fallar', async () => {
        const response = await request(app)
            .post('/api/protected')
            .set('X-CSRF-Token', 'tokeninvalido')
            .set('Cookie', ['_csrf=otrotoken'])
            .send({ data: 'test' });

        expect(response.status).toBe(403);
    });

    test('POST con cookie ausente pero header presente debe fallar con 401', async () => {
        const response = await request(app)
            .post('/api/protected')
            .set('X-CSRF-Token', 'alguntoken')
            .send({ data: 'test' });

        expect(response.status).toBe(401);
    });

    test('POST con token CSRF válido debe pasar', async () => {
        // Simular token válido (ajustar según tu implementación)
        const token = 'validtoken123';

        const response = await request(app)
            .post('/api/protected')
            .set('X-CSRF-Token', token)
            .set('Cookie', [`_csrf=${token}`])
            .send({ data: 'test' });

        expect(response.status).toBe(200);
    });
});
