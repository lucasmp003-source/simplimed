const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const authRouteFactory = require('../routes/auth');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

describe('Autenticación - Tests de Seguridad', () => {
    let app;
    let mockDeps;
    let mockUsers;

    beforeAll(async () => {
        // Setup Mock Dependencies
        const hashedPassword = await bcrypt.hash('correctPassword', 10);

        mockUsers = [
            {
                id: '1',
                email: 'medico@ujaen.es',
                password: hashedPassword,
                role: 'medico',
                firstName: 'Juan',
                lastName: 'Medico',
                institution: 'UJA'
            }
        ];

        mockDeps = {
            authMiddleware: {
                ACTIVE_SESSIONS: new Map(),
                SESSION_DURATION_MS: 3600000,
                invalidateUserSessions: jest.fn()
            },
            userDatabase: {
                USERS_DATABASE: mockUsers,
                saveUsers: jest.fn()
            },
            emailService: {
                passwordResetTokens: new Map(),
                generateResetToken: jest.fn(() => 'mock-token'),
                sendPasswordResetEmail: jest.fn()
            },
            auditLog: {
                logAuditEvent: jest.fn(),
                AUDIT_EVENTS: {
                    LOGIN_SUCCESS: 'LOGIN_SUCCESS',
                    LOGIN_FAILED: 'LOGIN_FAILED',
                    LOGOUT: 'LOGOUT',
                    PASSWORD_CHANGED: 'PASSWORD_CHANGED'
                }
            },
            securityUtils: {
                isAccountLocked: jest.fn(() => false),
                recordFailedAttempt: jest.fn(() => false),
                resetLoginAttempts: jest.fn(),
                getLockoutRemainingMinutes: jest.fn(() => 0)
            }
        };

        app = express();
        app.use(express.json());
        app.use(cookieParser()); // Auth routes need cookie parser
        app.use('/', authRouteFactory(mockDeps));
    });

    afterEach(() => {
        jest.clearAllMocks();
        mockDeps.authMiddleware.ACTIVE_SESSIONS.clear();
    });

    describe('POST /api/login', () => {
        test('Debe rechazar login sin credenciales', async () => {
            const response = await request(app)
                .post('/api/login')
                .send({});

            expect(response.status).toBe(400);
        });

        test('Debe rechazar contraseña incorrecta', async () => {
            const response = await request(app)
                .post('/api/login')
                .send({
                    email: 'medico@ujaen.es',
                    password: 'wrongPassword'
                });

            expect(response.status).toBe(401);
            expect(mockDeps.securityUtils.recordFailedAttempt).toHaveBeenCalled();
        });

        test('Debe aceptar credenciales válidas y devolver token', async () => {
            const response = await request(app)
                .post('/api/login')
                .send({
                    email: 'medico@ujaen.es',
                    password: 'correctPassword'
                });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.headers['set-cookie']).toBeDefined();
            expect(mockDeps.authMiddleware.ACTIVE_SESSIONS.size).toBe(1);
        });

        test('Debe bloquear cuenta si securityUtils lo indica', async () => {
            mockDeps.securityUtils.isAccountLocked.mockReturnValueOnce(true);
            mockDeps.securityUtils.getLockoutRemainingMinutes.mockReturnValueOnce(15);

            const response = await request(app)
                .post('/api/login')
                .send({
                    email: 'medico@ujaen.es',
                    password: 'correctPassword'
                });

            expect(response.status).toBe(429);
            expect(response.body.message).toMatch(/bloqueada/);
        });
    });

    describe('POST /api/logout', () => {
        test('Debe limpiar la sesión al hacer logout', async () => {
            // Pre-exist session
            const token = 'valid-token';
            mockDeps.authMiddleware.ACTIVE_SESSIONS.set(token, { email: 'medico@ujaen.es' });

            const response = await request(app)
                .post('/api/logout')
                .set('Cookie', [`auth_token=${token}`]);

            expect(response.status).toBe(200);
            expect(mockDeps.authMiddleware.ACTIVE_SESSIONS.has(token)).toBe(false);
            expect(response.headers['set-cookie'][0]).toMatch(/Expires=Thu, 01 Jan 1970/);
        });
    });
});
