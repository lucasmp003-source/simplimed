const path = require('path');
const fs = require('fs');

function setupProxyAndMaintenance(app, BASE_PATH) {
    // Middleware para detectar si estamos detrás de un proxy (Apache)
    // y determinar el BASE_PATH correcto
    app.use((req, res, next) => {
        // Debug: mostrar todas las cabeceras en la primera petición HTML
        if (req.path === '/' || req.path === '/login') {
            console.log('[DEBUG] Cabeceras HTTP recibidas:');
            console.log('  X-Forwarded-For:', req.headers['x-forwarded-for']);
            console.log('  X-Forwarded-Proto:', req.headers['x-forwarded-proto']);
            console.log('  X-Forwarded-Host:', req.headers['x-forwarded-host']);
            console.log('  X-Original-URL:', req.headers['x-original-url']);
            console.log('  X-Forwarded-Prefix:', req.headers['x-forwarded-prefix']);
            console.log('  Host:', req.headers['host']);
            console.log('  Origin:', req.headers['origin']);
            console.log('  Referer:', req.headers['referer']);
        }

        // Detectar si venimos de producción (sinai.ujaen.es) o desarrollo (localhost)
        const host = req.headers['x-forwarded-host'] || req.headers['host'] || '';
        const isProduction = host.includes('sinai.ujaen.es');

        // Si estamos en producción, marcar que necesitamos /galeno
        if (isProduction) {
            req.needsGalenoPrefix = true;
        }

        // Si la ruta comienza con /galeno, reescribirla para quitarlo
        // pero guardando la ruta original
        if (req.path.startsWith('/galeno/') || req.path === '/galeno') {
            req.originalPath = req.path; // Guardar ruta original
            req.url = req.url.replace('/galeno', '') || '/';
            req.needsGalenoPrefix = true;
            console.log(`[DEBUG] Normalizando ruta: ${req.originalPath} -> ${req.url}`);
        }

        next();
    });

    // ========== MIDDLEWARE DE MANTENIMIENTO ==========
    // Para activar el modo mantenimiento, establecer MAINTENANCE_MODE=true
    const MAINTENANCE_MODE = process.env.MAINTENANCE_MODE === 'true';
    const maintenancePath = path.join(__dirname, '../../../maintenance.html');

    if (MAINTENANCE_MODE) {
        console.log('⚠️  [MANTENIMIENTO] Modo mantenimiento activado');
        console.log(`📄 [MANTENIMIENTO] Página: ${maintenancePath}`);
        if (fs.existsSync(maintenancePath)) {
            console.log('✅ [MANTENIMIENTO] Archivo maintenance.html encontrado');
        } else {
            console.log('❌ [MANTENIMIENTO] ADVERTENCIA: maintenance.html no encontrado, usando página por defecto');
        }
    }

    app.use((req, res, next) => {
        if (MAINTENANCE_MODE) {
            // Permitir acceso a recursos estáticos de la página de mantenimiento
            if (req.path.includes('.css') || req.path.includes('.js') || req.path.includes('.ico') || req.path.includes('.png') || req.path.includes('.jpg')) {
                return next();
            }

            console.log(`🔧 [MANTENIMIENTO] Bloqueando acceso a: ${req.method} ${req.path}`);

            // Mostrar página de mantenimiento para todas las demás rutas
            if (fs.existsSync(maintenancePath)) {
                return res.status(503).sendFile(maintenancePath);
            } else {
                console.log('⚠️  [MANTENIMIENTO] Usando página de mantenimiento por defecto');
                return res.status(503).send(`
                    <!DOCTYPE html>
                    <html lang="es">
                    <head>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <title>Mantenimiento - SimpliMed</title>
                        <style>
                            body {
                                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                                min-height: 100vh;
                                display: flex;
                                justify-content: center;
                                align-items: center;
                                margin: 0;
                            }
                            .container {
                                background: white;
                                padding: 50px;
                                border-radius: 20px;
                                box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                                text-align: center;
                                max-width: 500px;
                            }
                            h1 { color: #333; margin-bottom: 20px; }
                            p { color: #666; line-height: 1.6; }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <h1>🔧 Sistema en Mantenimiento</h1>
                            <p>Estamos mejorando SimpliMed para ofrecerte una mejor experiencia.</p>
                            <p>Volveremos pronto. Gracias por tu paciencia.</p>
                        </div>
                    </body>
                    </html>
                `);
            }
        }
        next();
    });
    // ================================================

    // Middleware de debug para ver qué rutas llegan
    app.use((req, res, next) => {
        if (req.path.includes('css') || req.path.includes('js') || req.path.includes('images')) {
            console.log(`[DEBUG] Petición estática: ${req.method} ${req.path} | BASE_PATH='${BASE_PATH}'`);
        }

        // Capturar respuesta para logging
        const originalSend = res.send;
        res.send = function (data) {
            if (req.path.includes('.js')) {
                console.log(`[DEBUG] Respondiendo ${req.path} con Content-Type: ${res.getHeader('Content-Type')} | Status: ${res.statusCode}`);
            }
            originalSend.call(this, data);
        };

        next();
    });
}

module.exports = { setupProxyAndMaintenance };
