const express = require('express');
const path = require('path');
const fs = require('fs');
const { getCsrfToken } = require('../middleware/csrf');

module.exports = function (app, deps) {
    const { requireServerAuth, requireMetricsRole, requireAdminRole, requireDoctorOrAdminRole, passiveSessionCheck } = deps.authMiddleware;
    const BASE_PATH = deps.BASE_PATH;

    // Servir configuración del base path como JavaScript
    app.get('/config.js', (req, res) => {
        const basePath = req.needsGalenoPrefix ? '/galeno' : (BASE_PATH || '');

        console.log(`[DEBUG] Sirviendo config.js con BASE_PATH='${basePath}' (needsGalenoPrefix: ${req.needsGalenoPrefix})`);

        res.setHeader('Content-Type', 'application/javascript');
        res.send(`window.BASE_PATH = '${basePath}';`);
    });

    // Opciones para express.static con tipos MIME correctos
    const staticOptions = {
        setHeaders: (res, filePath) => {
            if (filePath.endsWith('.js')) {
                res.setHeader('Content-Type', 'application/javascript; charset=UTF-8');
            } else if (filePath.endsWith('.css')) {
                res.setHeader('Content-Type', 'text/css; charset=UTF-8');
            }
        }
    };

    // Archivos estáticos
    app.use('/public/css', express.static(path.join(__dirname, '../../frontend/css'), staticOptions));
    app.use('/public/js', express.static(path.join(__dirname, '../../frontend/js'), staticOptions));
    app.use('/public/images', express.static(path.join(__dirname, '../../frontend/images')));
    app.use('/frontend/css', express.static(path.join(__dirname, '../../frontend/css'), staticOptions));
    app.use('/frontend/js', express.static(path.join(__dirname, '../../frontend/js'), staticOptions));
    app.use('/frontend/images', express.static(path.join(__dirname, '../../frontend/images')));

    // Metrics Dashboard (web component)
    app.use('/metrics', requireServerAuth, requireMetricsRole, express.static(path.join(__dirname, '../../frontend/metrics')));

    // Data static serving
    app.use('/ProductionData', express.static(path.join(__dirname, '../../data/ProductionData')));
    app.use('/data/ProductionData', express.static(path.join(__dirname, '../../data/ProductionData')));
    app.use('/data/OutputData', express.static(path.join(__dirname, '../../data/OutputData')));
    app.use('/tempUploads', express.static(path.join(__dirname, '../tempUploads')));

    // Helper para servir HTML con BASE_PATH inyectado
    function serveHtmlWithBasePath(filePath) {
        return (req, res) => {
            fs.readFile(filePath, 'utf8', (err, html) => {
                if (err) {
                    res.status(500).send('Error al cargar la página');
                    return;
                }

                // Determinar el BASE_PATH correcto basado en la detección de producción
                let baseTag;
                let basePath;

                if (req.needsGalenoPrefix) {
                    basePath = '/galeno';
                    baseTag = '<base href="/galeno/">';
                } else if (BASE_PATH) {
                    basePath = BASE_PATH;
                    baseTag = `<base href="${BASE_PATH}/">`;
                } else {
                    basePath = '/';
                    baseTag = '<base href="/">';
                }

                console.log(`[DEBUG] Sirviendo HTML con BASE_PATH ${basePath} para: ${req.path} (needsGalenoPrefix: ${req.needsGalenoPrefix})`);

                let modifiedHtml = html.replace('<!-- BASE_PLACEHOLDER -->', baseTag);

                // Inject shared footer from partial
                const footerPath = path.join(__dirname, '../../frontend/views/partials/footer.html');
                try {
                    const footerHtml = fs.readFileSync(footerPath, 'utf8');
                    modifiedHtml = modifiedHtml.replace('<!-- FOOTER_PLACEHOLDER -->', footerHtml);
                } catch (e) {
                    console.error('[WARN] Could not load footer partial:', e.message);
                }

                // Inject shared header from partial
                const headerPath = path.join(__dirname, '../../frontend/views/partials/header.html');
                try {
                    const headerHtml = fs.readFileSync(headerPath, 'utf8');
                    modifiedHtml = modifiedHtml.replace('<!-- HEADER_PLACEHOLDER -->', headerHtml);
                } catch (e) {
                    console.error('[WARN] Could not load header partial:', e.message);
                }

                // Inyección de token CSRF como meta tag
                const csrfToken = getCsrfToken(req);
                const csrfMeta = `<meta name="csrf-token" content="${csrfToken}">`;
                modifiedHtml = modifiedHtml.replace('</head>', `${csrfMeta}\n</head>`);

                // Inyección de datos mínimos del usuario (OWASP: minimizar exposición)
                // Solo firstName y role — nunca email, lastName, institution ni id
                if (req.user) {
                    const userMinimal = JSON.stringify({
                        firstName: req.user.firstName,
                        role: req.user.role
                    });
                    // Inyección segura: IIFE que expone un getter de un solo uso
                    // El dato se guarda en una variable local del closure, no en window.
                    const injection = `
                    <script>
                    (function() {
                        var _initData = ${userMinimal};
                        window.__GET_GALENO_INIT__ = function() {
                            var data = _initData;
                            _initData = null; // Borrar referencia interna
                            delete window.__GET_GALENO_INIT__; // Borrar el getter global
                            return data;
                        };
                    })();
                    </script>`;
                    modifiedHtml = modifiedHtml.replace('</head>', `${injection}\n</head>`);
                }

                res.send(modifiedHtml);
            });
        };
    }

    const viewsDir = path.join(__dirname, '../../frontend/views');

    // Rutas HTML - Gracias al middleware de normalización, solo necesitamos definirlas sin /galeno
    app.get('/', requireServerAuth, serveHtmlWithBasePath(path.join(viewsDir, 'index.html')));
    app.get('/simplificar', requireServerAuth, serveHtmlWithBasePath(path.join(viewsDir, 'simplificar.html')));
    app.get('/generar', requireServerAuth, serveHtmlWithBasePath(path.join(viewsDir, 'generar.html')));
    app.get('/login', serveHtmlWithBasePath(path.join(viewsDir, 'login.html')));
    app.get('/forgot-password', serveHtmlWithBasePath(path.join(viewsDir, 'forgot-password.html')));
    app.get('/reset-password', serveHtmlWithBasePath(path.join(viewsDir, 'reset-password.html')));
    app.get('/complete-registration', serveHtmlWithBasePath(path.join(viewsDir, 'complete-registration.html')));
    app.get('/account', requireServerAuth, serveHtmlWithBasePath(path.join(viewsDir, 'account.html')));
    app.get('/annotation', requireServerAuth, requireDoctorOrAdminRole, serveHtmlWithBasePath(path.join(viewsDir, 'annotation.html')));
    app.get('/performance', requireServerAuth, serveHtmlWithBasePath(path.join(viewsDir, 'performance.html')));
    app.get('/preview-simplificar', requireServerAuth, serveHtmlWithBasePath(path.join(viewsDir, 'preview-simplificar.html')));
    app.get('/preview-generar', requireServerAuth, serveHtmlWithBasePath(path.join(viewsDir, 'preview-generar.html')));

    // Rutas legales
    app.get('/privacidad', passiveSessionCheck, serveHtmlWithBasePath(path.join(viewsDir, 'privacidad.html')));
    app.get('/terminos', passiveSessionCheck, serveHtmlWithBasePath(path.join(viewsDir, 'terminos.html')));
    app.get('/aviso-legal', passiveSessionCheck, serveHtmlWithBasePath(path.join(viewsDir, 'aviso-legal.html')));

    // Serve Admin Dashboard (Protected)
    app.get('/admin', requireServerAuth, requireAdminRole, serveHtmlWithBasePath(path.join(viewsDir, 'admin.html')));
};
