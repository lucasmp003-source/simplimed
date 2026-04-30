// ============================================
// GALENO-IA - Generate Report Page JavaScript
// ============================================

// State management
const state = {
    evolutionFile: null,
    anamnesisFile: null
};

// DOM Elements
const elements = {
    evolutionRow: document.getElementById('evolution-row'),
    anamnesisRow: document.getElementById('anamnesis-row'),
    evolutionInput: document.getElementById('evolution-input'),
    anamnesisInput: document.getElementById('anamnesis-input'),
    evolutionStatus: document.getElementById('evolution-status'),
    anamnesisStatus: document.getElementById('anamnesis-status'),
    statusMessage: document.getElementById('status-message'),
    loadingMessage: document.getElementById('loading-message')
};

// ============================================
// File Upload Handling
// ============================================

function setupFileUpload(row, input, statusElement, fileType) {
    // Click handler is already in HTML onclick

    // File input change
    input.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) handleFileSelect(file, fileType, statusElement, row);
    });

    // Drag and drop on the row
    row.addEventListener('dragover', (e) => {
        e.preventDefault();
        row.style.borderColor = '#d9534f';
        row.style.background = '#fff5f5';
    });

    row.addEventListener('dragleave', (e) => {
        e.preventDefault();
        if (!row.classList.contains('uploaded')) {
            row.style.borderColor = '#ddd';
            row.style.background = '#f9fbfd';
        }
    });

    row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.style.borderColor = '#ddd';
        row.style.background = '#f9fbfd';
        const file = e.dataTransfer.files[0];
        if (file) handleFileSelect(file, fileType, statusElement, row);
    });
}

function handleFileSelect(file, fileType, statusElement, row) {
    // Validate PDF
    if (file.type !== 'application/pdf') {
        showStatusMessage('Por favor, selecciona un archivo PDF válido.', 'error');
        return;
    }

    // Store file in state
    if (fileType === 'evolution') {
        state.evolutionFile = file;
    } else {
        state.anamnesisFile = file;
    }

    // Update UI
    row.classList.add('uploaded');
    statusElement.textContent = `✓ ${file.name}`;
    statusElement.classList.add('uploaded');

    // Check if both files are uploaded → auto navigate
    checkAndNavigate();
}

function showStatusMessage(message, type = 'info') {
    elements.statusMessage.textContent = message;
    elements.statusMessage.style.color = type === 'error' ? '#d9534f' : '#666';
}

// ============================================
// Auto-navigation when both files uploaded
// ============================================

function checkAndNavigate() {
    if (state.evolutionFile && state.anamnesisFile) {
        // Show loading
        elements.loadingMessage.style.display = 'block';
        showStatusMessage('Preparando archivos...');

        // Upload files to server
        uploadFiles();
    }
}

async function uploadFiles() {
    const formData = new FormData();
    formData.append('evolution', state.evolutionFile);
    formData.append('anamnesis', state.anamnesisFile);

    try {
        showStatusMessage('Subiendo archivos al servidor...');

        // Subir archivos al servidor
        const response = await fetch(window.urlHelper.buildUrl('/upload-generation'), {
            method: 'POST',
            body: formData
        });

        if (response.redirected) {
            window.location.href = response.url;
            return;
        }

        if (!response.ok) {
            throw new Error('Error al subir archivos');
        }

        const data = await response.json();
        console.log('[GENERATE] Respuesta del servidor:', data);
        console.log('[GENERATE] Token recibido (generationId):', data.generationId);

        if (!data.generationId) {
            console.error('[GENERATE] ERROR: No se recibió generationId del servidor!');
            alert('Error: No se recibió el identificador de generación del servidor.');
            return;
        }

        // Navegar a preview-generar con token en URL (similar a simplificación)
        const targetUrl = `/preview-generar?token=${data.generationId}`;
        console.log('[GENERATE] Navegando a:', targetUrl);
        showStatusMessage('Archivos listos. Redirigiendo...');

        setTimeout(() => {
            window.urlHelper.navigateTo(targetUrl);
        }, 500);

    } catch (error) {
        console.error('Error uploading files:', error);
        elements.loadingMessage.style.display = 'none';
        showStatusMessage('Error al subir los archivos. Inténtalo de nuevo.', 'error');
    }
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}

// ============================================
// Initialization
// ============================================

function init() {
    // Check if elements exist (page might not have loaded fully)
    if (!elements.evolutionInput || !elements.anamnesisInput) {
        console.warn('Generate page elements not found');
        return;
    }

    // Setup file uploads
    setupFileUpload(
        elements.evolutionRow,
        elements.evolutionInput,
        elements.evolutionStatus,
        'evolution'
    );

    setupFileUpload(
        elements.anamnesisRow,
        elements.anamnesisInput,
        elements.anamnesisStatus,
        'anamnesis'
    );
}

// Run initialization when DOM is ready
document.addEventListener('DOMContentLoaded', init);
