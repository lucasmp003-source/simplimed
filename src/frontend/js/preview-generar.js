// ============================================
// GALENO-IA - Preview Generate Page JavaScript
// ============================================

// State management
const state = {
    generationData: null,
    isGenerating: false,
    eventSource: null,
    accumulatedContent: '',
    generationCompleted: false
};

// Variables para el modo de edición
let isEditMode = false;
let editor = null; // Toast UI Editor instance

// DOM Elements
const elements = {
    generateBtn: document.getElementById('generate-btn'),
    analyzeBtn: document.getElementById('analyze-btn'),
    outputArea: document.getElementById('output-area'),
    outputPlaceholder: document.getElementById('output-placeholder'),
    outputContent: document.getElementById('output-content'),
    downloadBtn: document.getElementById('download-btn'),
    simplifyBtn: document.getElementById('simplify-btn'),
    editToggleBtn: document.getElementById('edit-toggle-btn'),
    editToggleText: document.getElementById('edit-toggle-text'),
    editTextarea: document.getElementById('edit-textarea'),
    // Analysis elements
    analysisPanel: document.getElementById('analysis-panel'),
    analysisLoading: document.getElementById('analysis-loading'),
    analysisError: document.getElementById('analysis-error'),
    analysisSelector: document.getElementById('analysis-selector'),
    variablesGrid: document.getElementById('variables-grid'),
    viewChartsBtn: document.getElementById('view-charts-btn'),
    chartsContainer: document.getElementById('charts-container'),
    analysisBackBtn: document.getElementById('analysis-back-btn'),
    selectAllBtn: document.getElementById('select-all-btn'),
    deselectAllBtn: document.getElementById('deselect-all-btn')
};

// ============================================
// SSE Connection for Real-time Updates
// ============================================

function connectSSE(clientId) {
    const sseUrl = window.urlHelper.buildUrl(`/events?clientId=${encodeURIComponent(clientId)}`);
    console.log('[PREVIEW-GEN] Conectando SSE:', sseUrl);

    state.eventSource = new EventSource(sseUrl);

    state.eventSource.onopen = () => {
        console.log('[PREVIEW-GEN] SSE conectado');
    };

    state.eventSource.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            // console.log('[PREVIEW-GEN] SSE mensaje:', data.type);

            switch (data.type) {
                case 'fileChunk':
                    handleChunk(data.chunk);
                    break;

                case 'progress':
                    handleProgress(data.message, data.logType);
                    break;

                case 'reasoning': // Legacy or full-message reasoning
                    handleProgress(data.message, 'reasoning');
                    break;

                case 'reasoning_start':
                    handleReasoningStart(data.message);
                    break;

                case 'reasoning_chunk':
                    handleReasoningChunk(data.chunk);
                    break;

                case 'reasoning_end':
                    handleReasoningEnd();
                    break;

                case 'progress_bar':
                    handleProgressBar(data.percentage, data.message);
                    break;

                case 'completed':
                    handleCompletion(data.fileName);
                    break;
            }
        } catch (e) {
            console.error('[PREVIEW-GEN] Error procesando SSE:', e);
        }
    };

    state.eventSource.onerror = (error) => {
        console.error('[PREVIEW-GEN] SSE error:', error);
    };
}

// Variables para el renderizado optimizado
let renderTimeout = null;
let pendingRender = false;

function scheduleRender() {
    if (pendingRender) return;
    pendingRender = true;
    if (renderTimeout) clearTimeout(renderTimeout);
    renderTimeout = setTimeout(() => {
        requestAnimationFrame(renderContent);
    }, 50);
}

function renderContent() {
    if (!state.accumulatedContent) return;

    // Limpiar saltos de línea excesivos
    const cleanedContent = state.accumulatedContent.replace(/\n{3,}/g, "\n\n").trim();

    // Convertir a HTML usando markdown.js (igual que preview.js)
    if (window.markdown) {
        const htmlContent = markdown.toHTML(cleanedContent);
        elements.outputContent.innerHTML = htmlContent;

        // Aplicar estilos "inline" para asegurar consistencia
        const markdownElements = elements.outputContent.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, ul, ol, code, pre');
        markdownElements.forEach((element) => {
            element.classList.add('markdown-text');
            element.style.color = '#333';
        });
    } else {
        elements.outputContent.innerHTML = `<pre style="white-space: pre-wrap;">${state.accumulatedContent}</pre>`;
    }

    // Auto-scroll
    elements.outputContent.scrollTop = elements.outputContent.scrollHeight;
    pendingRender = false;
}

function handleChunk(chunk) {
    const isFirstChunk = state.accumulatedContent.length === 0;
    state.accumulatedContent += chunk;

    // Mostrar contenido y ocultar placeholder si es el primer chunk
    if (elements.outputPlaceholder.style.display !== 'none') {
        elements.outputPlaceholder.style.display = 'none';
        elements.outputContent.style.display = 'block';
    }

    // Auto-colapsar logs al recibir el primer chunk de contenido real
    if (isFirstChunk && logWidget && !logWidget.classList.contains('collapsed')) {
        setTimeout(() => {
            logWidget.classList.add('collapsed');
            // Cambiar texto de status
            if (logStatusText) logStatusText.textContent = "Escribiendo informe...";
        }, 500);
    }

    // Programar renderizado optimizado
    scheduleRender();
}

// ============================================
// Log Widget Logic
// ============================================

const logWidget = document.getElementById('log-widget');
const logToggle = document.getElementById('log-toggle');
const logStatusText = document.getElementById('log-status-text');
const logBody = document.getElementById('progress-logs');
let currentReasoningLog = null;

// Toggle de logs
if (logToggle && logWidget) {
    logToggle.addEventListener('click', () => {
        logWidget.classList.toggle('collapsed');
    });
}

function addProgressLog(message, logType = 'info') {
    if (!logBody || !logWidget) {
        console.warn('[PREVIEW-GEN] Widget de logs no encontrado');
        return;
    }

    // Mostrar el widget si no está visible
    if (logWidget.style.display === 'none') {
        logWidget.style.display = 'block';
    }

    const logEntry = document.createElement('div');
    logEntry.className = `log-entry ${logType}`;

    const timestamp = new Date().toLocaleTimeString('es-ES', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    logEntry.innerHTML = `
        <span class="log-timestamp">[${timestamp}]</span>
        <span class="log-message">${message}</span>
    `;

    logBody.appendChild(logEntry);
    logBody.scrollTop = logBody.scrollHeight;

    // Actualizar status en header
    if (logStatusText && logType !== 'info') {
        logStatusText.textContent = message.length > 30 ? message.substring(0, 27) + '...' : message;
    }
}

function handleProgress(message, logType) {
    console.log(`[PREVIEW-GEN] Progreso (${logType}): ${message}`);
    addProgressLog(message, logType);
}

function handleReasoningStart(message) {
    handleProgress(message, 'reasoning');
    // Capture the message span of the last added entry to append chunks
    if (logBody.lastElementChild) {
        currentReasoningLog = logBody.lastElementChild.querySelector('.log-message');
    }
}

function handleReasoningChunk(chunk) {
    if (currentReasoningLog) {
        // Append text safely
        currentReasoningLog.textContent += chunk;
        // Auto-scroll
        logBody.scrollTop = logBody.scrollHeight;
    }
}

function handleReasoningEnd() {
    currentReasoningLog = null;
}

function handleProgressBar(percentage, message) {
    // Update progress bar UI
    const progressBar = document.getElementById('analysis-progress-bar');
    const progressText = document.getElementById('analysis-progress-text');

    if (progressBar) {
        progressBar.style.width = `${percentage}%`;
    }

    if (progressText) {
        progressText.textContent = `${percentage}% - ${message}`;
    }
}

function handleCompletion(fileName) {
    console.log('[PREVIEW-GEN] Generación completada:', fileName);

    state.isGenerating = false;
    state.generationCompleted = true;
    elements.generateBtn.disabled = false;
    elements.generateBtn.textContent = '✅ Generación Completada';

    // Cerrar SSE
    if (state.eventSource) {
        state.eventSource.close();
        state.eventSource = null;
    }

    // Renderizar cualquier contenido pendiente INMEDIATAMENTE
    if (renderTimeout) {
        clearTimeout(renderTimeout);
    }
    renderContent();

    // Habilitar botón de descarga
    if (elements.downloadBtn) {
        elements.downloadBtn.disabled = false;
        elements.downloadBtn.title = "Descargar informe en PDF";
        elements.downloadBtn.style.backgroundColor = '#28a745';
        elements.downloadBtn.style.cursor = 'pointer';
        elements.downloadBtn.style.opacity = '0.9';
    }

    // Habilitar botón de simplificación
    if (elements.simplifyBtn) {
        elements.simplifyBtn.disabled = false;
        elements.simplifyBtn.title = "Simplificar este informe";
        elements.simplifyBtn.style.backgroundColor = '#6f42c1';
        elements.simplifyBtn.style.cursor = 'pointer';
        elements.simplifyBtn.style.opacity = '0.9';
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

    // Ocultar completamente el widget de logs con animación después de 3 segundos
    setTimeout(() => {
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
}

// ============================================
// Report Generation
// ============================================

async function startGeneration() {
    console.log('[PREVIEW-GEN] Iniciando generación...');

    if (!state.generationToken) {
        alert('No hay token de generación. Por favor, inicia el proceso de nuevo.');
        window.urlHelper.navigateTo('/generar');
        return;
    }

    state.isGenerating = true;
    state.accumulatedContent = '';

    // UI: loading state
    elements.generateBtn.disabled = true; // Disable just in case, though hidden

    // Hide placeholder (button disappears)
    elements.outputPlaceholder.style.display = 'none';

    // Reset Log Widget
    if (logBody) logBody.innerHTML = '';
    if (logWidget) {
        logWidget.style.display = 'block';
        logWidget.classList.remove('collapsed');
        logWidget.style.opacity = '1';
        logWidget.style.transform = 'none';
        // Force reflow
        void logWidget.offsetWidth;
        logWidget.style.transition = 'all 0.3s ease';
    }
    if (logStatusText) logStatusText.textContent = 'Iniciando generación...';

    // Show content with initial loading state
    elements.outputContent.style.display = 'block';
    elements.outputContent.innerHTML = `
        <div style="text-align: center; padding: 40px; color: #666;">
            <div class="spinner-border" style="display: inline-block; width: 2rem; height: 2rem; vertical-align: text-bottom; border: .25em solid currentColor; border-right-color: transparent; border-radius: 50%; animation: spinner-border .75s linear infinite;"></div>
            <p style="margin-top: 10px;">Iniciando generación...</p>
        </div>
        <style>@keyframes spinner-border { to { transform: rotate(360deg); } }</style>
    `;

    try {
        // Conectar SSE primero usando el token
        const clientId = state.generationToken;
        connectSSE(clientId);

        // Pequeña pausa para asegurar conexión SSE
        await new Promise(resolve => setTimeout(resolve, 500));

        // Llamar al endpoint de generación con el token
        const response = await fetch(window.urlHelper.buildUrl('/generate-report'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.content
            },
            body: JSON.stringify({
                token: state.generationToken
            })
        });

        if (!response.ok) {
            throw new Error('Error al iniciar generación');
        }

        const data = await response.json();
        console.log('[PREVIEW-GEN] Generación iniciada:', data);

    } catch (error) {
        console.error('[PREVIEW-GEN] Error:', error);
        state.isGenerating = false;

        // Restore UI on error
        elements.outputPlaceholder.style.display = 'flex'; // Restore button
        elements.outputContent.style.display = 'none';
        elements.generateBtn.disabled = false;
        elements.generateBtn.textContent = '✨ Generar Informe de Alta';

        alert(`Error: ${error.message}`);

        if (state.eventSource) {
            state.eventSource.close();
        }
    }
}

// ============================================
// Initialization
// ============================================

function init() {
    // Log completo de la URL actual para debugging
    console.log('[PREVIEW-GEN] URL completa:', window.location.href);
    console.log('[PREVIEW-GEN] Search params:', window.location.search);

    // Obtener token de URL (similar a preview.js con fileName)
    const generationToken = new URLSearchParams(window.location.search).get('token');
    console.log('[PREVIEW-GEN] Token extraído de URL:', generationToken);

    if (!generationToken) {
        console.error('[PREVIEW-GEN] No generation token in URL');
        alert('Error: No se encontró el identificador de generación. Por favor, inicia el proceso de nuevo.');
        window.urlHelper.navigateTo('/generar');
        return;
    }

    console.log('[PREVIEW-GEN] ✓ Token de generación válido:', generationToken);

    // Guardar el token en el estado
    state.generationToken = generationToken;

    // Setup generation button
    if (elements.generateBtn) {
        console.log('[PREVIEW-GEN] Botón de generación encontrado, registrando event listener');
        elements.generateBtn.addEventListener('click', startGeneration);
    } else {
        console.error('[PREVIEW-GEN] ERROR: Botón de generación NO encontrado!');
    }

    // Setup analysis button
    if (elements.analyzeBtn) {
        console.log('[PREVIEW-GEN] Botón de análisis encontrado, registrando event listener');
        elements.analyzeBtn.addEventListener('click', startAnalysis);
    }

    // Setup analysis event handlers
    setupAnalysisHandlers();

    // Setup Action Buttons (Download & Simplify)
    setupActionButtons();

    // Setup edit button
    setupEditButton();

    // Setup Tabs
    setupTabs();

    // Renderizar PDFs usando el token para construir las rutas
    // Los archivos están guardados como: token_evolution.pdf y token_anamnesis.pdf
    const evolutionFileName = `${generationToken}_evolution.pdf`;
    const anamnesisFileName = `${generationToken}_anamnesis.pdf`;

    renderPdf(evolutionFileName, 'evolution-content');
    renderPdf(anamnesisFileName, 'anamnesis-content');

    // Restore state if reloading
    checkStatus(generationToken);
}

async function checkStatus(token) {
    try {
        const response = await fetch(window.urlHelper.buildUrl(`/check-status/${token}`));
        if (!response.ok) return;

        const data = await response.json();
        console.log('[PREVIEW-GEN] Estado recuperado:', data);

        if (data.status === 'processing') {
            console.log('[PREVIEW-GEN] Restaurando estado: PROCESANDO');
            state.isGenerating = true;
            state.accumulatedContent = data.content || '';

            // UI Updates
            elements.generateBtn.disabled = true;
            elements.generateBtn.textContent = '⏳ Generando...';
            elements.outputPlaceholder.style.display = 'none';
            elements.outputContent.style.display = 'block';

            // Restore logs
            if (data.logs && data.logs.length > 0) {
                if (logBody) logBody.innerHTML = '';
                if (logWidget) {
                    logWidget.style.display = 'block';
                    logWidget.classList.remove('collapsed');
                }
                data.logs.forEach(log => addProgressLog(log.message, log.type));
            }

            // Render accumulated content
            renderContent();

            // Reconnect SSE
            connectSSE(token);

        } else if (data.status === 'completed') {
            console.log('[PREVIEW-GEN] Restaurando estado: COMPLETADO');
            state.accumulatedContent = data.content || '';

            // Asegurar que la UI muestra el contenido y no el placeholder
            elements.outputPlaceholder.style.display = 'none';
            elements.outputContent.style.display = 'block';

            // Handle completion directly
            handleCompletion(token + '.md');

            // Force re-render to be sure
            renderContent();
        } else if (data.status === 'expired') {
            console.log('[PREVIEW-GEN] Sesión expirada');
            alert('La sesión ha expirado por inactividad. Por favor, inicia el proceso de nuevo.');
            window.urlHelper.navigateTo('/generar');
            return;
        }

    } catch (e) {
        console.error('[PREVIEW-GEN] Error verificando estado:', e);
    }
}

// ============================================
// PDF Rendering & Tabs
// ============================================

function setupTabs() {
    const tabs = document.querySelectorAll('.tab-btn');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // Remove active class from all tabs
            tabs.forEach(t => t.classList.remove('active'));

            // Add active class to clicked tab
            tab.classList.add('active');

            // Hide all content
            document.querySelectorAll('.document-content').forEach(content => {
                content.classList.remove('active');
            });

            // Show target content
            const targetId = tab.dataset.tab + '-content';
            const targetContent = document.getElementById(targetId);
            if (targetContent) {
                targetContent.classList.add('active');
            }
        });
    });
}

function renderPdf(fileName, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const url = window.urlHelper.buildUrl('/tempUploads/' + fileName);
    console.log(`[PREVIEW-GEN] Rendering PDF: ${fileName} in ${containerId}`);

    // Loading indicator
    container.innerHTML = '<div style="text-align:center; padding: 20px; color:#666;">Cargando documento...</div>';

    pdfjsLib.getDocument(url).promise.then(pdfDoc => {
        container.innerHTML = ''; // Clear loading

        const totalPages = pdfDoc.numPages;

        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
            pdfDoc.getPage(pageNum).then(page => {
                const canvas = document.createElement('canvas');
                canvas.style.display = 'block';
                canvas.style.marginBottom = '20px';
                canvas.style.boxShadow = '0 2px 5px rgba(0,0,0,0.1)';
                container.appendChild(canvas);

                const viewport = page.getViewport({ scale: 1.5 });
                canvas.height = viewport.height;
                canvas.width = viewport.width;

                const renderContext = {
                    canvasContext: canvas.getContext('2d'),
                    viewport: viewport
                };

                page.render(renderContext);
            });
        }
    }).catch(error => {
        console.error(`[PREVIEW-GEN] Error loading PDF ${fileName}:`, error);
        container.innerHTML = `
            <div style="text-align:center; padding: 20px; color:#d9534f;">
                <p>Error al cargar el documento.</p>
                <small>${error.message}</small>
            </div>
        `;
    });
}

// ============================================
// Download PDF Functionality
// ============================================

// function setupDownloadButton() { ... } - REMOVED, merged into setupActionButtons

// ============================================
// Edit Mode with Toast UI Editor
// ============================================

// Función para inicializar el editor (diferida)
function initializeEditor() {
    if (editor) return;

    // Crear div contenedor para Toast UI Editor
    let editorDiv = document.getElementById('editor-container');
    if (!editorDiv) {
        editorDiv = document.createElement('div');
        editorDiv.id = 'editor-container';
        editorDiv.style.display = 'none';
        if (elements.editTextarea && elements.editTextarea.parentNode) {
            elements.editTextarea.parentNode.insertBefore(editorDiv, elements.editTextarea);
        }
    }

    const Editor = toastui.Editor;

    editor = new Editor({
        el: document.querySelector('#editor-container'),
        height: 'auto',
        minHeight: '400px',
        initialEditType: 'wysiwyg',
        previewStyle: 'vertical',
        initialValue: '',
        usageStatistics: false,
        toolbarItems: [
            ['heading', 'bold', 'italic'],
            ['ul', 'ol']
        ]
    });

    // Ocultar textarea original
    if (elements.editTextarea) elements.editTextarea.style.display = 'none';

    // Forzar hiding inicial del contenedor del editor
    document.getElementById('editor-container').style.display = 'none';
}

// Función para obtener el markdown limpio
function getCleanedMarkdown() {
    return state.accumulatedContent.replace(/\n{3,}/g, "\n\n").trim();
}

// Función para configurar el botón de edición
function setupEditButton() {
    if (!elements.editToggleBtn) return;

    elements.editToggleBtn.addEventListener('click', () => {
        isEditMode = !isEditMode;

        if (isEditMode) {
            // Cambiar a modo EDICIÓN
            elements.outputContent.style.display = 'none';

            // Inicializar Editor si no existe
            initializeEditor();

            // Mostrar Editor
            if (editor) {
                const editorContainer = document.getElementById('editor-container');
                if (editorContainer) editorContainer.style.display = 'block';

                editor.setMarkdown(getCleanedMarkdown());

                // Pequeño refresh hack para asegurar renderizado correcto
                setTimeout(() => {
                    editor.moveCursorToStart();
                }, 100);
            } else {
                alert("Error cargando el editor");
                isEditMode = false;
                elements.outputContent.style.display = 'block';
                return;
            }

            // Cambiar apariencia del botón
            elements.editToggleText.textContent = 'Ver';
            elements.editToggleBtn.style.backgroundColor = '#5bc0de';
            elements.editToggleBtn.querySelector('svg').innerHTML = `
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
                isEditMode = true;
                return;
            }

            // Guardar cambios
            elements.editToggleBtn.disabled = true;
            elements.editToggleText.textContent = 'Guardando...';

            const fileName = state.generationToken + '.md';

            window.urlHelper.fetchWithBasePath('/save-edit', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.content
                },
                body: JSON.stringify({
                    fileName: fileName,
                    content: newContent
                })
            })
                .then(response => response.json())
                .then(data => {
                    console.log('[PREVIEW-GEN] Guardado exitoso:', data);

                    // Actualizar contenido local
                    state.accumulatedContent = newContent;

                    // Re-renderizar
                    renderContent();

                    // Cambiar a vista
                    elements.outputContent.style.display = 'block';

                    // Ocultar Editor
                    const editorContainer = document.getElementById('editor-container');
                    if (editorContainer) editorContainer.style.display = 'none';

                    // Restaurar botón
                    elements.editToggleText.textContent = 'Editar';
                    elements.editToggleBtn.style.backgroundColor = '#f0ad4e';
                    elements.editToggleBtn.querySelector('svg').innerHTML = `
                        <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                    `;
                })
                .catch(error => {
                    console.error('[PREVIEW-GEN] Error al guardar:', error);
                    alert('Error al guardar los cambios.');
                    isEditMode = true;
                })
                .finally(() => {
                    elements.editToggleBtn.disabled = false;
                });
        }
    });
}

// Exponer función de recarga para el Chatbot
window.refreshPreview = async () => {
    if (!state.generationToken) return;
    const mdFileName = state.generationToken + '.md';
    const url = window.urlHelper.buildUrl(`/data/OutputData/${mdFileName}?t=${Date.now()}`);

    try {
        console.log('[PREVIEW-GEN] Recargando contenido desde:', url);
        const response = await fetch(url);
        if (!response.ok) throw new Error('Error al obtener archivo actualizado');
        const text = await response.text();

        // Actualizar contenido y renderizar
        state.accumulatedContent = text;
        renderContent();
        console.log('[PREVIEW-GEN] Informe actualizado con las correcciones.');
    } catch (e) {
        console.error('[PREVIEW-GEN] Error refrescando vista:', e);
    }
};

// ============================================
// Admission Analysis Feature
// ============================================

// Analysis state
const analysisState = {
    data: null,
    selectedVariables: new Set(),
    chartInstances: []
};

// Categories are now provided dynamically by the LLM (no hardcoded map needed)

// Chart color palette
const CHART_COLORS = [
    { bg: 'rgba(0, 151, 167, 0.15)', border: '#0097a7' },
    { bg: 'rgba(233, 30, 99, 0.15)', border: '#e91e63' },
    { bg: 'rgba(76, 175, 80, 0.15)', border: '#4caf50' },
    { bg: 'rgba(255, 152, 0, 0.15)', border: '#ff9800' },
    { bg: 'rgba(103, 58, 183, 0.15)', border: '#673ab7' },
    { bg: 'rgba(33, 150, 243, 0.15)', border: '#2196f3' },
    { bg: 'rgba(244, 67, 54, 0.15)', border: '#f44336' },
    { bg: 'rgba(0, 150, 136, 0.15)', border: '#009688' }
];

async function startAnalysis() {
    console.log('[PREVIEW-GEN] Iniciando análisis de ingreso...');

    if (!state.generationToken) {
        alert('No hay token de generación. Por favor, inicia el proceso de nuevo.');
        return;
    }

    // Show analysis panel, hide placeholder
    elements.outputPlaceholder.style.display = 'none';
    elements.outputContent.style.display = 'none';
    elements.analysisPanel.style.display = 'block';

    // Show loading
    elements.analysisLoading.style.display = 'flex';
    elements.analysisLoading.innerHTML = `
        <div class="analysis-spinner"></div>
        <div style="width: 100%; max-width: 300px; margin-top: 16px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                <span style="font-size: 14px; font-weight: 500; color: #0097a7;">Analizando ingreso...</span>
                <span id="analysis-progress-text" style="font-size: 12px; color: #666;">0%</span>
            </div>
            <div style="width: 100%; height: 6px; background: #e0e0e0; border-radius: 3px; overflow: hidden;">
                <div id="analysis-progress-bar" style="width: 0%; height: 100%; background: #0097a7; transition: width 0.3s ease;"></div>
            </div>
        </div>
        <p style="margin-top: 8px; font-size: 12px; color: #999;">Esto puede tomar unos minutos</p>
    `;
    elements.analysisError.style.display = 'none';
    elements.analysisSelector.style.display = 'none';
    elements.chartsContainer.style.display = 'none';

    // Disable button
    elements.analyzeBtn.disabled = true;

    // Conectar SSE para recibir logs de "razonamiento"
    connectSSE(state.generationToken);

    // Limpiar logs anteriores y mostrar widget
    if (logBody) logBody.innerHTML = '';
    if (logWidget) {
        logWidget.style.display = 'block';
        logWidget.classList.remove('collapsed');
        if (logStatusText) logStatusText.textContent = 'Iniciando análisis...';
    }

    try {
        const response = await fetch(window.urlHelper.buildUrl('/analyze-admission'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.content
            },
            body: JSON.stringify({ token: state.generationToken })
        });

        if (!response.ok && response.status !== 202) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.message || 'Error al analizar el ingreso');
        }

        let data;
        if (response.status === 202) {
            // El análisis está en curso, hacemos polling cada 3 segundos
            const pollResult = async () => {
                let consecutiveErrors = 0;
                while (true) {
                    await new Promise(r => setTimeout(r, 3000));

                    try {
                        const res = await fetch(window.urlHelper.buildUrl(`/analyze-admission-result/${state.generationToken}`), {
                            headers: { 'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.content }
                        });

                        // Si la petición tuvo éxito (cualquier status HTTP), reseteamos los errores de red
                        consecutiveErrors = 0;

                        if (res.status === 200) {
                            return await res.json();
                        } else if (res.status === 202) {
                            continue;
                        } else {
                            const errData = await res.json().catch(() => ({}));
                            throw new Error(errData.error || 'Error obteniendo resultado del análisis');
                        }
                    } catch (e) {
                        // Capturamos Errores de Red tipo "Failed to fetch", "NetworkError", timeouts, etc.
                        if (e.name === 'TypeError' || e.message.includes('fetch') || e.message.includes('Network')) {
                            consecutiveErrors++;
                            console.warn(`[PREVIEW-GEN] Network error durante el polling (${consecutiveErrors}/15): ${e.message}`);

                            // Si fallamos 15 veces seguidas (aprox 45 segundos sin red), lanzamos el error
                            if (consecutiveErrors >= 15) {
                                throw new Error('Error de conexión prolongado. El análisis podría seguir corriendo en el servidor.');
                            }
                            // Esperamos un poco más antes de reintentar si es error de red
                            await new Promise(r => setTimeout(r, 2000));
                        } else {
                            // Cualquier otro error (del propio servidor 500/400 o error lógico) lo lanzamos directo
                            throw e;
                        }
                    }
                }
            };
            data = await pollResult();
        } else {
            data = await response.json();
        }

        console.log('[PREVIEW-GEN] Análisis recibido:', data);

        if (data.error) {
            throw new Error(data.error);
        }

        if (!data.variables_encontradas || data.variables_encontradas.length === 0) {
            throw new Error('No se encontraron valores clínicos cuantitativos en la hoja de evolución.');
        }

        analysisState.data = data;
        elements.analysisLoading.style.display = 'none';
        renderVariableSelector(data);

    } catch (error) {
        console.error('[PREVIEW-GEN] Error en análisis:', error);
        elements.analysisLoading.style.display = 'none';
        elements.analysisError.style.display = 'block';
        elements.analysisError.innerHTML = `
            <strong>⚠️ Error en el análisis</strong>
            <p style="margin: 8px 0 0;">${error.message}</p>
        `;
    } finally {
        elements.analyzeBtn.disabled = false;
    }
}

function renderVariableSelector(data) {
    const { variables_encontradas, categorias } = data;
    elements.analysisSelector.style.display = 'block';

    // Build a lookup map: nombre -> var_info
    const varMap = {};
    variables_encontradas.forEach(v => { varMap[v.nombre] = v; });

    // Build HTML using LLM-provided categories
    let html = '';

    if (categorias && categorias.length > 0) {
        // Use LLM categories
        categorias.forEach(cat => {
            html += `<div class="variable-category">`;
            html += `<div class="category-title">${cat.nombre_categoria}</div>`;
            html += `<div class="category-variables">`;

            (cat.variables || []).forEach(varName => {
                const varInfo = varMap[varName];
                const unit = varInfo ? (varInfo.unidad || '') : '';
                html += `
                    <div class="variable-chip" data-var="${varName}">
                        <span class="chip-check"></span>
                        <span class="chip-label">${varName}</span>
                        ${unit ? `<span class="variable-unit">(${unit})</span>` : ''}
                    </div>
                `;
            });

            html += `</div></div>`;
        });
    } else {
        // Fallback: flat list if no categories
        html += `<div class="variable-category">`;
        html += `<div class="category-title">Variables Clínicas</div>`;
        html += `<div class="category-variables">`;
        variables_encontradas.forEach(v => {
            const unit = v.unidad || '';
            html += `
                <div class="variable-chip" data-var="${v.nombre}">
                    <span class="chip-check"></span>
                    <span class="chip-label">${v.nombre}</span>
                    ${unit ? `<span class="variable-unit">(${unit})</span>` : ''}
                </div>
            `;
        });
        html += `</div></div>`;
    }

    elements.variablesGrid.innerHTML = html;
    analysisState.selectedVariables.clear();
    updateViewChartsBtn();

    // Add click handlers to chips
    elements.variablesGrid.querySelectorAll('.variable-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const varName = chip.dataset.var;
            if (analysisState.selectedVariables.has(varName)) {
                analysisState.selectedVariables.delete(varName);
                chip.classList.remove('selected');
            } else {
                analysisState.selectedVariables.add(varName);
                chip.classList.add('selected');
            }
            updateViewChartsBtn();
        });
    });
}

function updateViewChartsBtn() {
    const count = analysisState.selectedVariables.size;
    elements.viewChartsBtn.disabled = count === 0;
    elements.viewChartsBtn.textContent = count === 0
        ? '📊 Ver Gráficas'
        : `📊 Ver Gráficas (${count} variable${count > 1 ? 's' : ''})`;
}

async function renderCharts() {
    if (!analysisState.data || analysisState.selectedVariables.size === 0) return;

    const { variables_encontradas } = analysisState.data;

    // Destroy previous chart instances
    analysisState.chartInstances.forEach(c => c.destroy());
    analysisState.chartInstances = [];

    // Show loading state in charts container
    elements.chartsContainer.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px; color: #0097a7; width: 100%;">
            <div class="analysis-spinner"></div>
            <p style="margin-top: 16px; font-size: 15px;">Extrayendo valores registro por registro...</p>
            <p style="margin-top: 4px; font-size: 12px; color: #999;">Esto puede tardar unos segundos</p>
        </div>
    `;
    elements.chartsContainer.style.display = 'flex';
    elements.analysisSelector.style.display = 'none';
    elements.viewChartsBtn.disabled = true;

    try {
        // Phase 2: Call extraction endpoint with selected variables
        const selectedVarNames = Array.from(analysisState.selectedVariables);

        const response = await fetch(window.urlHelper.buildUrl('/analyze-admission-extract'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.content
            },
            body: JSON.stringify({
                token: state.generationToken,
                variables: selectedVarNames
            })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.message || 'Error al extraer valores');
        }

        const extractionData = await response.json();
        console.log('[PREVIEW-GEN] Extracción recibida:', extractionData);

        if (extractionData.error) {
            throw new Error(extractionData.error);
        }

        const registros = extractionData.registros || [];
        if (registros.length === 0) {
            throw new Error('No se obtuvieron registros del análisis.');
        }

        // Now render charts with the extraction data
        elements.chartsContainer.innerHTML = '';
        let colorIdx = 0;

        analysisState.selectedVariables.forEach(varName => {
            const varInfo = variables_encontradas.find(v => v.nombre === varName);
            const displayName = varName;
            const unit = varInfo?.unidad || '';

            // Extract values per registro
            const labels = [];
            const values = [];

            registros.forEach(reg => {
                if (reg.valores && reg.valores[varName] !== undefined) {
                    labels.push(`Registro ${reg.registro}`);
                    const val = reg.valores[varName];
                    values.push(typeof val === 'object' ? val.valor : val);
                }
            });

            if (values.length === 0) return;

            const color = CHART_COLORS[colorIdx % CHART_COLORS.length];
            colorIdx++;

            // Create chart card
            const card = document.createElement('div');
            card.className = 'chart-card';
            card.innerHTML = `<h4>${displayName} ${unit ? `(${unit})` : ''}</h4>`;

            const canvas = document.createElement('canvas');
            card.appendChild(canvas);
            elements.chartsContainer.appendChild(card);

            const ctx = canvas.getContext('2d');
            const chart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: displayName,
                        data: values,
                        borderColor: color.border,
                        backgroundColor: color.bg,
                        borderWidth: 2.5,
                        pointBackgroundColor: color.border,
                        pointBorderColor: '#fff',
                        pointBorderWidth: 2,
                        pointRadius: 5,
                        pointHoverRadius: 7,
                        fill: true,
                        tension: 0.3
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: 'rgba(0,0,0,0.8)',
                            titleFont: { size: 13 },
                            bodyFont: { size: 13 },
                            callbacks: {
                                label: (tooltipCtx) => `${displayName}: ${tooltipCtx.parsed.y} ${unit}`
                            }
                        }
                    },
                    scales: {
                        x: {
                            grid: { display: false },
                            ticks: { font: { size: 12 } }
                        },
                        y: {
                            title: {
                                display: true,
                                text: unit || displayName,
                                font: { size: 12, weight: 'bold' }
                            },
                            ticks: { font: { size: 11 } },
                            grid: { color: 'rgba(0,0,0,0.06)' }
                        }
                    }
                }
            });

            analysisState.chartInstances.push(chart);
        });

        // If no charts were rendered (no data for selected vars)
        if (elements.chartsContainer.children.length === 0) {
            elements.chartsContainer.innerHTML = `
                <div style="text-align: center; padding: 40px; color: #999;">
                    <p>No hay datos disponibles para las variables seleccionadas.</p>
                </div>
            `;
        }

    } catch (error) {
        console.error('[PREVIEW-GEN] Error en extracción:', error);
        elements.chartsContainer.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #d9534f;">
                <strong>⚠️ Error al extraer valores</strong>
                <p style="margin: 8px 0 0;">${error.message}</p>
                <button onclick="document.getElementById('charts-container').style.display='none'; document.getElementById('analysis-selector').style.display='block';"
                        style="margin-top: 16px; padding: 8px 20px; background: #0097a7; color: white; border: none; border-radius: 6px; cursor: pointer;">
                    ← Volver a selección
                </button>
            </div>
        `;
    } finally {
        elements.viewChartsBtn.disabled = false;
    }
}

function setupAnalysisHandlers() {
    // Back button
    if (elements.analysisBackBtn) {
        elements.analysisBackBtn.addEventListener('click', () => {
            // If showing charts, go back to selector
            if (elements.chartsContainer.style.display !== 'none' &&
                elements.chartsContainer.children.length > 0) {
                elements.chartsContainer.style.display = 'none';
                elements.analysisSelector.style.display = 'block';
                return;
            }
            // Otherwise go back to main buttons
            elements.analysisPanel.style.display = 'none';
            if (!state.generationCompleted && !state.isGenerating) {
                elements.outputPlaceholder.style.display = 'flex';
            } else if (state.accumulatedContent) {
                elements.outputContent.style.display = 'block';
            } else {
                elements.outputPlaceholder.style.display = 'flex';
            }
        });
    }

    // Select all
    if (elements.selectAllBtn) {
        elements.selectAllBtn.addEventListener('click', () => {
            elements.variablesGrid.querySelectorAll('.variable-chip').forEach(chip => {
                chip.classList.add('selected');
                analysisState.selectedVariables.add(chip.dataset.var);
            });
            updateViewChartsBtn();
        });
    }

    // Deselect all
    if (elements.deselectAllBtn) {
        elements.deselectAllBtn.addEventListener('click', () => {
            elements.variablesGrid.querySelectorAll('.variable-chip').forEach(chip => {
                chip.classList.remove('selected');
            });
            analysisState.selectedVariables.clear();
            updateViewChartsBtn();
        });
    }

    // View charts
    if (elements.viewChartsBtn) {
        elements.viewChartsBtn.addEventListener('click', renderCharts);
    }
}


function setupActionButtons() {
    // Initialize Download Button
    if (elements.downloadBtn) {
        elements.downloadBtn.addEventListener('click', async () => {
            if (!state.generationToken) return;
            if (!state.generationCompleted) {
                alert('Por favor, espera a que la generación concluya.');
                return;
            }

            try {
                elements.downloadBtn.disabled = true;
                const originalHTML = elements.downloadBtn.innerHTML;
                elements.downloadBtn.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" style="margin-right: 6px;">
                        <path d="M13 8V2H7v6H2l8 8 8-8h-5zM0 18h20v2H0v-2z" />
                    </svg>
                    Generando PDF...
                `;

                // Usar contenido del editor si está en modo edición, sino usar acumulado
                const markdownContent = (isEditMode && editor) ? editor.getMarkdown() : state.accumulatedContent.replace(/\n{3,}/g, "\n\n").trim();

                const response = await window.urlHelper.fetchWithBasePath('/api/generate-pdf', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.content
                    },
                    body: JSON.stringify({ markdown: markdownContent })
                });

                if (!response.ok) throw new Error('Error en el servidor');

                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'informe_alta.pdf';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
            } catch (error) {
                alert('Error: ' + error.message);
            } finally {
                elements.downloadBtn.disabled = false;
                elements.downloadBtn.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" style="margin-right: 6px;">
                        <path d="M13 8V2H7v6H2l8 8 8-8h-5zM0 18h20v2H0v-2z" />
                    </svg>
                    Descargar PDF
                `;
            }
        });
    }

    // Initialize Simplify Button
    if (elements.simplifyBtn) {
        elements.simplifyBtn.addEventListener('click', async () => {
            if (!state.generationToken) return;

            if (isEditMode && editor) {
                const confirmSave = confirm("Para simplificar, primero se deben guardar los cambios. ¿Desea guardar y continuar?");
                if (!confirmSave) return;
                elements.editToggleBtn.click();
            }

            try {
                elements.simplifyBtn.disabled = true;
                elements.simplifyBtn.innerHTML = `
                    <div class="spinner-border" style="width: 1rem; height: 1rem; border-width: 0.15em; margin-right: 6px;"></div>
                    Procesando...
                `;

                const response = await fetch(window.urlHelper.buildUrl('/api/transfer-generation-to-simplification'), {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.content
                    },
                    body: JSON.stringify({ fileName: state.generationToken })
                });

                if (!response.ok) {
                    const err = await response.json();
                    throw new Error(err.error || 'Error en transferencia');
                }

                const data = await response.json();
                console.log('[PREVIEW-GEN] Redirigiendo a simplificación:', data.redirectFileName);
                window.location.href = window.urlHelper.buildUrl(`/preview-simplificar?fileName=${encodeURIComponent(data.redirectFileName)}`);

            } catch (error) {
                console.error('[PREVIEW-GEN] Error al simplificar:', error);
                alert('Error al iniciar simplificación: ' + error.message);
                elements.simplifyBtn.disabled = false;
                elements.simplifyBtn.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;">
                        <polyline points="4 14 10 14 10 20"></polyline>
                        <polyline points="20 10 14 10 14 4"></polyline>
                        <line x1="14" y1="10" x2="21" y2="3"></line>
                        <line x1="3" y1="21" x2="10" y2="14"></line>
                    </svg>
                    Simplificar
                `;
            }
        });
    }
}

// Run initialization when DOM is ready
document.addEventListener('DOMContentLoaded', init);
