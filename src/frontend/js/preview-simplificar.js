document.addEventListener("DOMContentLoaded", () => {
    const pdfCanvasContainer = document.getElementById("pdf-canvas-container");
    const outputPlaceholder = document.getElementById("output-placeholder");
    const outputContent = document.getElementById("output-content");
    const generateBtn = document.getElementById("generate-btn");
    const downloadBtn = document.getElementById("download-btn");
    const uploadedPdfPath = new URLSearchParams(window.location.search).get('fileName');

    const eventsUrl = window.urlHelper.buildUrl(`/events?clientId=${encodeURIComponent(uploadedPdfPath)}`);
    let eventSource = new EventSource(eventsUrl);

    // Variables para el manejo de chunks
    let accumulatedChunks = "";
    let firstChunkReceived = false;
    let simplificationCompleted = false;
    let lastProgressTime = Date.now();
    let hideLogsTimeout = null;

    // Variables para el renderizado optimizado
    let renderTimeout = null;
    let pendingRender = false;

    // Función para cerrar EventSource de forma segura
    function closeEventSource() {
        if (eventSource && eventSource.readyState !== EventSource.CLOSED) {
            console.log('[FRONTEND] Cerrando conexión SSE...');
            eventSource.close();
            eventSource = null;
        }
    }

    const logWidget = document.getElementById('log-widget');
    const logToggle = document.getElementById('log-toggle');
    const logStatusText = document.getElementById('log-status-text');
    const logBody = document.getElementById('progress-logs');

    // Toggle de logs
    if (logToggle && logWidget) {
        logToggle.addEventListener('click', () => {
            logWidget.classList.toggle('collapsed');
        });
    }

    // Función para agregar un log al contenedor de progreso
    function addProgressLog(message, type = 'info') {
        if (!logBody || !logWidget) {
            console.warn('[FRONTEND] Widget de logs no encontrado');
            return;
        }

        // Mostrar el widget si no está visible
        if (logWidget.style.display === 'none') {
            logWidget.style.display = 'block';
        }

        const logEntry = document.createElement('div');
        logEntry.className = `log-entry ${type}`;

        const timestamp = new Date().toLocaleTimeString('es-ES', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        // Iconos según tipo
        let icon = 'ℹ️';
        if (type === 'success') icon = '✅';
        if (type === 'warning') icon = '⚠️';
        if (type === 'error') icon = '❌';

        logEntry.innerHTML = `
            <span class="log-timestamp">[${timestamp}]</span>
            <span class="log-message">${message}</span>
        `;

        logBody.appendChild(logEntry);

        // Auto-scroll hacia abajo
        logBody.scrollTop = logBody.scrollHeight;

        // Actualizar status en header (opcional, solo el último mensaje interesante)
        if (logStatusText && type !== 'info') {
            // Cortar si es muy largo
            logStatusText.textContent = message; // Mostrar mensaje completo
        }

        console.log(`[FRONTEND] Log agregado: ${message} (tipo: ${type})`);
    }

    // Función optimizada para renderizar el contenido INMEDIATAMENTE
    function renderContent() {
        if (!accumulatedChunks) return;

        // Limpiar saltos de línea excesivos
        const cleanedContent = accumulatedChunks.replace(/\n{3,}/g, "\n\n").trim();

        // Convertir a HTML directamente
        const htmlContent = markdown.toHTML(cleanedContent);

        // Actualizar el contenido INMEDIATAMENTE
        outputContent.innerHTML = htmlContent;

        // Mostrar contenido si está oculto
        outputContent.style.display = 'block';

        // Aplicar estilos sin animaciones
        const markdownElements = outputContent.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, ul, ol, code, pre');
        markdownElements.forEach((element) => {
            element.classList.add('markdown-text');
            element.style.color = '#333';
        });

        // Auto-scroll suave al final del contenido
        outputContent.scrollTop = outputContent.scrollHeight;

        pendingRender = false;
    }

    // Exponer función de recarga para el Chatbot
    window.refreshPreview = async () => {
        if (!uploadedPdfPath) return;
        const mdFileName = uploadedPdfPath.replace('.pdf', '.md');
        const url = window.urlHelper.buildUrl(`/data/OutputData/${mdFileName}?t=${Date.now()}`);

        try {
            console.log('[FRONTEND] Recargando contenido desde:', url);
            const response = await fetch(url);
            if (!response.ok) throw new Error('Error al obtener archivo actualizado');
            const text = await response.text();

            // Actualizar contenido y renderizar
            accumulatedChunks = text;
            renderContent();
            addProgressLog('🔄 Informe actualizado con las correcciones.', 'success');
        } catch (e) {
            console.error('[FRONTEND] Error refrescando vista:', e);
            addProgressLog('Error al actualizar la vista previa.', 'warning');
        }
    };

    // Función para programar un renderizado (debounce optimizado)
    function scheduleRender() {
        // Si ya hay un render pendiente, no hacer nada
        if (pendingRender) return;

        pendingRender = true;

        // Cancelar cualquier timeout previo
        if (renderTimeout) {
            clearTimeout(renderTimeout);
        }

        // Renderizar después de un pequeño delay para agrupar chunks
        // Usamos requestAnimationFrame para mejor performance
        renderTimeout = setTimeout(() => {
            requestAnimationFrame(renderContent);
        }, 50); // 50ms es suficiente para agrupar varios chunks sin parecer lento
    }

    // Escuchar los mensajes del servidor
    eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log('[FRONTEND] Evento SSE recibido:', data.type);

        if (data.type === 'progress') {
            // Mensaje de progreso
            console.log('[FRONTEND] Progreso:', data.message);
            addProgressLog(data.message, data.logType || 'info');

            lastProgressTime = Date.now();

            // Cancelar timeout de ocultación
            if (hideLogsTimeout) {
                clearTimeout(hideLogsTimeout);
                hideLogsTimeout = null;
            }

        } else if (data.type === 'fileChunk') {
            if (!firstChunkReceived) {
                // Cambiar mensaje de loading main (opcional, ahora está minimizado)
                const loadingMessage = document.getElementById('loading-message');
                if (loadingMessage) {
                    loadingMessage.textContent = "📝 Escribiendo el informe...";
                }

                // Actualizar estado widget
                if (logStatusText) logStatusText.textContent = "📝 Escribiendo...";

                addProgressLog('✍️ Comenzando a escribir...', 'info');
                console.log('[FRONTEND] Primer chunk recibido, colapsando logs y renderizando');

                // AUTO-COLLAPSE LOGS
                if (logWidget) {
                    logWidget.classList.add('collapsed');
                }

                firstChunkReceived = true;
            }

            // Acumular chunks
            accumulatedChunks += data.chunk;

            // Programar renderizado optimizado
            scheduleRender();

        } else if (data.type === 'completed') {
            console.log('[FRONTEND] Simplificación completada');

            simplificationCompleted = true;

            // Renderizar cualquier contenido pendiente INMEDIATAMENTE
            if (renderTimeout) {
                clearTimeout(renderTimeout);
            }
            renderContent();

            // Agregar log final
            addProgressLog('🎉 Completado.', 'success');
            if (logStatusText) logStatusText.textContent = "✅ Finalizado";

            // Cerrar SSE
            closeEventSource();

            // Esperar 3 segundos y ocultar loading/logs
            setTimeout(() => {
                const loadingIndicator = document.getElementById('loading-indicator');
                const loadingMessage = document.getElementById('loading-message');
                // const progressLogs = document.getElementById('progress-logs'); // Ahora es logBody

                if (loadingIndicator) loadingIndicator.style.display = "none";
                if (loadingMessage) loadingMessage.style.display = "none";

                // Ocultar completamente el widget de logs con animación
                if (logWidget) {
                    logWidget.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
                    logWidget.style.opacity = '0';
                    logWidget.style.transform = 'translateY(20px)';
                    setTimeout(() => {
                        logWidget.style.display = 'none';
                        // Resetear estilos para la próxima vez
                        logWidget.style.opacity = '1';
                        logWidget.style.transform = 'none';
                    }, 500);
                }
            }, 3000);

            // Habilitar botón de descarga
            if (downloadBtn) {
                downloadBtn.disabled = false;
                downloadBtn.title = "Descargar informe simplificado en PDF";
                downloadBtn.style.backgroundColor = '#28a745';
                downloadBtn.style.cursor = 'pointer';
                downloadBtn.style.opacity = '0.9';
            }

            // Mostrar botones flotantes
            const floatingButtons = document.getElementById('floating-buttons');
            if (floatingButtons) {
                floatingButtons.style.display = 'flex';
            }

            // Activar modo edición y mostrar chatbot
            window.isEditingMode = true;
            const chatbotInterface = document.getElementById('chatbot-interface');
            if (chatbotInterface) {
                chatbotInterface.style.display = 'block';
                // Animación de entrada
                chatbotInterface.style.opacity = '0';
                setTimeout(() => {
                    chatbotInterface.style.transition = 'opacity 0.5s ease';
                    chatbotInterface.style.opacity = '1';
                }, 100);
            }
        }
    };

    // Manejo de errores de SSE
    eventSource.onerror = (error) => {
        if (simplificationCompleted) {
            console.log('[FRONTEND] Error SSE ignorado (simplificación completada)');
            closeEventSource();
            return;
        }

        console.error('[FRONTEND] Error en la conexión SSE:', error);

        if (eventSource.readyState === EventSource.CLOSED) {
            console.warn('[FRONTEND] Conexión SSE cerrada inesperadamente');
            alert('Se perdió la conexión con el servidor. Por favor, recarga la página.');
        }
    };

    // Detectar cuando el usuario abandone la página
    // SOLO notificar si la simplificación ya completó, para no borrar archivos al recargar
    if (uploadedPdfPath) {
        window.addEventListener("beforeunload", (e) => {
            console.log('[FRONTEND] Cliente abandonando la página.');

            closeEventSource();

            // Solo limpiar archivos si la simplificación ya completó
            // Si está en progreso, no notificar para poder restaurar estado al recargar
            if (!simplificationCompleted) {
                console.log('[FRONTEND] Simplificación en progreso, no se notifica salida para preservar estado.');
                return;
            }

            const payload = JSON.stringify({ fileName: uploadedPdfPath });
            const blob = new Blob([payload], { type: 'application/json' });
            const sent = navigator.sendBeacon(
                window.urlHelper.buildUrl('/notifyPreviewExit'),
                blob
            );

            if (!sent) {
                console.warn('[FRONTEND] Beacon falló, intentando fetch...');
                window.urlHelper.fetchWithBasePath('/notifyPreviewExit', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.content
                    },
                    body: payload,
                    keepalive: true
                }).catch(error => console.error('[FRONTEND] Error al notificar:', error));
            }
        });
    }

    // Renderizar el PDF si se ha subido
    if (uploadedPdfPath) {
        const url = window.urlHelper.buildUrl('/tempUploads/' + uploadedPdfPath);

        pdfjsLib.getDocument(url).promise.then((pdfDoc_) => {
            const pdfDoc = pdfDoc_;
            const totalPages = pdfDoc.numPages;

            for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
                pdfDoc.getPage(pageNum).then((page) => {
                    const viewport = page.getViewport({ scale: 1.5 });
                    const canvas = document.createElement("canvas");
                    pdfCanvasContainer.appendChild(canvas);

                    canvas.height = viewport.height;
                    canvas.width = viewport.width;
                    const ctx = canvas.getContext('2d');

                    const renderContext = {
                        canvasContext: ctx,
                        viewport: viewport,
                    };

                    page.render(renderContext);
                });
            }
        }).catch((error) => {
            console.error("[FRONTEND] Error al cargar el PDF:", error);
            alert("No se pudo cargar el archivo PDF.");
        });
    }

    // Botón de generar
    generateBtn.addEventListener("click", () => {
        if (!uploadedPdfPath) {
            alert("Primero sube un archivo.");
            return;
        }

        if (outputPlaceholder) {
            outputPlaceholder.style.display = "none";
        } else {
            generateBtn.style.display = "none";
        }

        // outputContainer.style.display = "block"; // Removed, not needed with new layout
        document.getElementById('loading-indicator').style.display = "block";

        const progressLogs = document.getElementById('progress-logs');
        if (progressLogs) {
            progressLogs.style.display = 'block';
            console.log('[FRONTEND] Contenedor de logs inicializado');
            if (logWidget) logWidget.classList.remove('collapsed'); // Asegurar visibilidad
            addProgressLog('⏳ Esperando inicio del procesamiento...', 'info');
        }

        // Ocultar el textarea de edición si existe (por si el usuario vuelve a generar)
        const editTextareaElem = document.getElementById('edit-textarea');
        if (editTextareaElem) {
            editTextareaElem.style.display = 'none';
        }
        // Ocultar cualquier contenedor de Toast UI Editor existente
        const editorContainer = document.getElementById('editor-container');
        if (editorContainer) {
            editorContainer.style.display = 'none';
        }

        // Resetear botón de edición si existe
        const editToggleBtnElem = document.getElementById('edit-toggle-btn');
        const editToggleTextElem = document.getElementById('edit-toggle-text');
        if (editToggleBtnElem && editToggleTextElem) {
            editToggleTextElem.textContent = 'Editar';
            editToggleBtnElem.style.backgroundColor = '#f0ad4e';
            const svgPath = editToggleBtnElem.querySelector('svg');
            if (svgPath) {
                svgPath.innerHTML = `<path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>`;
            }
        }

        window.urlHelper.fetchWithBasePath('/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.content
            },
            body: JSON.stringify({ fileName: uploadedPdfPath })
        })
            .then(response => {
                console.log('[FRONTEND] Respuesta del servidor:', response);
                return response.json();
            })
            .then(data => {
                console.log('[FRONTEND] Generación iniciada:', data);
            })
            .catch(error => {
                console.error("[FRONTEND] Error al generar:", error);
                alert("Error al iniciar el proceso.");
                closeEventSource();
            });
    });

    // Botón de descarga
    downloadBtn.addEventListener('click', async () => {
        if (!simplificationCompleted) {
            alert('Por favor, espera a que la simplificación concluya.');
            return;
        }

        try {
            downloadBtn.disabled = true;
            downloadBtn.textContent = 'Generando PDF...';

            const markdownContent = accumulatedChunks.replace(/\n{3,}/g, "\n\n").trim();

            if (!markdownContent || markdownContent.trim() === '') {
                alert('No hay contenido para descargar.');
                downloadBtn.disabled = false;
                downloadBtn.textContent = 'Descargar PDF';
                return;
            }

            const response = await window.urlHelper.fetchWithBasePath('/api/generate-pdf', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.content
                },
                body: JSON.stringify({ markdown: markdownContent })
            });

            if (!response.ok) {
                throw new Error(`Error en el servidor: ${response.statusText}`);
            }

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'informe_alta_simplificado.pdf';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);

            console.log('[FRONTEND] PDF descargado correctamente');
        } catch (error) {
            console.error('[FRONTEND] Error al descargar PDF:', error);
            alert('Error al generar el PDF: ' + error.message);
        } finally {
            downloadBtn.disabled = false;
            downloadBtn.textContent = 'Descargar PDF';
        }
    });

    // ==========================================
    // Lógica de Edición con Toggle Button (Toast UI Editor)
    // ==========================================
    const editToggleBtn = document.getElementById('edit-toggle-btn');
    const editToggleText = document.getElementById('edit-toggle-text');
    const editTextarea = document.getElementById('edit-textarea');
    let isEditMode = false;
    let editor = null; // Toast UI Editor instance

    // Función para inicializar el editor (diferida)
    function initializeEditor() {
        if (editor) return;

        // Asegurarse de que el div contenedor exista. Toast UI necesita un div, no un textarea.
        // Vamos a ocultar el textarea original y usar un div nuevo o reutilizar el contenedor.
        // El 'editTextarea' es un <textarea>, ToastUI necesita un <div>.
        // Crearemos un div dinámicamente si no existe.
        let editorDiv = document.getElementById('editor-container');
        if (!editorDiv) {
            editorDiv = document.createElement('div');
            editorDiv.id = 'editor-container';
            editorDiv.style.display = 'none'; // Oculto inicialmente
            // Insertarlo donde está el textarea
            if (editTextarea && editTextarea.parentNode) {
                editTextarea.parentNode.insertBefore(editorDiv, editTextarea);
            }
        }

        const Editor = toastui.Editor;

        editor = new Editor({
            el: document.querySelector('#editor-container'),
            height: 'auto',
            minHeight: '400px',
            initialEditType: 'wysiwyg', // MODO WYSIWYG
            previewStyle: 'vertical',
            initialValue: '',
            usageStatistics: false,
            toolbarItems: [
                ['heading', 'bold', 'italic'],
                ['ul', 'ol']
            ]
        });

        // El textarea original ya no lo necesitamos visible
        if (editTextarea) editTextarea.style.display = 'none';

        // Forzar hiding inicial del contenedor del editor
        document.getElementById('editor-container').style.display = 'none';
    }

    // Función para limpiar el markdown
    function getCleanedMarkdown() {
        return accumulatedChunks.replace(/\n{3,}/g, "\n\n").trim();
    }

    // Toggle entre modo Vista y modo Edición
    if (editToggleBtn) {
        editToggleBtn.addEventListener('click', () => {
            isEditMode = !isEditMode;

            if (isEditMode) {
                // Cambiar a modo EDICIÓN
                outputContent.style.display = 'none';

                // Inicializar Editor la primera vez
                initializeEditor();

                // Mostrar Editor
                if (editor) {
                    const editorContainer = document.getElementById('editor-container');
                    if (editorContainer) editorContainer.style.display = 'block';

                    editor.setMarkdown(getCleanedMarkdown());

                    // Un pequeño refresh hack para asegurar renderizado correcto
                    setTimeout(() => {
                        editor.moveCursorToStart();
                    }, 100);
                } else {
                    // Fallback (no debería ocurrir si se carga bien la librería)
                    alert("Error cargando el editor");
                    isEditMode = false;
                    outputContent.style.display = 'block';
                    return;
                }

                // Cambiar apariencia del botón
                editToggleText.textContent = 'Ver';
                editToggleBtn.style.backgroundColor = '#5bc0de';
                editToggleBtn.querySelector('svg').innerHTML = `
                    <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
                `;
            } else {
                // Cambiar a modo VISTA (y guardar)
                let newContent = "";

                if (editor) {
                    newContent = editor.getMarkdown();
                }

                if (!newContent.trim()) {
                    alert('El contenido no puede estar vacío.');
                    isEditMode = true; // Revertir
                    return;
                }

                // Guardar cambios
                editToggleBtn.disabled = true;
                editToggleText.textContent = 'Guardando...';

                window.urlHelper.fetchWithBasePath('/save-edit', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.content
                    },
                    body: JSON.stringify({
                        fileName: uploadedPdfPath,
                        content: newContent
                    })
                })
                    .then(response => response.json())
                    .then(data => {
                        console.log('[FRONTEND] Guardado exitoso:', data);

                        // Actualizar contenido local
                        accumulatedChunks = newContent;

                        // Re-renderizar
                        renderContent();

                        // Cambiar a vista
                        outputContent.style.display = 'block';

                        // Ocultar Editor
                        const editorContainer = document.getElementById('editor-container');
                        if (editorContainer) editorContainer.style.display = 'none';

                        // Restaurar botón
                        editToggleText.textContent = 'Editar';
                        editToggleBtn.style.backgroundColor = '#f0ad4e';
                        editToggleBtn.querySelector('svg').innerHTML = `
                        <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                    `;
                    })
                    .catch(error => {
                        console.error('[FRONTEND] Error al guardar:', error);
                        alert('Error al guardar los cambios.');
                        // Mantener en modo edición
                        isEditMode = true;
                    })
                    .finally(() => {
                        editToggleBtn.disabled = false;
                    });
            }
        });
    }
    // Check status provided by backend to resume if needed
    if (uploadedPdfPath) {
        checkStatus(uploadedPdfPath);
    }

    async function checkStatus(clientId) {
        try {
            const response = await fetch(window.urlHelper.buildUrl(`/check-status/${clientId}`), { credentials: 'include' });
            if (!response.ok) return;

            const data = await response.json();
            console.log('[FRONTEND] Estado recuperado:', data);

            if (data.status === 'processing') {
                console.log('[FRONTEND] Restaurando estado: PROCESANDO');

                // UI Updates
                if (outputPlaceholder) outputPlaceholder.style.display = 'none';
                if (outputContent) outputContent.style.display = 'block';
                if (generateBtn) generateBtn.style.display = 'none'; // Ocultar botón si existe

                // Restaurar logs
                if (data.logs && data.logs.length > 0) {
                    if (logBody) logBody.innerHTML = '';
                    if (logWidget) {
                        logWidget.style.display = 'block';
                        logWidget.classList.remove('collapsed');
                    }
                    data.logs.forEach(log => addProgressLog(log.message, log.type));
                }

                accumulatedChunks = data.content || '';
                renderContent();

            } else if (data.status === 'completed') {
                console.log('[FRONTEND] Restaurando estado: COMPLETADO');
                accumulatedChunks = data.content || '';

                simplificationCompleted = true;

                if (outputPlaceholder) outputPlaceholder.style.display = 'none';
                if (outputContent) outputContent.style.display = 'block';
                if (generateBtn) generateBtn.style.display = 'none';

                renderContent();

                // Habilitar descarga
                if (downloadBtn) {
                    downloadBtn.disabled = false;
                    downloadBtn.title = "Descargar informe simplificado en PDF";
                    downloadBtn.style.backgroundColor = '#28a745';
                    downloadBtn.style.cursor = 'pointer';
                    downloadBtn.style.opacity = '0.9';
                }

                // Mostrar botones flotantes
                const floatingButtons = document.getElementById('floating-buttons');
                if (floatingButtons) floatingButtons.style.display = 'flex';

                // Mostrar chatbot
                window.isEditingMode = true;
                const chatbotInterface = document.getElementById('chatbot-interface');
                if (chatbotInterface) {
                    chatbotInterface.style.display = 'block';
                    chatbotInterface.style.opacity = '1';
                }
            } else if (data.status === 'expired') {
                console.log('[FRONTEND] Sesión expirada');
                alert('La sesión ha expirado por inactividad. Por favor, inicia el proceso de nuevo.');
                window.urlHelper.navigateTo('/simplificar');
                return;
            }
        } catch (e) {
            console.error('[FRONTEND] Error verificando estado:', e);
        }
    }
});