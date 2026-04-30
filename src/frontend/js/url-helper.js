/**
 * URL Helper para manejar el BASE_PATH de la aplicación
 * Permite que la aplicación funcione tanto en / como en subdirectorios como /galeno
 */

// Obtener el BASE_PATH desde window (inyectado por config.js)
function getBasePath() {
    return window.BASE_PATH || '';
}

// Construir una URL completa con el BASE_PATH
function buildUrl(path) {
    const basePath = getBasePath();
    // Asegurarse de que el path comience con /
    if (!path.startsWith('/')) {
        path = '/' + path;
    }
    return basePath + path;
}

// Hacer una llamada fetch con la URL correcta
function fetchWithBasePath(path, options = {}) {
    return fetch(buildUrl(path), options);
}

// Navegar a una ruta con el BASE_PATH
function navigateTo(path) {
    window.location.href = buildUrl(path);
}

// Exportar las funciones para uso global
window.urlHelper = {
    getBasePath,
    buildUrl,
    fetchWithBasePath,
    navigateTo
};