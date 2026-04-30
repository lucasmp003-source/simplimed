/**
 * GALENO-IA - Reset Password Logic
 */

let resetToken = null;

document.addEventListener('DOMContentLoaded', async function () {
    // Obtener token de la URL
    const urlParams = new URLSearchParams(window.location.search);
    resetToken = urlParams.get('token');

    const loadingState = document.getElementById('loading-state');
    const invalidToken = document.getElementById('invalid-token');
    const resetForm = document.getElementById('reset-password-form');
    const userEmailDisplay = document.getElementById('user-email-display');

    if (!resetToken) {
        showInvalidToken('No se proporcionó un token de recuperación válido.');
        return;
    }

    // Verificar token con el servidor
    try {
        const response = await window.urlHelper.fetchWithBasePath('/api/verify-reset-token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ token: resetToken })
        });

        const data = await response.json();

        loadingState.style.display = 'none';

        if (data.valid) {
            // Token válido - mostrar formulario
            if (userEmailDisplay) {
                userEmailDisplay.textContent = `Crear nueva contraseña para: ${data.email}`;
            }
            if (resetForm) {
                resetForm.style.display = 'block';
            }
            setupFormHandlers();
        } else {
            // Token inválido
            showInvalidToken(data.message);
        }
    } catch (error) {
        loadingState.style.display = 'none';
        showInvalidToken('Error al verificar el enlace. Inténtalo de nuevo.');
    }

    function showInvalidToken(message) {
        loadingState.style.display = 'none';
        const msgElement = document.getElementById('invalid-token-message');
        if (msgElement) msgElement.textContent = message;
        if (invalidToken) invalidToken.style.display = 'block';
    }

    function setupFormHandlers() {
        const form = document.getElementById('reset-password-form');
        const passwordInput = document.getElementById('password');
        const confirmPasswordInput = document.getElementById('confirm-password');
        const togglePasswordBtn = document.getElementById('toggle-password');
        const toggleConfirmPasswordBtn = document.getElementById('toggle-confirm-password');
        const btnSubmit = document.getElementById('btn-submit');
        const errorMessage = document.getElementById('error-message');
        const errorText = document.getElementById('error-text');
        const successMessage = document.getElementById('success-message');
        const successText = document.getElementById('success-text');

        if (!form) return;

        // Toggle mostrar/ocultar contraseña
        if (togglePasswordBtn) {
            togglePasswordBtn.addEventListener('click', function () {
                const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
                passwordInput.setAttribute('type', type);
                togglePasswordBtn.textContent = type === 'password' ? '👁️' : '🙈';
            });
        }

        if (toggleConfirmPasswordBtn) {
            toggleConfirmPasswordBtn.addEventListener('click', function () {
                const type = confirmPasswordInput.getAttribute('type') === 'password' ? 'text' : 'password';
                confirmPasswordInput.setAttribute('type', type);
                toggleConfirmPasswordBtn.textContent = type === 'password' ? '👁️' : '🙈';
            });
        }

        // Validación de contraseñas en tiempo real
        if (confirmPasswordInput) {
            confirmPasswordInput.addEventListener('input', function () {
                if (confirmPasswordInput.value && passwordInput.value !== confirmPasswordInput.value) {
                    confirmPasswordInput.setCustomValidity('Las contraseñas no coinciden');
                } else {
                    confirmPasswordInput.setCustomValidity('');
                }
            });
        }

        form.addEventListener('submit', async function (e) {
            e.preventDefault();

            const password = passwordInput.value;
            const confirmPassword = confirmPasswordInput.value;

            // Validar que las contraseñas coincidan
            if (password !== confirmPassword) {
                showError('Las contraseñas no coinciden');
                return;
            }

            // Validar longitud
            if (password.length < 6) {
                showError('La contraseña debe tener al menos 6 caracteres');
                return;
            }

            // Limpiar mensajes
            errorMessage.style.display = 'none';
            successMessage.style.display = 'none';

            // Deshabilitar botón y mostrar loader
            btnSubmit.disabled = true;
            btnSubmit.querySelector('span:first-child').style.display = 'none';
            btnSubmit.querySelector('.btn-loader').style.display = 'inline-block';

            try {
                const response = await window.urlHelper.fetchWithBasePath('/api/reset-password', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        token: resetToken,
                        newPassword: password
                    })
                });

                const data = await response.json();

                if (data.success) {
                    showSuccess(data.message);
                    passwordInput.value = '';
                    confirmPasswordInput.value = '';

                    // Redirigir al login después de 2 segundos
                    setTimeout(() => {
                        window.urlHelper.navigateTo('/login');
                    }, 2000);
                } else {
                    showError(data.message);
                    btnSubmit.disabled = false;
                    btnSubmit.querySelector('span:first-child').style.display = 'inline';
                    btnSubmit.querySelector('.btn-loader').style.display = 'none';
                }

            } catch (error) {
                showError('Error al restablecer la contraseña. Inténtalo de nuevo.');
                btnSubmit.disabled = false;
                btnSubmit.querySelector('span:first-child').style.display = 'inline';
                btnSubmit.querySelector('.btn-loader').style.display = 'none';
            }
        });

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
            btnSubmit.innerHTML = '<span>✓ Contraseña Actualizada</span>';
        }
    }

    // Animación de entrada
    setTimeout(() => {
        document.querySelector('.reset-password-card').classList.add('show');
    }, 100);
});
