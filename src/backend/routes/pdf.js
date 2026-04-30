const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();

module.exports = function (deps) {
    const { generateLatexPdf } = require('../utils/latex_generator');

    const localOutputFolder = path.join(__dirname, '../../data/OutputData');

    // Generate PDF from markdown using LaTeX
    router.post('/api/generate-pdf', async (req, res) => {
        try {
            console.log('[SERVER] Petición recibida en /api/generate-pdf (LaTeX)');
            const { markdown } = req.body;

            if (!markdown || markdown.trim() === '') {
                console.log('[SERVER] Error: markdown vacío');
                return res.status(400).json({ error: 'Markdown vacío' });
            }

            console.log('[SERVER] Iniciando generación PDF LaTeX...');

            // Detectar tipo de informe para nombre de archivo
            const generationMarkers = [
                /Historia Actual/i,
                /Evolución/i,
                /Pruebas Complementarias/i,
                /Procedimientos.*Intervención/i,
                /Juicio Clínico/i,
                /Plan Terapéutico/i
            ];

            let matches = 0;
            for (const marker of generationMarkers) {
                if (markdown.match(marker)) matches++;
            }

            const reportType = matches >= 3 ? 'generation' : 'simplification';
            const filename = reportType === 'generation' ? 'informe_alta.pdf' : 'informe_simplificado.pdf';

            console.log(`[SERVER] Tipo detectado: ${reportType}, nombre archivo: ${filename}`);

            // Generar PDF usando nuestra utilidad LaTeX
            const pdfPath = await generateLatexPdf(markdown);

            console.log('[SERVER] PDF generado exitosamente en:', pdfPath);

            // Enviar el PDF mediante descarga
            res.download(pdfPath, filename, (err) => {
                if (err) {
                    console.error('[SERVER] Error al enviar PDF (res.download):', err);
                    if (!res.headersSent) {
                        res.status(500).json({ error: 'Error durante la descarga del archivo: ' + err.message });
                    }
                } else {
                    console.log('[SERVER] PDF enviado correctamente. Limpiando...');
                    try {
                        const tempDir = path.dirname(pdfPath);
                        if (tempDir.includes('temp_latex_')) {
                            setTimeout(() => {
                                try {
                                    fs.rmSync(tempDir, { recursive: true, force: true });
                                    console.log(`[SERVER] Directorio temporal borrado: ${tempDir}`);
                                } catch (e) {
                                    console.error('[SERVER] Error borrando dir temporal (delayed):', e);
                                }
                            }, 1000);
                        }
                    } catch (cleanupErr) {
                        console.error('[SERVER] Warning: Error logic cleanup:', cleanupErr);
                    }
                }
            });

        } catch (error) {
            console.error('[SERVER] Error en /api/generate-pdf:', error.message);
            console.error('[SERVER] Stack:', error.stack);

            if (!res.headersSent) {
                res.status(500).json({ error: error.message });
            }
        }
    });

    // Transfer generated report to simplification
    router.post('/api/transfer-generation-to-simplification', async (req, res) => {
        try {
            console.log('[SERVER] Petición recibida en /api/transfer-generation-to-simplification');
            const { fileName } = req.body;

            if (!fileName) {
                return res.status(400).json({ error: 'Falta fileName' });
            }

            // Asegurar extensión .md
            const markdownFileName = fileName.endsWith('.md') ? fileName : `${fileName}.md`;
            const markdownPath = path.join(localOutputFolder, markdownFileName);

            if (!fs.existsSync(markdownPath)) {
                console.error(`[SERVER] Archivo no encontrado: ${markdownPath}`);
                return res.status(404).json({ error: 'El archivo generado no existe.' });
            }

            const markdownContent = fs.readFileSync(markdownPath, 'utf-8');

            // Generar PDF usando LaTeX
            console.log('[SERVER] Generando PDF temporal para simplificación...');
            const pdfPath = await generateLatexPdf(markdownContent);

            // Definir nombre de destino en tempUploads
            const timestamp = Date.now();
            const targetFileName = `Simplification_Transfer_${timestamp}.pdf`;
            const targetPath = path.join(path.join(__dirname, '../tempUploads'), targetFileName);

            // Mover archivo
            console.log(`[SERVER] Moviendo PDF a: ${targetPath}`);

            fs.copyFileSync(pdfPath, targetPath);

            // Intentar limpiar carpeta temporal de generación
            try {
                const tempDir = path.dirname(pdfPath);
                if (tempDir.includes('temp_latex_')) {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                }
            } catch (e) {
                console.warn('[SERVER] No se pudo limpiar carpeta temporal:', e.message);
            }

            console.log('[SERVER] Transferencia exitosa.');
            res.json({
                success: true,
                redirectFileName: targetFileName
            });

        } catch (error) {
            console.error('[SERVER] Error transfiriendo a simplificación:', error);
            res.status(500).json({ error: 'Error interno durante la transferencia.' });
        }
    });

    return router;
};
