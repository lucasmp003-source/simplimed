const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const authMiddleware = require('../middleware/auth');

describe('Middleware de Autenticación - Server-Side Sessions', () => {
    let app;

    beforeEach(() => {
        app = express();
        app.use(express.json());
        app.use(cookieParser());

        // Limpiar sesiones antes de cada test para aislamiento
        authMiddleware.ACTIVE_SESSIONS.clear();

        // Ruta protegida de prueba
        app.get('/protected', authMiddleware.requireServerAuth, (req, res) => {
            res.json({ user: req.user });
        });

        app.get('/admin', authMiddleware.requireServerAuth, authMiddleware.requireAdminRole, (req, res) => {
            res.json({ message: 'Admin area' });
        });
    });

    describe('Validación de Sesión', () => {
        test('Debe rechazar request sin cookie de sesión', async () => {
            const response = await request(app).get('/protected');
            expect(response.status).toBe(302); // Redirección a login
            expect(response.header.location).toContain('/login');
        });

        test('Debe rechazar API request sin cookie con 401 JSON', async () => {
            // Simulamos request API con path que empieza por /api/ (aunque aquí la ruta es /protected, 
            // el middleware chequea req.path. Si cambiamos la ruta a /api/protected funcionaría distinto.
            // Vamos a redefinir la app para este test o usar una ruta /api
            const apiApp = express();
            apiApp.use(express.json());
            apiApp.use(cookieParser());
            apiApp.get('/api/protected', authMiddleware.requireServerAuth, (req, res) => res.json({ ok: true }));

            const response = await request(apiApp).get('/api/protected');
            expect(response.status).toBe(401);
            expect(response.body.message).toMatch(/sesión no válida/i);
        });

        test('Debe rechazar cookie de sesión inválida/inexistente', async () => {
            const response = await request(app)
                .get('/protected')
                .set('Cookie', ['auth_token=invalid-uuid']);

            expect(response.status).toBe(302);
        });

        test('Debe aceptar cookie de sesión válida', async () => {
            const validToken = 'valid-session-id';
            authMiddleware.ACTIVE_SESSIONS.set(validToken, {
                id: 'user123',
                email: 'medico@ujaen.es',
                role: 'medico',
                expiry: Date.now() + 3600000,
                createdAt: Date.now(),
                lastActivity: Date.now()
            });

            const response = await request(app)
                .get('/protected')
                .set('Cookie', [`auth_token=${validToken}`]);

            expect(response.status).toBe(200);
            expect(response.body.user.email).toBe('medico@ujaen.es');
        });
    });

    describe('Expiración de Sesión (Server-Side)', () => {
        test('Debe rechazar sesión expirada por tiempo (Sliding Window)', async () => {
            const token = 'expired-token';
            authMiddleware.ACTIVE_SESSIONS.set(token, {
                id: 'user1',
                email: 'test@ujaen.es',
                expiry: Date.now() - 1000, // Expirado hace 1s
                createdAt: Date.now() - 10000,
                lastActivity: Date.now()
            });

            const response = await request(app)
                .get('/protected')
                .set('Cookie', [`auth_token=${token}`]);

            expect(response.status).toBe(302); // Redirige
            expect(authMiddleware.ACTIVE_SESSIONS.has(token)).toBe(false); // Debe haber sido borrada
        });

        test('Debe rechazar sesión por inactividad (>30 min)', async () => {
            const token = 'inactive-token';
            authMiddleware.ACTIVE_SESSIONS.set(token, {
                id: 'user1',
                email: 'test@ujaen.es',
                expiry: Date.now() + 3600000,
                createdAt: Date.now() - 3600000,
                lastActivity: Date.now() - (31 * 60 * 1000) // Inactivo 31 min
            });

            const response = await request(app)
                .get('/protected')
                .set('Cookie', [`auth_token=${token}`]);

            expect(response.status).toBe(302);
            expect(authMiddleware.ACTIVE_SESSIONS.has(token)).toBe(false);
        });

        test('Debe rechazar sesión por timeout absoluto (>8h)', async () => {
            const token = 'absolute-timeout-token';
            authMiddleware.ACTIVE_SESSIONS.set(token, {
                id: 'user1',
                email: 'test@ujaen.es',
                expiry: Date.now() + 3600000, // Aún válida por ventana
                createdAt: Date.now() - (8 * 60 * 60 * 1000) - 1000, // Creada hace 8h + 1s
                lastActivity: Date.now()
            });

            const response = await request(app)
                .get('/protected')
                .set('Cookie', [`auth_token=${token}`]);

            expect(response.status).toBe(302);
            expect(authMiddleware.ACTIVE_SESSIONS.has(token)).toBe(false);
        });
    });

    describe('Control de Acceso Basado en Roles (RBAC)', () => {
        test('Debe rechazar usuario sin rol admin en ruta admin', async () => {
            const token = 'medico-token';
            authMiddleware.ACTIVE_SESSIONS.set(token, {
                id: 'user1',
                role: 'medico',
                expiry: Date.now() + 3600000
            });

            const response = await request(app)
                .get('/admin')
                .set('Cookie', [`auth_token=${token}`]);

            expect(response.status).toBe(403);
        });

        test('Debe permitir acceso a usuario con rol admin', async () => {
            const token = 'admin-token';
            authMiddleware.ACTIVE_SESSIONS.set(token, {
                id: 'admin1',
                role: 'admin',
                expiry: Date.now() + 3600000
            });

            const response = await request(app)
                .get('/admin')
                .set('Cookie', [`auth_token=${token}`]);

            expect(response.status).toBe(200);
        });
    });
});
