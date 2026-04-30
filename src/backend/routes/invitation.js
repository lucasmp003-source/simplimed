const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();

module.exports = function (deps) {
    const { requireServerAuth, requireAdminRole } = deps.authMiddleware;
    const { USERS_DATABASE, saveUsers } = deps.userDatabase;
    const { pendingInvitations, generateInvitationToken, sendInvitationEmail } = deps.emailService;

    // Admin sends invitation to a user
    router.post('/api/admin/invite', requireServerAuth, requireAdminRole, async (req, res) => {
        try {
            const { email, role, institution } = req.body;

            if (!email || !role) {
                return res.status(400).json({
                    success: false,
                    message: 'Email y rol son requeridos'
                });
            }

            // Check if user already exists
            const existingUser = USERS_DATABASE.find(u => u.email.toLowerCase() === email.toLowerCase());
            if (existingUser) {
                return res.status(400).json({
                    success: false,
                    message: 'Ya existe un usuario con este email'
                });
            }

            // Check for existing pending invitation
            for (const [token, inv] of pendingInvitations.entries()) {
                if (inv.email === email.toLowerCase()) {
                    // Remove old invitation
                    pendingInvitations.delete(token);
                    break;
                }
            }

            // Generate invitation token (48 hour expiry)
            const token = generateInvitationToken();
            const expiry = Date.now() + (48 * 60 * 60 * 1000); // 48 hours

            pendingInvitations.set(token, {
                email: email.toLowerCase(),
                role,
                institution: institution || '',
                expiry
            });

            // Send invitation email
            await sendInvitationEmail(email, token, role, institution);

            console.log(`[INVITATION] Invitación enviada a ${email} como ${role}`);

            res.json({
                success: true,
                message: `Invitación enviada a ${email}`
            });

        } catch (error) {
            console.error('Error al enviar invitación:', error);
            res.status(500).json({
                success: false,
                message: 'Error al enviar invitación'
            });
        }
    });

    // Verify invitation token (public endpoint)
    router.get('/api/invitation/:token', (req, res) => {
        const { token } = req.params;

        if (!token) {
            return res.status(400).json({
                valid: false,
                message: 'Token requerido'
            });
        }

        const invitation = pendingInvitations.get(token);

        if (!invitation) {
            return res.status(400).json({
                valid: false,
                message: 'Invitación no válida o ya utilizada'
            });
        }

        // Check expiry
        if (Date.now() > invitation.expiry) {
            pendingInvitations.delete(token);
            return res.status(400).json({
                valid: false,
                message: 'La invitación ha expirado'
            });
        }

        // Mask email for security (prevent enumeration/leakage)
        res.json({
            valid: true,
            email: invitation.email,
            role: invitation.role,
            institution: invitation.institution
        });
    });

    // Complete registration (public endpoint)
    router.post('/api/complete-registration', async (req, res) => {
        try {
            const { token, firstName, lastName, password } = req.body;

            if (!token || !firstName || !lastName || !password) {
                return res.status(400).json({
                    success: false,
                    message: 'Todos los campos son requeridos'
                });
            }

            // Strict Input Validation
            if (firstName.length > 50 || lastName.length > 50) {
                return res.status(400).json({ success: false, message: 'Nombre o apellidos demasiado largos' });
            }
            // Allow letters, spaces, accents, hyphens
            const nameRegex = /^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s'-]+$/;
            if (!nameRegex.test(firstName) || !nameRegex.test(lastName)) {
                return res.status(400).json({ success: false, message: 'Nombre o apellidos contienen caracteres inválidos' });
            }

            // Strict Password Validation (Server-side)
            if (password.length < 8) {
                return res.status(400).json({ success: false, message: 'La contraseña debe tener al menos 8 caracteres' });
            }
            if (!/\d/.test(password)) {
                return res.status(400).json({ success: false, message: 'La contraseña debe contener al menos un número' });
            }
            if (!/[^a-zA-Z0-9\sñÑáéíóúÁÉÍÓÚ]/.test(password)) {
                return res.status(400).json({ success: false, message: 'La contraseña debe contener al menos un símbolo' });
            }

            const invitation = pendingInvitations.get(token);

            if (!invitation) {
                return res.status(400).json({
                    success: false,
                    message: 'Invitación no válida o ya utilizada'
                });
            }

            // Check expiry
            if (Date.now() > invitation.expiry) {
                pendingInvitations.delete(token);
                return res.status(400).json({
                    success: false,
                    message: 'La invitación ha expirado'
                });
            }

            // Atomic consumption of token to prevent Replay Attacks / Race Conditions
            // .delete returns true if the element existed and was removed
            if (!pendingInvitations.delete(token)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invitación ya utilizada'
                });
            }

            // Check again if email already exists (defensive programming)
            const existingUser = USERS_DATABASE.find(u => u.email.toLowerCase() === invitation.email.toLowerCase());
            if (existingUser) {
                // Token already consumed above, so we just return error
                return res.status(400).json({
                    success: false,
                    message: 'Ya existe un usuario con este email'
                });
            }

            // Hash password
            const hashedPassword = await bcrypt.hash(password, 10);

            // Generate new ID
            const maxId = USERS_DATABASE.length > 0
                ? Math.max(...USERS_DATABASE.map(u => u.id))
                : 0;

            // Create user
            const newUser = {
                id: maxId + 1,
                email: invitation.email,
                password: hashedPassword,
                firstName: firstName.trim(),
                lastName: lastName.trim(),
                role: invitation.role,
                institution: invitation.institution
            };

            USERS_DATABASE.push(newUser);
            saveUsers();

            console.log(`[REGISTRATION] Usuario registrado: ${newUser.email} (${newUser.role})`);

            res.json({
                success: true,
                message: 'Cuenta creada correctamente. Ya puedes iniciar sesión.'
            });

        } catch (error) {
            console.error('Error en complete-registration:', error);
            res.status(500).json({
                success: false,
                message: 'Error al crear la cuenta'
            });
        }
    });

    return router;
};
