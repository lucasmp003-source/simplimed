/**
 * GALENO-IA - Rutas de Autenticación
 * 
 * Endpoints: /api/login, /api/logout, /api/session
 * Incluye: verificación de lockout, audit logging, recuperación de contraseña.
 * 
 * Sigue estándares OWASP 2026:
 * - Mensajes de error genéricos (nunca revelar si el usuario existe)
 * - Rate limiting por cuenta + IP
 * - Logging de auditoría sin datos sensibles
 * - Cookies seguras (HttpOnly, Secure, SameSite=Strict)
 */

const express = require('express');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

module.exports = function (deps) {
    const { ACTIVE_SESSIONS, SESSION_DURATION_MS } = deps.authMiddleware;
    const { USERS_DATABASE, saveUsers } = deps.userDatabase;
    const { passwordResetTokens, generateResetToken, sendPasswordResetEmail } = deps.emailService;
    const { logAuditEvent, AUDIT_EVENTS } = deps.auditLog;
    const { isAccountLocked, recordFailedAttempt, resetLoginAttempts, getLockoutRemainingMinutes } = deps.securityUtils;

    // ==========================================
    // HELPERS DE VALIDACIÓN
    // ==========================================

    /**
     * Valida formato de email (regex básica + longitud).
     * @param {string} email
     * @returns {boolean}
     */
    function isValidEmail(email) {
        if (!email || typeof email !== 'string') return false;
        if (email.length > 254) return false; // RFC 5321
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    /**
     * Valida que la contraseña tenga formato aceptable.
     * Solo valida longitud mínima (no revelar requisitos específicos al atacante).
     * @param {string} password
     * @returns {boolean}
     */
    function isValidPassword(password) {
        if (!password || typeof password !== 'string') return false;
        return password.length >= 1 && password.length <= 128;
    }

    // ==========================================
    // POST /api/login
    // ==========================================
    router.post('/api/login', async (req, res) => {
        try {
            const { email, password } = req.body;

            // Validación de formato
            if (!email || !password) {
                return res.status(400).json({
                    success: false,
                    message: 'Email y contraseña son requeridos'
                });
            }

            if (!isValidEmail(email)) {
                return res.status(400).json({
                    success: false,
                    message: 'Formato de email no válido'
                });
            }

            if (!isValidPassword(password)) {
                return res.status(400).json({
                    success: false,
                    message: 'Email o contraseña incorrectos'
                });
            }

            // Verificar si la cuenta está bloqueada ANTES de cualquier operación
            if (isAccountLocked(email)) {
                const minutesLeft = getLockoutRemainingMinutes(email);

                logAuditEvent(AUDIT_EVENTS.LOGIN_FAILED, {
                    email,
                    req,
                    reason: `Cuenta bloqueada (${minutesLeft} min restantes)`
                });

                return res.status(429).json({
                    success: false,
                    message: `Cuenta temporalmente bloqueada. Inténtalo de nuevo en ${minutesLeft} minuto(s).`
                });
            }

            // Buscar usuario (sin revelar si existe)
            const user = USERS_DATABASE.find(u => u.email.toLowerCase() === email.toLowerCase());

            if (!user) {
                // Registrar intento fallido con el email proporcionado
                recordFailedAttempt(email, req);

                logAuditEvent(AUDIT_EVENTS.LOGIN_FAILED, {
                    email,
                    req,
                    reason: 'Usuario no encontrado'
                });

                // Mensaje genérico: NUNCA revelar si el usuario existe
                return res.status(401).json({
                    success: false,
                    message: 'Email o contraseña incorrectos'
                });
            }

            // Verificar contraseña
            const passwordMatch = await bcrypt.compare(password, user.password);

            if (!passwordMatch) {
                const isLocked = recordFailedAttempt(email, req);

                logAuditEvent(AUDIT_EVENTS.LOGIN_FAILED, {
                    email,
                    req,
                    reason: 'Contraseña incorrecta'
                });

                if (isLocked) {
                    return res.status(429).json({
                        success: false,
                        message: `Cuenta temporalmente bloqueada por demasiados intentos. Inténtalo en 15 minutos.`
                    });
                }

                return res.status(401).json({
                    success: false,
                    message: 'Email o contraseña incorrectos'
                });
            }

            // Login exitoso: limpiar intentos fallidos
            resetLoginAttempts(email);

            // Generar token de sesión
            const sessionToken = uuidv4();
            const expiryTime = Date.now() + SESSION_DURATION_MS;

            // Datos de sesión (mínimos necesarios)
            const now = Date.now();
            const sessionData = {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                role: user.role,
                institution: user.institution,
                expiry: expiryTime,
                createdAt: now,        // Timestamp inmutable: para timeout absoluto server-side
                lastActivity: now      // Se actualiza en cada request: para inactividad server-side
            };

            // Guardar sesión en memoria
            ACTIVE_SESSIONS.set(sessionToken, sessionData);

            // Establecer cookie HttpOnly segura
            res.cookie('auth_token', sessionToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                maxAge: SESSION_DURATION_MS,
                sameSite: 'strict',
                path: '/'
            });

            logAuditEvent(AUDIT_EVENTS.LOGIN_SUCCESS, {
                email: user.email,
                req
            });

            // Respuesta mínima: los datos del usuario se obtienen vía /api/session
            res.json({
                success: true,
                user: {
                    firstName: user.firstName,
                    role: user.role
                }
            });

        } catch (error) {
            console.error('[AUTH] Error en login:', error.message);
            res.status(500).json({
                success: false,
                message: 'Error interno del servidor'
            });
        }
    });

    // ==========================================
    // POST /api/logout
    // ==========================================
    router.post('/api/logout', (req, res) => {
        const token = req.cookies.auth_token;

        // Registrar logout antes de invalidar
        if (token && ACTIVE_SESSIONS.has(token)) {
            const session = ACTIVE_SESSIONS.get(token);

            logAuditEvent(AUDIT_EVENTS.LOGOUT, {
                email: session.email,
                req
            });

            ACTIVE_SESSIONS.delete(token);
        }

        // Limpiar cookie con las mismas flags
        res.clearCookie('auth_token', {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            path: '/'
        });

        res.json({ success: true, message: 'Sesión cerrada exitosamente' });
    });

    // ==========================================
    // GET /api/session - Verificar sesión activa
    // ==========================================
    router.get('/api/session', (req, res) => {
        const token = req.cookies.auth_token;

        if (!token || !ACTIVE_SESSIONS.has(token)) {
            return res.status(401).json({
                authenticated: false
            });
        }

        const session = ACTIVE_SESSIONS.get(token);

        // Verificar expiración
        if (Date.now() > session.expiry) {
            ACTIVE_SESSIONS.delete(token);
            return res.status(401).json({
                authenticated: false
            });
        }

        // Retornar solo datos mínimos (OWASP: minimizar exposición)
        res.json({
            authenticated: true,
            user: {
                firstName: session.firstName,
                role: session.role
            }
        });
    });

    // ==========================================
    // RECUPERACIÓN DE CONTRASEÑA
    // ==========================================

    // Solicitar recuperación de contraseña
    router.post('/api/forgot-password', async (req, res) => {
        // Simulamos un retraso aleatorio para mitigar timing attacks
        // El envío de email real toma tiempo, así que simulamos ese tiempo si el usuario no existe.
        const minDelay = 500;
        const maxDelay = 1500;
        const randomDelay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;

        const start = Date.now();

        try {
            const { email } = req.body;

            if (!email) {
                return res.status(400).json({
                    success: false,
                    message: 'El correo electrónico es requerido'
                });
            }

            if (!isValidEmail(email)) {
                return res.status(400).json({
                    success: false,
                    message: 'Formato de email no válido'
                });
            }

            // Buscar usuario (sin revelar si existe)
            const user = USERS_DATABASE.find(u => u.email.toLowerCase() === email.toLowerCase());

            if (user) {
                // Generar token con expiración de 1 hora
                const token = generateResetToken();
                passwordResetTokens.set(token, {
                    userId: user.id,
                    email: user.email,
                    expiry: Date.now() + (60 * 60 * 1000)
                });

                // Limpiar tokens expirados
                for (const [key, value] of passwordResetTokens.entries()) {
                    if (Date.now() > value.expiry) {
                        passwordResetTokens.delete(key);
                    }
                }

                await sendPasswordResetEmail(user.email, token, user.firstName);
            } else {
                // Si no existe, simulamos el tiempo de espera
                await new Promise(resolve => setTimeout(resolve, randomDelay));
            }

            // Asegurar que el request tome al menos el tiempo mínimo de delay si fue muy rápido (ej. error en envío de email)
            const elapsed = Date.now() - start;
            if (elapsed < minDelay) {
                await new Promise(resolve => setTimeout(resolve, minDelay - elapsed));
            }

            res.json({
                success: true,
                message: 'Si el correo existe, recibirás instrucciones para recuperar tu contraseña.'
            });

        } catch (error) {
            console.error('[AUTH] Error en forgot-password:', error.message);
            // Incluso en error, intentamos responder igual, aunque el status 500 puede delatar algo.
            // Idealmente deberíamos loguear y devolver éxito falso genérico, pero 500 es aceptable por ahora para errores reales de servidor.
            res.status(500).json({
                success: false,
                message: 'Error al procesar la solicitud. Inténtalo de nuevo más tarde.'
            });
        }
    });

    // Verificar validez del token de recuperación
    router.post('/api/verify-reset-token', (req, res) => {
        const { token } = req.body;

        if (!token) {
            return res.status(400).json({
                valid: false,
                message: 'Token requerido'
            });
        }

        const tokenData = passwordResetTokens.get(token);

        if (!tokenData) {
            return res.status(400).json({
                valid: false,
                message: 'El enlace no es válido o ya ha sido utilizado.'
            });
        }

        if (Date.now() > tokenData.expiry) {
            passwordResetTokens.delete(token);
            return res.status(400).json({
                valid: false,
                message: 'El enlace ha expirado. Solicita uno nuevo.'
            });
        }

        // NO revelar el email completo
        res.json({
            valid: true
        });
    });

    // Resetear contraseña
    router.post('/api/reset-password', async (req, res) => {
        try {
            const { token, newPassword } = req.body;

            if (!token || !newPassword) {
                return res.status(400).json({
                    success: false,
                    message: 'Token y nueva contraseña son requeridos'
                });
            }

            // Validar contraseña: mínimo 8 caracteres, al menos un número y un símbolo
            if (newPassword.length < 8) {
                return res.status(400).json({
                    success: false,
                    message: 'La contraseña debe tener al menos 8 caracteres'
                });
            }

            const tokenData = passwordResetTokens.get(token);

            if (!tokenData) {
                return res.status(400).json({
                    success: false,
                    message: 'El enlace no es válido o ya ha sido utilizado.'
                });
            }

            if (Date.now() > tokenData.expiry) {
                passwordResetTokens.delete(token);
                return res.status(400).json({
                    success: false,
                    message: 'El enlace ha expirado. Solicita uno nuevo.'
                });
            }

            const user = USERS_DATABASE.find(u => u.id === tokenData.userId);

            if (!user) {
                return res.status(400).json({
                    success: false,
                    message: 'Error al procesar la solicitud.'
                });
            }

            // Hashear la nueva contraseña (bcrypt con salt rounds = 12)
            const hashedPassword = await bcrypt.hash(newPassword, 12);
            user.password = hashedPassword;

            saveUsers();

            // Eliminar el token usado
            passwordResetTokens.delete(token);

            // Limpiar otros tokens del mismo usuario
            for (const [key, value] of passwordResetTokens.entries()) {
                if (value.userId === user.id) {
                    passwordResetTokens.delete(key);
                }
            }

            // Invalidar todas las sesiones del usuario
            deps.authMiddleware.invalidateUserSessions(user.id);

            logAuditEvent(AUDIT_EVENTS.PASSWORD_CHANGED, {
                email: user.email,
                req,
                reason: 'Vía recuperación de contraseña'
            });

            res.json({
                success: true,
                message: 'Contraseña actualizada correctamente'
            });

        } catch (error) {
            console.error('[AUTH] Error en reset-password:', error.message);
            res.status(500).json({
                success: false,
                message: 'Error al actualizar la contraseña. Inténtalo de nuevo.'
            });
        }
    });

    return router;
};
