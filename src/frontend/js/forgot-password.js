/**
 * GALENO-IA - Forgot Password Logic
 */

document.addEventListener('DOMContentLoaded', function () {
    const form = document.getElementById('forgot-password-form');
    const emailInput = document.getElementById('email');
    const btnSubmit = document.getElementById('btn-submit');
    const errorMessage = document.getElementById('error-message');
    const errorText = document.getElementById('error-text');
    const successMessage = document.getElementById('success-message');
    const successText = document.getElementById('success-text');

    if (!form) return;

    form.addEventListener('submit', async function (e) {
        e.preventDefault();

        const email = emailInput.value.trim();

        // Limpiar mensajes
        errorMessage.style.display = 'none';
        successMessage.style.display = 'none';

        // Deshabilitar botón y mostrar loader
        btnSubmit.disabled = true;
        btnSubmit.querySelector('span:first-child').style.display = 'none';
        btnSubmit.querySelector('.btn-loader').style.display = 'inline-block';

        try {
            const response = await window.urlHelper.fetchWithBasePath('/api/forgot-password', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': getCsrfToken()
                },
                body: JSON.stringify({ email })
            });

            const data = await response.json();

            if (data.success) {
                showSuccess(data.message);
                emailInput.value = '';

                // Redirigir al login después de 3 segundos
                setTimeout(() => {
                    window.urlHelper.navigateTo('/login');
                }, 3000);
            } else {
                showError(data.message);
                btnSubmit.disabled = false;
                btnSubmit.querySelector('span:first-child').style.display = 'inline';
                btnSubmit.querySelector('.btn-loader').style.display = 'none';
            }

        } catch (error) {
            showError('Error al procesar la solicitud. Inténtalo de nuevo.');
            btnSubmit.disabled = false;
            btnSubmit.querySelector('span:first-child').style.display = 'inline';
            btnSubmit.querySelector('.btn-loader').style.display = 'none';
        }
    });

    function getCsrfToken() {
        const meta = document.querySelector('meta[name="csrf-token"]');
        return meta ? meta.content : '';
    }

    function showError(message) {
        errorText.textContent = message;
        errorMessage.style.display = 'block';
        errorMessage.classList.add('shake');

        setTimeout(() => {
            errorMessage.classList.remove('shake');
        }, 500);
    }

    function showSuccess(message) {
        successText.textContent = message;
        successMessage.style.display = 'block';
        btnSubmit.classList.add('success');
        btnSubmit.innerHTML = '<span>✓ Enviado</span>';
    }

    // Animación de entrada
    setTimeout(() => {
        document.querySelector('.forgot-password-card').classList.add('show');
    }, 100);
});
