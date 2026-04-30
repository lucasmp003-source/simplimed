const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const authRoutesFactory = require('../routes/auth');
const authMiddleware = require('../middleware/auth');
const { setupSecurity } = require('../middleware/security');

describe('Prevención de Inyecciones', () => {
    let app;
    let mockDeps;

    beforeEach(() => {
        app = express();
        app.use(express.json());
        app.use(cookieParser());

        // Aplicar seguridad global (Helmet, Rate Limits).
        // Mockear rateLimit para evitar bloqueos en tests si fuera necesario, 
        // pero aquí queremos probar seguridad.
        setupSecurity(app);

        // Mock Dependencies
        mockDeps = {
            authMiddleware,
            userDatabase: { USERS_DATABASE: [], saveUsers: jest.fn() },
            emailService: { passwordResetTokens: new Map() },
            auditLog: { logAuditEvent: jest.fn(), AUDIT_EVENTS: {} },
            securityUtils: {
                isAccountLocked: jest.fn(() => false),
                recordFailedAttempt: jest.fn(() => false),
                resetLoginAttempts: jest.fn(),
                getLockoutRemainingMinutes: jest.fn(() => 0)
            }
        };

        app.use(authRoutesFactory(mockDeps));
    });

    describe('SQL Injection & NoSQL Injection', () => {
        test('Debe rechazar payloads SQL en campos de email', async () => {
            const sqlPayloads = [
                "admin'--",
                "admin' OR '1'='1",
                "admin'; DROP TABLE users;--",
                "' OR 1=1--"
            ];

            for (const payload of sqlPayloads) {
                const response = await request(app)
                    .post('/api/login')
                    .send({ email: payload, password: 'test' });

                // Esperamos 400 por validación de email regex
                expect(response.status).toBe(400);
                expect(response.body.message).toMatch(/formato de email/i);
            }
        });

        test('Debe rechazar objetos (NoSQL Injection) en campos de texto', async () => {
            const response = await request(app)
                .post('/api/login')
                .send({
                    email: { "$ne": null }, // Payload típico de MongoDB/NoSQL
                    password: "any"
                });

            // El endpoint espera string en req.body.email.
            // isValidEmail valida `typeof email !== 'string'`.
            expect(response.status).toBe(400);
        });
    });

    describe('XSS (Cross-Site Scripting)', () => {
        // setupSecurity ya se aplicó en beforeEach si lo descomentamos, 
        // o lo aplicamos aquí dentro del test si queremos especificidad.
        // Mejor descomentarlo en beforeEach para simular entorno real.

        test('Debe rechazar scripts en inputs validados (email)', async () => {
            const xssPayloads = [
                '<script>alert("XSS")</script>',
                'javascript:alert(1)',
                '"><script>alert(1)</script>'
            ];

            for (const payload of xssPayloads) {
                const response = await request(app)
                    .post('/api/login')
                    .send({ email: payload, password: 'test' });

                expect(response.status).toBe(400); // Falla validación regex
            }
        });
    });

    describe('Command Injection', () => {
        // Probamos inputs que podrían ir a un shell exec (aunque en login no hay, es bueno validar)
        test('Debe rechazar caracteres de shell en inputs', async () => {
            const cmdPayloads = [
                'test; rm -rf /',
                'test && whoami'
            ];

            for (const payload of cmdPayloads) {
                const response = await request(app)
                    .post('/api/login')
                    .send({ email: payload, password: 'test' });

                expect(response.status).toBe(400);
            }
        });
    });
});
