const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcrypt');

// Importar rutas y middleware real
const authRoutesFactory = require('../routes/auth');
const authMiddleware = require('../middleware/auth');

describe('Seguridad de Sesiones y Cookies', () => {
    let app;
    let mockDeps;
    let mockUserDB;

    beforeEach(async () => {
        app = express();
        app.use(express.json());
        app.use(cookieParser());

        // Limpiar sesiones
        authMiddleware.ACTIVE_SESSIONS.clear();

        // Crear usuario mock con password hasheado
        const hashedPassword = await bcrypt.hash('testpass', 10);
        mockUserDB = [{
            id: 'user1',
            email: 'test@ujaen.es',
            password: hashedPassword,
            firstName: 'Test',
            lastName: 'User',
            role: 'medico'
        }];

        // Mock Dependencies
        mockDeps = {
            authMiddleware,
            userDatabase: {
                USERS_DATABASE: mockUserDB,
                saveUsers: jest.fn()
            },
            emailService: {
                passwordResetTokens: new Map(),
                generateResetToken: () => 'mock-token',
                sendPasswordResetEmail: jest.fn()
            },
            auditLog: {
                logAuditEvent: jest.fn(),
                AUDIT_EVENTS: { LOGIN_SUCCESS: 'LOGIN', LOGIN_FAILED: 'FAIL', LOGOUT: 'LOGOUT' }
            },
            securityUtils: {
                isAccountLocked: jest.fn(() => false),
                recordFailedAttempt: jest.fn(() => false),
                resetLoginAttempts: jest.fn(),
                getLockoutRemainingMinutes: jest.fn(() => 0)
            }
        };

        // Montar rutas de auth
        app.use(authRoutesFactory(mockDeps));
    });

    describe('Cookie Security Flags', () => {
        test('Cookies de sesión deben tener HttpOnly y SameSite=Strict', async () => {
            const response = await request(app)
                .post('/api/login')
                .send({ email: 'test@ujaen.es', password: 'testpass' });

            const cookies = response.headers['set-cookie'];
            expect(cookies).toBeDefined();

            // Verificar flags en el string de la cookie
            const cookieStr = cookies[0];
            expect(cookieStr).toMatch(/HttpOnly/i);
            expect(cookieStr).toMatch(/SameSite=Strict/i);
            expect(cookieStr).toMatch(/Path=\//);
        });

        test('Cookies deben ser Secure en producción', async () => {
            // Guardar env original
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';

            try {
                const response = await request(app)
                    .post('/api/login')
                    .send({ email: 'test@ujaen.es', password: 'testpass' });

                const cookies = response.headers['set-cookie'];
                expect(cookies[0]).toMatch(/Secure/i);
            } finally {
                process.env.NODE_ENV = originalEnv;
            }
        });
    });

    describe('Session Fixation & Management', () => {
        test('Debe generar nuevo token (uuid) en cada login', async () => {
            // Primer login
            const res1 = await request(app)
                .post('/api/login')
                .send({ email: 'test@ujaen.es', password: 'testpass' });

            const cookie1 = res1.headers['set-cookie'][0].split(';')[0];
            const token1 = cookie1.split('=')[1];

            // Segundo login (mismo usuario)
            const res2 = await request(app)
                .post('/api/login')
                .send({ email: 'test@ujaen.es', password: 'testpass' });

            const cookie2 = res2.headers['set-cookie'][0].split(';')[0];
            const token2 = cookie2.split('=')[1];

            // Tokens deben ser diferentes
            expect(token1).not.toBe(token2);
            // Ambos deben ser validos (auth.js permite sesiones múltiples por defecto salvo invalidación explícita)
            expect(authMiddleware.ACTIVE_SESSIONS.has(token1)).toBe(true);
            expect(authMiddleware.ACTIVE_SESSIONS.has(token2)).toBe(true);
        });

        test('Logout debe limpiar la cookie y borrar sesión serv-side', async () => {
            // Login
            const loginRes = await request(app)
                .post('/api/login')
                .send({ email: 'test@ujaen.es', password: 'testpass' });

            const cookie = loginRes.headers['set-cookie'];
            const token = cookie[0].split(';')[0].split('=')[1];

            // Logout
            const logoutRes = await request(app)
                .post('/api/logout')
                .set('Cookie', cookie);

            expect(logoutRes.status).toBe(200);

            // Cookie debe estar vacía/expirada
            const logoutCookie = logoutRes.headers['set-cookie'][0];
            expect(logoutCookie).toMatch(/auth_token=;/); // Cookie vacía

            // Sesión borrada de memoria
            expect(authMiddleware.ACTIVE_SESSIONS.has(token)).toBe(false);
        });
    });

    describe('Concurrency', () => {
        test('Múltiples requests simultáneos deben mantaner sesión válida', async () => {
            // Login
            const loginRes = await request(app)
                .post('/api/login')
                .send({ email: 'test@ujaen.es', password: 'testpass' });

            const cookie = loginRes.headers['set-cookie'];

            // Endpoint protegido simple para test
            app.get('/api/session', authMiddleware.passiveSessionCheck, (req, res) => {
                // Esta ruta usa passive check que actualiza lastActivity
                res.json({ ok: true });
            });

            // 10 requests simultáneos
            const promises = Array(10).fill().map(() =>
                request(app).get('/api/session').set('Cookie', cookie)
            );

            const results = await Promise.all(promises);

            results.forEach(res => {
                expect(res.status).toBe(200);
            });
        });
    });
});
