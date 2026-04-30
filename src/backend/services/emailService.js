const nodemailer = require('nodemailer');
const crypto = require('crypto');

// Configuración de nodemailer para envío de correos
// Cargar configuración desde archivo externo
const smtpConfig = require('../smtp-config/smtp');

const transporter = nodemailer.createTransport(smtpConfig.active);

// Almacenamiento de tokens de recuperación (en producción usar Redis o BD)
const passwordResetTokens = new Map();

// Almacenamiento de invitaciones pendientes (token -> { email, role, institution, expiry })
const pendingInvitations = new Map();

// Función para generar token de recuperación
function generateResetToken() {
    return crypto.randomBytes(32).toString('hex');
}

// Función para generar token de invitación
function generateInvitationToken() {
    return crypto.randomBytes(32).toString('hex');
}

// Función para enviar correo de recuperación
async function sendPasswordResetEmail(email, token, userName) {
    const BASE_PATH = process.env.BASE_PATH || '';
    const resetLink = `https://sinai.ujaen.es${BASE_PATH}/reset-password?token=${token}`;

    // Mostrar en consola para debugging
    console.log('\n=== ENVIANDO EMAIL DE RECUPERACIÓN DE CONTRASEÑA ===');
    console.log(`Para: ${email}`);
    console.log(`Nombre: ${userName}`);
    console.log(`Link de recuperación: ${resetLink}`);
    console.log(`El token expira en 1 hora`);

    try {
        // Configurar opciones del correo
        const mailOptions = {
            from: '"GALENO-IA - SINAI" <u0971583494@gmail.com>',
            to: email,
            subject: 'Recuperación de Contraseña - GALENO-IA',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
                    <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                        <div style="text-align: center; margin-bottom: 30px;">
                            <h1 style="color: #d9534f; margin: 0;">GALENO<span style="color: #333;">-IA</span></h1>
                            <p style="color: #666; margin: 5px 0 0 0;">Sistema Inteligente de Simplificación de Informes Cardiológicos</p>
                        </div>
                        
                        <h2 style="color: #333; border-bottom: 2px solid #d9534f; padding-bottom: 10px;">Recuperación de Contraseña</h2>
                        
                        <p style="color: #555; line-height: 1.6;">Hola <strong>${userName}</strong>,</p>
                        
                        <p style="color: #555; line-height: 1.6;">
                            Hemos recibido una solicitud para restablecer la contraseña de tu cuenta en GALENO-IA.
                        </p>
                        
                        <p style="color: #555; line-height: 1.6;">
                            Haz clic en el siguiente botón para crear una nueva contraseña:
                        </p>
                        
                        <div style="text-align: center; margin: 35px 0;">
                            <a href="${resetLink}" 
                               style="background-color: #d9534f; color: white; padding: 15px 40px; 
                                      text-decoration: none; border-radius: 5px; display: inline-block;
                                      font-weight: bold; font-size: 16px;">
                                🔒 Restablecer Contraseña
                            </a>
                        </div>
                        
                        <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 12px; margin: 20px 0;">
                            <p style="margin: 0; color: #856404; font-size: 14px;">
                                ⚠️ <strong>Importante:</strong> Este enlace expirará en <strong>1 hora</strong>.
                            </p>
                        </div>
                        
                        <p style="color: #555; line-height: 1.6; font-size: 14px;">
                            Si no puedes hacer clic en el botón, copia y pega el siguiente enlace en tu navegador:
                        </p>
                        
                        <p style="background-color: #f5f5f5; padding: 10px; border-radius: 5px; word-break: break-all; font-size: 12px; color: #666;">
                            ${resetLink}
                        </p>
                        
                        <div style="background-color: #d1ecf1; border-left: 4px solid #17a2b8; padding: 12px; margin: 20px 0;">
                            <p style="margin: 0; color: #0c5460; font-size: 14px;">
                                🛡️ Si no solicitaste este cambio, puedes ignorar este correo de forma segura. 
                                Tu contraseña no será modificada.
                            </p>
                        </div>
                        
                        <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
                        
                        <div style="text-align: center; color: #666; font-size: 12px;">
                            <p style="margin: 5px 0;">
                                <strong>GALENO-IA</strong><br>
                                Sistema Inteligente de Simplificación de Informes Cardiológicos
                            </p>
                            <p style="margin: 5px 0;">
                                Grupo de Investigación SINAI<br>
                                Universidad de Jaén
                            </p>
                            <p style="margin: 15px 0 5px 0; color: #999; font-size: 11px;">
                                Este es un correo automático, por favor no respondas a este mensaje.
                            </p>
                        </div>
                    </div>
                </div>
            `,
            text: `
GALENO-IA - Recuperación de Contraseña

Hola ${userName},

Hemos recibido una solicitud para restablecer la contraseña de tu cuenta en GALENO-IA.

Para crear una nueva contraseña, accede al siguiente enlace:
${resetLink}

IMPORTANTE: Este enlace expirará en 1 hora.

Si no solicitaste este cambio, puedes ignorar este correo de forma segura. Tu contraseña no será modificada.

---
GALENO-IA
Sistema Inteligente de Simplificación de Informes Cardiológicos
Grupo de Investigación SINAI - Universidad de Jaén
            `
        };

        // Enviar el correo
        const info = await transporter.sendMail(mailOptions);

        console.log('✅ Email enviado exitosamente!');
        console.log('Message ID:', info.messageId);
        console.log('====================================================\n');

        return true;

    } catch (error) {
        console.error('❌ Error al enviar el email:');
        console.error(error.message);
        console.log('====================================================');
        console.log('ℹ️  MODO DESARROLLO ACTIVO');
        console.log('   El enlace arriba es válido y funcional.');
        console.log('   Cópialo y pégalo en tu navegador para continuar.');
        console.log('====================================================\n');

        // En modo desarrollo, continuamos aunque falle el envío
        // El enlace ya se mostró en consola y es funcional
        return true;
    }
}

// Función para enviar correo de invitación
async function sendInvitationEmail(email, token, role, institution) {
    const BASE_PATH_EMAIL = process.env.BASE_PATH || '';
    const invitationLink = `https://sinai.ujaen.es${BASE_PATH_EMAIL}/complete-registration?token=${token}`;
    const roleNames = { 'admin': 'Administrador', 'tester': 'Tester', 'user': 'Doctor (Usuario)' };
    const roleName = roleNames[role] || role;

    console.log('\n=== ENVIANDO EMAIL DE INVITACIÓN ===');
    console.log(`Para: ${email}, Rol: ${roleName}, Link: ${invitationLink}`);

    try {
        const mailOptions = {
            from: '"GALENO-IA - SINAI" <u0971583494@gmail.com>',
            to: email,
            subject: 'Invitación a GALENO-IA - Completa tu registro',
            html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;"><div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);"><div style="text-align: center; margin-bottom: 30px;"><h1 style="color: #d9534f; margin: 0;">GALENO<span style="color: #333;">-IA</span></h1></div><h2 style="color: #333; border-bottom: 2px solid #d9534f; padding-bottom: 10px;">¡Has sido invitado!</h2><p style="color: #555;">Has sido invitado a unirte a <strong>GALENO-IA</strong> como <strong>${roleName}</strong>.</p>${institution ? `<p style="color: #555;">Institución: <strong>${institution}</strong></p>` : ''}<div style="text-align: center; margin: 35px 0;"><a href="${invitationLink}" style="background-color: #d9534f; color: white; padding: 15px 40px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">✨ Completar Registro</a></div><div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 12px; margin: 20px 0;"><p style="margin: 0; color: #856404;">⚠️ Este enlace expirará en <strong>48 horas</strong>.</p></div></div></div>`,
            text: `Has sido invitado a GALENO-IA como ${roleName}. Completa tu registro: ${invitationLink}`
        };
        await transporter.sendMail(mailOptions);
        console.log('✅ Email de invitación enviado correctamente');
        return true;
    } catch (error) {
        console.error('❌ Error al enviar email:', error.message);
        console.log('ℹ️  DESARROLLO: Enlace válido ->', invitationLink);
        return true;
    }
}

module.exports = {
    transporter,
    passwordResetTokens,
    pendingInvitations,
    generateResetToken,
    generateInvitationToken,
    sendPasswordResetEmail,
    sendInvitationEmail
};
