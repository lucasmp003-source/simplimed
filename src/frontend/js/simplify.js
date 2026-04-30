/**
 * GALENO-IA - Simplify Report Page JavaScript
 * Handles file uploads and redirection for the simplification tool.
 */

function handleFileUpload(input) {
    const file = input.files[0];
    if (file && file.type === 'application/pdf') {
        uploadFile(file);
    } else {
        alert('Por favor, sube un archivo PDF');
    }
}

function handleDrop(event) {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') {
        uploadFile(file);
    } else {
        document.getElementById('status-message').textContent = 'Por favor, sube un archivo PDF válido.';
    }
}

function uploadFile(file) {
    document.getElementById('loading-message').style.display = 'block';
    document.getElementById('status-message').textContent = 'Subiendo el archivo...';

    const formData = new FormData();
    formData.append('file', file);

    window.urlHelper.fetchWithBasePath('/upload', {
        method: 'POST',
        body: formData
    })
        .then(response => {
            if (response.redirected) {
                window.location.href = response.url;
                return;
            }
            return response.json();
        })
        .then(data => {
            if (!data) return; // Stop if redirected
            document.getElementById('loading-message').style.display = 'none';

            if (data.fileName) {
                document.getElementById('status-message').textContent = 'Archivo subido exitosamente.';
                window.urlHelper.navigateTo(`/preview-simplificar?fileName=${data.fileName}`);
            } else {
                document.getElementById('status-message').textContent = 'Error al subir el archivo.';
            }
        })
        .catch(error => {
            console.error('Error en la subida del archivo:', error);
            document.getElementById('loading-message').style.display = 'none';
            document.getElementById('status-message').textContent = 'Hubo un problema al procesar el archivo. Inténtalo de nuevo.';
        });
}

// Prevenir comportamiento por defecto
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    const uploadCard = document.querySelector('.upload-card');
    if (uploadCard) {
        uploadCard.addEventListener(eventName, e => e.preventDefault());
    }
});

const uploadCard = document.querySelector('.upload-card');
if (uploadCard) {
    uploadCard.addEventListener('drop', handleDrop);
    uploadCard.addEventListener('dragover', event => event.preventDefault());
}
