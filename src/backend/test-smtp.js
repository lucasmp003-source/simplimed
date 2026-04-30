/**
 * Script de prueba para verificar la conexión SMTP
 * GALENO-IA - Test de envío de correo
 */

const nodemailer = require('nodemailer');

// Configuración del transportador (igual que en api.js)
const transporter = nodemailer.createTransport({
    host: 'smtp.ujaen.es',
    port: 587,
    secure: false,
    auth: {
        user: 'lmolino@ujaen.es',
        pass: '$dezaWe68'
    },
    tls: {
        rejectUnauthorized: false
    }
});

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║  GALENO-IA - Test de Conexión SMTP                        ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

console.log('📧 Configuración SMTP:');
console.log('   Servidor: smtp.ujaen.es');
console.log('   Puerto: 587');
console.log('   Usuario: lmolino@ujaen.es');
console.log('   Seguridad: STARTTLS\n');

console.log('🔄 Verificando conexión...\n');

// Verificar la conexión
transporter.verify(function(error, success) {
    if (error) {
        console.log('❌ ERROR de conexión:');
        console.log('   ' + error.message);
        console.log('\n⚠️  Posibles soluciones:');
        console.log('   1. Verifica que la contraseña sea correcta');
        console.log('   2. El servidor SMTP podría ser diferente (ej: correo.ujaen.es)');
        console.log('   3. Verifica conexión a internet');
        console.log('   4. El puerto 587 debe estar abierto en el firewall\n');
        
        console.log('💡 Servidores SMTP alternativos para probar:');
        console.log('   - correo.ujaen.es');
        console.log('   - mail.ujaen.es');
        console.log('   - smtp.gmail.com (si configuras la cuenta)\n');
        
        process.exit(1);
    } else {
        console.log('✅ Conexión SMTP exitosa!\n');
        console.log('📨 Enviando correo de prueba...\n');
        
        // Enviar correo de prueba
        const mailOptions = {
            from: '"GALENO-IA - SINAI" <lmolino@ujaen.es>',
            to: 'lmolino@ujaen.es',
            subject: '✅ Test SMTP - GALENO-IA',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <h2 style="color: #d9534f;">✅ Conexión SMTP Exitosa</h2>
                    <p>Este es un correo de prueba del sistema GALENO-IA.</p>
                    <p>La configuración SMTP está funcionando correctamente.</p>
                    <hr>
                    <p style="color: #666; font-size: 12px;">
                        GALENO-IA - Sistema Inteligente de Simplificación de Informes Cardiológicos<br>
                        SINAI - Universidad de Jaén
                    </p>
                </div>
            `,
            text: 'Conexión SMTP exitosa! La configuración está funcionando correctamente.\n\nGALENO-IA - SINAI - Universidad de Jaén'
        };
        
        transporter.sendMail(mailOptions, function(error, info) {
            if (error) {
                console.log('❌ Error al enviar el correo:');
                console.log('   ' + error.message + '\n');
                process.exit(1);
            } else {
                console.log('✅ ¡Correo de prueba enviado exitosamente!');
                console.log('   Message ID: ' + info.messageId);
                console.log('   Destinatario: lmolino@ujaen.es\n');
                console.log('📬 Revisa tu bandeja de entrada (o spam) para confirmar.\n');
                console.log('════════════════════════════════════════════════════════════');
                console.log('🎉 ¡Todo está listo! El sistema de recuperación de');
                console.log('   contraseña por email está completamente funcional.');
                console.log('════════════════════════════════════════════════════════════\n');
                process.exit(0);
            }
        });
    }
});


