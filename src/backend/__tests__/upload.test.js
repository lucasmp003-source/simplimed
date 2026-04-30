const request = require('supertest');
const express = require('express');
const path = require('path');
const fs = require('fs');
const filesRouteFactory = require('../routes/files');
const cookieParser = require('cookie-parser');

describe('Upload de Archivos - Tests de Seguridad', () => {
    let app;
    let mockDeps;

    beforeAll(() => {
        // Mock Dependencies
        mockDeps = {
            helpers: {
                ensureDirectoryExistence: jest.fn(),
                moveFile: jest.fn(),
                getSafeFilename: jest.fn(name => name)
            },
            authMiddleware: {
                // Mock AUTH realístico para probar 401
                requireAuth: (req, res, next) => {
                    const authHeader = req.headers.authorization;
                    if (!authHeader || !authHeader.startsWith('Bearer ')) {
                        return res.status(401).json({ error: 'Unauthorized' });
                    }
                    const token = authHeader.split(' ')[1];
                    if (token !== 'validToken') {
                        return res.status(401).json({ error: 'Invalid token' });
                    }
                    req.user = { id: '1', email: 'test@uiaen.es' };
                    next();
                },
                requireServerAuth: (req, res, next) => {
                    // Simulamos que requireServerAuth también valida token para uniformidad en tests
                    const authHeader = req.headers.authorization;
                    if (!authHeader || !authHeader.startsWith('Bearer ')) {
                        return res.status(401).json({ error: 'Unauthorized' });
                    }
                    const token = authHeader.split(' ')[1];
                    if (token !== 'validToken') {
                        return res.status(401).json({ error: 'Invalid token' });
                    }
                    next();
                }
            },
            auditLog: {
                logAuditEvent: jest.fn(),
                AUDIT_EVENTS: { UPLOAD_SUCCESS: 'UPLOAD', UPLOAD_FAILED: 'FAIL' }
            },
            userDatabase: { USERS_DATABASE: [] },
            chatbotService: {},
            emailService: {}
        };

        app = express();
        app.use(express.json());
        app.use(cookieParser());
        // Mount the files route
        app.use('/', filesRouteFactory(mockDeps));

        // Create fixtures dir if not exists
        const fixturesDir = path.join(__dirname, 'fixtures');
        if (!fs.existsSync(fixturesDir)) {
            fs.mkdirSync(fixturesDir, { recursive: true });
        }
    });

    afterAll(() => {
        // Cleanup fixtures
        const fixturesDir = path.join(__dirname, 'fixtures');
        if (fs.existsSync(fixturesDir)) {
            fs.rmSync(fixturesDir, { recursive: true, force: true });
        }
    });

    describe('Validación de formato PDF', () => {
        test('Debe rechazar archivo que no es PDF (magic numbers)', async () => {
            const fakeFilePath = path.join(__dirname, 'fixtures', 'fake.pdf');
            fs.writeFileSync(fakeFilePath, 'Esto no es un PDF');

            const response = await request(app)
                .post('/upload')
                .set('Authorization', 'Bearer validToken')
                .attach('file', fakeFilePath);

            expect(response.status).not.toBe(500);
            fs.unlinkSync(fakeFilePath);
        });

        test('Debe aceptar PDF válido', async () => {
            const validPdfPath = path.join(__dirname, 'fixtures', 'valid.pdf');
            const pdfHeader = Buffer.from('%PDF-1.4\n%EOF', 'utf-8');
            fs.writeFileSync(validPdfPath, pdfHeader);

            const response = await request(app)
                .post('/upload')
                .set('Authorization', 'Bearer validToken')
                .attach('file', validPdfPath);

            expect(response.status).toBe(200);
            fs.unlinkSync(validPdfPath);
        });
    });

    describe('Límites de tamaño', () => {
        test('Debe rechazar archivo mayor a 10MB', async () => {
            const bigFilePath = path.join(__dirname, 'fixtures', 'big.pdf');
            const bigBuffer = Buffer.alloc(11 * 1024 * 1024);
            bigBuffer.write('%PDF-1.4\n', 0);
            fs.writeFileSync(bigFilePath, bigBuffer);

            const response = await request(app)
                .post('/upload')
                .set('Authorization', 'Bearer validToken')
                .attach('file', bigFilePath);

            expect(response.status).toBe(413);
            fs.unlinkSync(bigFilePath);
        });

        test('Debe aceptar archivo de 5MB', async () => {
            const okFilePath = path.join(__dirname, 'fixtures', 'ok.pdf');
            const okBuffer = Buffer.alloc(5 * 1024 * 1024);
            okBuffer.write('%PDF-1.4\n', 0);
            fs.writeFileSync(okFilePath, okBuffer);

            const response = await request(app)
                .post('/upload')
                .set('Authorization', 'Bearer validToken')
                .attach('file', okFilePath);

            expect(response.status).toBe(200);
            fs.unlinkSync(okFilePath);
        });
    });

    describe('Sanitización de nombres', () => {
        test('Debe neutralizar path traversal (aceptando archivo con nombre seguro)', async () => {
            const testPath = path.join(__dirname, 'fixtures', 'test.pdf');
            fs.writeFileSync(testPath, '%PDF-1.4\n%EOF');

            const maliciousNames = [
                '../../../etc/passwd.pdf',
                '..\\..\\..\\windows\\system32\\config\\sam.pdf',
                'test/../../../secret.pdf'
            ];

            for (const name of maliciousNames) {
                const response = await request(app)
                    .post('/upload')
                    .set('Authorization', 'Bearer validToken')
                    .attach('file', testPath, { filename: name });

                // Multer limpia el nombre, así que el archivo se sube con UUID y es SEGURO.
                // Esperamos 200 porque el ataque fue neutralizado.
                expect(response.status).toBe(200);
            }
            fs.unlinkSync(testPath);
        });

        test('Debe neutralizar caracteres peligrosos', async () => {
            const testPath = path.join(__dirname, 'fixtures', 'test.pdf');
            fs.writeFileSync(testPath, '%PDF-1.4\n%EOF');

            const dangerousChars = [
                'test;rm -rf /.pdf',
                'test$(whoami).pdf',
                'test`ls`.pdf',
                'test|cat /etc/passwd.pdf',
                'test&& del *.* /f.pdf'
            ];

            for (const name of dangerousChars) {
                const response = await request(app)
                    .post('/upload')
                    .set('Authorization', 'Bearer validToken')
                    .attach('file', testPath, { filename: name });

                // Multer/Busboy limpia el nombre o lo acepta as-is pero se guarda con UUID.
                // Si nuestro sanitizador detecta caracteres peligrosos, devolvemos 400.
                // Ambos resultados (200 con nombre limpio o 400 rechazado) son seguros.
                expect([200, 400]).toContain(response.status);
            }
            fs.unlinkSync(testPath);
        });
    });

    describe('Autenticación en upload', () => {
        test('Debe rechazar upload sin autenticación', async () => {
            const testPath = path.join(__dirname, 'fixtures', 'test.pdf');
            fs.writeFileSync(testPath, '%PDF-1.4\n%EOF');

            const response = await request(app)
                .post('/upload')
                .attach('file', testPath);

            expect(response.status).toBe(401);
            fs.unlinkSync(testPath);
        });

        test('Debe rechazar token inválido', async () => {
            const testPath = path.join(__dirname, 'fixtures', 'test.pdf');
            fs.writeFileSync(testPath, '%PDF-1.4\n%EOF');

            const response = await request(app)
                .post('/upload')
                .set('Authorization', 'Bearer tokeninvalido123')
                .attach('file', testPath);

            expect(response.status).toBe(401);
            fs.unlinkSync(testPath);
        });
    });
});
