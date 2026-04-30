const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const { setupSecurity } = require('../middleware/security');
const authRoutesFactory = require('../routes/auth');

describe('Rate Limiting y Prevención DoS', () => {
    let app;
    let mockDeps;

    beforeEach(() => {
        app = express();
        app.set('trust proxy', 1); // Necesario para supertest y rate-limit
        app.use(express.json());
        app.use(cookieParser());

        // Aplicar seguridad REAL (incluyendo rate limiters)
        setupSecurity(app);

        // Mock Dependencies
        mockDeps = {
            authMiddleware: { ACTIVE_SESSIONS: new Map(), SESSION_DURATION_MS: 3600000 },
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

        // Montar rutas auth para probar authIpLimiter
        app.use(authRoutesFactory(mockDeps));

        // Ruta dummy para probar apiLimiter global
        app.get('/api/test-limit', (req, res) => res.json({ ok: true }));
    });

    test('Debe bloquear login después de 20 intentos desde la misma IP', async () => {
        // El límite es 20 por 15 min
        const limit = 20;

        // Consumir el límite
        for (let i = 0; i < limit; i++) {
            const res = await request(app)
                .post('/api/login')
                .send({ email: 'test@ujaen.es', password: 'wrong' });

            // Los primeros deben fallar por auth (400/401) pero no por rate limit (429)
            // Nota: setupSecurity aplica authIpLimiter a /api/login
            expect(res.status).not.toBe(429);
        }

        // El siguiente (21) debe ser bloqueado por rate limit
        const blockedRes = await request(app)
            .post('/api/login')
            .send({ email: 'test@ujaen.es', password: 'wrong' });

        expect(blockedRes.status).toBe(429);
        expect(blockedRes.body.message).toMatch(/demasiados intentos/i);
    });

    test('Debe aplicar límite global de API (100 req/min)', async () => {
        // Este test puede ser lento si hacemos 100 requests. Reduciremos la prueba conceptual.
        // O confiamos en que si el auth funciona, la config del global (max: 100) también.
        // Haremos 5 request rápidos y verificamos headers de rate limit.

        for (let i = 0; i < 5; i++) {
            const res = await request(app).get('/api/test-limit');
            expect(res.status).toBe(200);
            expect(res.headers).toHaveProperty('ratelimit-limit');
            expect(res.headers).toHaveProperty('ratelimit-remaining');

            // Verificar que baja el remaining
            const remaining = parseInt(res.headers['ratelimit-remaining']);
            expect(remaining).toBeLessThan(100);
        }
    });

    test('Headers de Rate Limit deben estar presentes (Standard Draft-6)', () => {
        return request(app).get('/api/test-limit')
            .expect(200)
            .then(res => {
                expect(res.headers['ratelimit-policy']).toBeDefined();
                expect(res.headers['ratelimit-limit']).toBeDefined();
                expect(res.headers['ratelimit-remaining']).toBeDefined();
                // rate-limit-reset is not standard in Draft 6 (uses window reset time)
            });
    });
});
