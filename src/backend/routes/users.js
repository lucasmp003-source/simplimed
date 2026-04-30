/**
 * GALENO-IA - Rutas de Gestión de Usuarios
 * 
 * Endpoints admin (CRUD) y endpoints de perfil de usuario.
 * Todos los endpoints están protegidos con requireServerAuth.
 * 
 * OWASP 2026: Todos los endpoints usan req.user de la sesión,
 * no confían en parámetros del cliente para identificar al usuario.
 */

const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();

module.exports = function (deps) {
    const { requireServerAuth, requireAdminRole, ACTIVE_SESSIONS, invalidateUserSessions } = deps.authMiddleware;
    const { USERS_DATABASE, saveUsers } = deps.userDatabase;
    const { logAuditEvent, AUDIT_EVENTS } = deps.auditLog;

    // ==========================================
    // API GESTIÓN DE USUARIOS (ADMIN)
    // ==========================================

    // Listar todos los usuarios
    router.get('/api/users', requireServerAuth, requireAdminRole, (req, res) => {
        // Devolver usuarios sin la contraseña
        const safeUsers = USERS_DATABASE.map(user => {
            const { password, ...userWithoutPassword } = user;
            return userWithoutPassword;
        });
        res.json(safeUsers);
    });

    // Crear nuevo usuario
    router.post('/api/users', requireServerAuth, requireAdminRole, async (req, res) => {
        try {
            const { email, password, firstName, lastName, role, institution } = req.body;

            if (!email || !password || !firstName || !lastName) {
                return res.status(400).json({ error: 'Todos los campos obligatorios son requeridos' });
            }

            // Strict Password Validation
            if (password.length < 8) {
                return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
            }
            if (!/\d/.test(password)) {
                return res.status(400).json({ error: 'La contraseña debe contener al menos un número' });
            }
            if (!/[^a-zA-Z0-9\sñÑáéíóúÁÉÍÓÚ]/.test(password)) {
                return res.status(400).json({ error: 'La contraseña debe contener al menos un símbolo' });
            }

            // Verificar que el email no exista ya
            const existingUser = USERS_DATABASE.find(u => u.email.toLowerCase() === email.toLowerCase());
            if (existingUser) {
                return res.status(400).json({ error: 'Ya existe un usuario con ese email' });
            }

            // Hashear la contraseña (bcrypt con salt rounds = 12)
            const hashedPassword = await bcrypt.hash(password, 12);

            // Generar nuevo ID
            const maxId = USERS_DATABASE.length > 0
                ? Math.max(...USERS_DATABASE.map(u => u.id))
                : 0;

            const newUser = {
                id: maxId + 1,
                email: email.toLowerCase(),
                password: hashedPassword,
                firstName,
                lastName,
                role: role || 'user',
                institution: institution || ''
            };

            USERS_DATABASE.push(newUser);
            saveUsers();

            console.log(`[ADMIN] Nuevo usuario creado: ID ${newUser.id} por admin ID ${req.user.id}`);

            const { password: _, ...userWithoutPassword } = newUser;
            res.status(201).json(userWithoutPassword);
        } catch (error) {
            console.error('[ADMIN] Error creando usuario:', error.message);
            res.status(500).json({ error: 'Error interno del servidor' });
        }
    });

    // Actualizar usuario
    router.put('/api/users/:id', requireServerAuth, requireAdminRole, async (req, res) => {
        try {
            const userId = parseInt(req.params.id);
            const { email, password, firstName, lastName, role, institution } = req.body;

            const userIndex = USERS_DATABASE.findIndex(u => u.id === userId);
            if (userIndex === -1) {
                return res.status(404).json({ error: 'Usuario no encontrado' });
            }

            // Actualizar campos
            if (email) USERS_DATABASE[userIndex].email = email.toLowerCase();
            if (firstName) USERS_DATABASE[userIndex].firstName = firstName;
            if (lastName) USERS_DATABASE[userIndex].lastName = lastName;
            if (role) USERS_DATABASE[userIndex].role = role;
            if (institution !== undefined) USERS_DATABASE[userIndex].institution = institution;

            // Actualizar contraseña solo si se proporciona una nueva
            if (password) {
                if (password.length < 8) {
                    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
                }
                if (!/\d/.test(password)) {
                    return res.status(400).json({ error: 'La contraseña debe contener al menos un número' });
                }
                if (!/[^a-zA-Z0-9\sñÑáéíóúÁÉÍÓÚ]/.test(password)) {
                    return res.status(400).json({ error: 'La contraseña debe contener al menos un símbolo' });
                }

                USERS_DATABASE[userIndex].password = await bcrypt.hash(password, 12);
                // Invalidar sesiones del usuario al cambiar contraseña
                invalidateUserSessions(userId);
            }

            saveUsers();
            console.log(`[ADMIN] Usuario actualizado: ID ${userId} por admin ID ${req.user.id}`);

            const { password: _, ...userWithoutPassword } = USERS_DATABASE[userIndex];
            res.json(userWithoutPassword);

        } catch (error) {
            console.error('[ADMIN] Error actualizando usuario:', error.message);
            res.status(500).json({ error: 'Error interno del servidor' });
        }
    });

    // Eliminar usuario
    router.delete('/api/users/:id', requireServerAuth, requireAdminRole, (req, res) => {
        try {
            const userId = parseInt(req.params.id);

            // Prevenir auto-eliminación
            if (req.user.id === userId) {
                return res.status(400).json({ error: 'No puedes eliminarte a ti mismo' });
            }

            const userIndex = USERS_DATABASE.findIndex(u => u.id === userId);
            if (userIndex === -1) {
                return res.status(404).json({ error: 'Usuario no encontrado' });
            }

            // Invalidar sesiones del usuario eliminado
            invalidateUserSessions(userId);

            const deletedUser = USERS_DATABASE.splice(userIndex, 1)[0];
            saveUsers();

            console.log(`[ADMIN] Usuario eliminado: ID ${userId} por admin ID ${req.user.id}`);
            res.json({ message: 'Usuario eliminado correctamente' });
        } catch (error) {
            console.error('[ADMIN] Error eliminando usuario:', error.message);
            res.status(500).json({ error: 'Error interno del servidor' });
        }
    });

    // ==========================================
    // USER PROFILE ENDPOINTS (autenticación requerida)
    // ==========================================

    // Obtener datos del usuario autenticado
    router.get('/api/auth/me', requireServerAuth, (req, res) => {
        const { password, expiry, ...userWithoutSensitiveData } = req.user;
        res.json(userWithoutSensitiveData);
    });

    // Obtener perfil del usuario autenticado (PROTEGIDO - antes era legacy sin auth)
    router.get('/api/user/profile', requireServerAuth, (req, res) => {
        try {
            // Usar el usuario de la sesión, NO del query param
            const user = USERS_DATABASE.find(u => u.id === req.user.id);

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'Usuario no encontrado'
                });
            }

            const { password, ...userProfile } = user;

            res.json({
                success: true,
                user: userProfile
            });

        } catch (error) {
            console.error('[API] Error al obtener perfil:', error.message);
            res.status(500).json({
                success: false,
                message: 'Error al obtener perfil'
            });
        }
    });

    // Actualizar perfil del usuario autenticado (PROTEGIDO)
    router.put('/api/user/profile', requireServerAuth, (req, res) => {
        try {
            // Usar el ID del usuario autenticado, NO del body
            const userId = req.user.id;
            const { firstName, lastName } = req.body;

            const userIndex = USERS_DATABASE.findIndex(u => u.id === userId);

            if (userIndex === -1) {
                return res.status(404).json({
                    success: false,
                    message: 'Usuario no encontrado'
                });
            }

            if (firstName) USERS_DATABASE[userIndex].firstName = firstName.trim();
            if (lastName) USERS_DATABASE[userIndex].lastName = lastName.trim();

            saveUsers();

            const user = USERS_DATABASE[userIndex];

            // Actualizar sesión activa con los nuevos datos
            const token = req.cookies ? req.cookies.auth_token : null;
            if (token && ACTIVE_SESSIONS.has(token)) {
                const session = ACTIVE_SESSIONS.get(token);
                if (session.id === userId) {
                    session.firstName = firstName ? firstName.trim() : session.firstName;
                    session.lastName = lastName ? lastName.trim() : session.lastName;
                    ACTIVE_SESSIONS.set(token, session);
                }
            }

            res.json({
                success: true,
                message: 'Perfil actualizado correctamente',
                user: {
                    id: user.id,
                    email: user.email,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    role: user.role,
                    institution: user.institution
                }
            });

        } catch (error) {
            console.error('[API] Error actualizando perfil:', error.message);
            res.status(500).json({ success: false, message: 'Error al actualizar perfil' });
        }
    });

    // Cambiar contraseña del usuario autenticado (PROTEGIDO)
    router.put('/api/user/change-password', requireServerAuth, async (req, res) => {
        try {
            // Usar el ID del usuario autenticado, NO del body
            const userId = req.user.id;
            const { currentPassword, newPassword } = req.body;

            if (!currentPassword || !newPassword) {
                return res.status(400).json({
                    success: false,
                    message: 'Contraseña actual y nueva son requeridas'
                });
            }

            // Validar nueva contraseña
            if (newPassword.length < 8) {
                return res.status(400).json({
                    success: false,
                    message: 'La nueva contraseña debe tener al menos 8 caracteres'
                });
            }
            if (!/\d/.test(newPassword)) {
                return res.status(400).json({
                    success: false,
                    message: 'La nueva contraseña debe contener al menos un número'
                });
            }
            if (!/[^a-zA-Z0-9\sñÑáéíóúÁÉÍÓÚ]/.test(newPassword)) {
                return res.status(400).json({
                    success: false,
                    message: 'La nueva contraseña debe contener al menos un símbolo'
                });
            }

            const userIndex = USERS_DATABASE.findIndex(u => u.id === userId);
            if (userIndex === -1) {
                return res.status(404).json({
                    success: false,
                    message: 'Usuario no encontrado'
                });
            }

            const user = USERS_DATABASE[userIndex];

            // Verificar contraseña actual
            const passwordMatch = await bcrypt.compare(currentPassword, user.password);
            if (!passwordMatch) {
                return res.status(400).json({
                    success: false,
                    message: 'La contraseña actual es incorrecta'
                });
            }

            // Hashear nueva contraseña (bcrypt salt rounds = 12)
            const hashedPassword = await bcrypt.hash(newPassword, 12);
            USERS_DATABASE[userIndex].password = hashedPassword;
            saveUsers();

            // Invalidar TODAS las sesiones del usuario (forzar re-login)
            invalidateUserSessions(userId);

            logAuditEvent(AUDIT_EVENTS.PASSWORD_CHANGED, {
                email: user.email,
                req,
                reason: 'Cambio voluntario de contraseña'
            });

            res.json({
                success: true,
                message: 'Contraseña actualizada. Se ha cerrado la sesión por seguridad.'
            });

        } catch (error) {
            console.error('[API] Error cambiando contraseña:', error.message);
            res.status(500).json({ success: false, message: 'Error al cambiar contraseña' });
        }
    });

    return router;
};
