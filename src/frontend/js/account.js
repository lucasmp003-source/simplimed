/**
 * GALENO-IA - Account Management Logic
 */

// Verificar autenticación
if (!authManager.isAuthenticated()) {
    window.urlHelper.navigateTo('/login');
}

const currentUser = authManager.getCurrentUser();

document.addEventListener('DOMContentLoaded', async function () {
    // Cargar datos del usuario
    await loadUserData();

    // Setup formulario de perfil
    setupProfileForm();

    // Setup formulario de contraseña
    setupPasswordForm();

    // Setup toggle de contraseñas
    setupPasswordToggles();

});

/**
 * Helper: obtiene el token CSRF del meta tag inyectado por el servidor.
 */
function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.content : '';
}

async function loadUserData() {
    try {
        // El servidor identifica al usuario por la sesión (cookie HttpOnly)
        const response = await window.urlHelper.fetchWithBasePath('/api/user/profile');
        const data = await response.json();

        if (data.success) {
            const user = data.user;
            document.getElementById('email').value = user.email;
            document.getElementById('firstName').value = user.firstName;
            document.getElementById('lastName').value = user.lastName;

            // Mapeo de roles
            let roleDisplay = 'Doctor'; // Default to Doctor for regular users
            if (user.role === 'admin') roleDisplay = 'Administrador';
            if (user.role === 'tester') roleDisplay = 'Tester';

            document.getElementById('role').value = roleDisplay;
            document.getElementById('institution').value = user.institution;

            // Mostrar/Ocultar Dashboard de Métricas
            const metricsCard = document.getElementById('metrics-card');
            if (user.role === 'admin' || user.role === 'tester') {
                metricsCard.style.display = 'block';
            } else {
                metricsCard.style.display = 'none';
            }

            // Mostrar/Ocultar Panel de Admin
            const adminCard = document.getElementById('admin-card');
            if (user.role === 'admin') {
                adminCard.style.display = 'block';
            } else {
                adminCard.style.display = 'none';
            }

            // Mostrar/Ocultar Panel de Anotación
            const annotationCard = document.getElementById('annotation-card');
            if (annotationCard) {
                // "user" es el rol por defecto de los doctores en la base de datos
                if (user.role === 'admin' || user.role === 'doctor' || user.role === 'user') {
                    annotationCard.style.display = 'block';
                } else {
                    annotationCard.style.display = 'none';
                }
            }
        }
    } catch (error) {
        console.error('Error al cargar datos:', error);
    }
}

function setupProfileForm() {
    const form = document.getElementById('profile-form');
    const btnUpdate = document.getElementById('btn-update-profile');
    const successMsg = document.getElementById('profile-success');
    const errorMsg = document.getElementById('profile-error');

    form.addEventListener('submit', async function (e) {
        e.preventDefault();

        const firstName = document.getElementById('firstName').value.trim();
        const lastName = document.getElementById('lastName').value.trim();

        if (!firstName || !lastName) {
            showMessage(errorMsg, 'profile-error-text', 'Por favor completa todos los campos');
            return;
        }

        // Deshabilitar botón
        btnUpdate.disabled = true;
        btnUpdate.querySelector('.btn-text').style.display = 'none';
        btnUpdate.querySelector('.btn-loader').style.display = 'inline-block';

        try {
            const response = await window.urlHelper.fetchWithBasePath('/api/user/profile', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': getCsrfToken()
                },
                body: JSON.stringify({
                    firstName,
                    lastName
                })
            });

            const data = await response.json();

            if (data.success) {
                // No se usa localStorage — los datos vienen del servidor en cada carga

                showMessage(successMsg, 'profile-success-text', 'Perfil actualizado correctamente');
                hideMessage(errorMsg);

                // Actualizar nombre en el header si existe
                const userNameElement = document.querySelector('.user-name');
                if (userNameElement) {
                    userNameElement.textContent = `${firstName} ${lastName}`;
                }
            } else {
                showMessage(errorMsg, 'profile-error-text', data.message);
                hideMessage(successMsg);
            }
        } catch (error) {
            showMessage(errorMsg, 'profile-error-text', 'Error al actualizar el perfil');
            hideMessage(successMsg);
        } finally {
            btnUpdate.disabled = false;
            btnUpdate.querySelector('.btn-text').style.display = 'inline';
            btnUpdate.querySelector('.btn-loader').style.display = 'none';
        }
    });
}

function setupPasswordForm() {
    const form = document.getElementById('password-form');
    const btnChange = document.getElementById('btn-change-password');
    const successMsg = document.getElementById('password-success');
    const errorMsg = document.getElementById('password-error');
    const newPasswordInput = document.getElementById('newPassword');
    const confirmPasswordInput = document.getElementById('confirmPassword');

    // Validación en tiempo real
    confirmPasswordInput.addEventListener('input', function () {
        if (confirmPasswordInput.value && newPasswordInput.value !== confirmPasswordInput.value) {
            confirmPasswordInput.setCustomValidity('Las contraseñas no coinciden');
        } else {
            confirmPasswordInput.setCustomValidity('');
        }
    });

    form.addEventListener('submit', async function (e) {
        e.preventDefault();

        const currentPassword = document.getElementById('currentPassword').value;
        const newPassword = newPasswordInput.value;
        const confirmPassword = confirmPasswordInput.value;

        // Validar
        if (newPassword !== confirmPassword) {
            showMessage(errorMsg, 'password-error-text', 'Las contraseñas no coinciden');
            return;
        }

        // Validar requisitos de contraseña (8 caracteres, número y símbolo)
        if (newPassword.length < 8) {
            showMessage(errorMsg, 'password-error-text', 'La contraseña debe tener al menos 8 caracteres');
            return;
        }

        if (!/\d/.test(newPassword)) {
            showMessage(errorMsg, 'password-error-text', 'La contraseña debe contener al menos un número');
            return;
        }

        if (!/[^a-zA-Z0-9\sñÑáéíóúÁÉÍÓÚ]/.test(newPassword)) {
            showMessage(errorMsg, 'password-error-text', 'La contraseña debe contener al menos un símbolo');
            return;
        }

        // Deshabilitar botón
        btnChange.disabled = true;
        btnChange.querySelector('.btn-text').style.display = 'none';
        btnChange.querySelector('.btn-loader').style.display = 'inline-block';

        try {
            const response = await window.urlHelper.fetchWithBasePath('/api/user/change-password', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': getCsrfToken()
                },
                body: JSON.stringify({
                    currentPassword,
                    newPassword
                })
            });

            const data = await response.json();

            if (data.success) {
                showMessage(successMsg, 'password-success-text', 'Contraseña actualizada. Redirigiendo al login...');
                hideMessage(errorMsg);

                // El servidor invalida todas las sesiones tras cambio de contraseña
                // Redirigir al login tras un breve delay
                setTimeout(function () {
                    window.urlHelper.navigateTo('/login');
                }, 2000);
                return;
            } else {
                showMessage(errorMsg, 'password-error-text', data.message);
                hideMessage(successMsg);
            }
        } catch (error) {
            showMessage(errorMsg, 'password-error-text', 'Error al cambiar la contraseña');
            hideMessage(successMsg);
        } finally {
            btnChange.disabled = false;
            btnChange.querySelector('.btn-text').style.display = 'inline';
            btnChange.querySelector('.btn-loader').style.display = 'none';
        }
    });
}

function setupPasswordToggles() {
    const toggleButtons = document.querySelectorAll('.toggle-password');

    toggleButtons.forEach(button => {
        button.addEventListener('click', function () {
            const targetId = this.getAttribute('data-target');
            const input = document.getElementById(targetId);
            const eyeShow = this.querySelector('.eye-show');
            const eyeHide = this.querySelector('.eye-hide');

            if (input.type === 'password') {
                input.type = 'text';
                eyeShow.style.display = 'none';
                eyeHide.style.display = 'block';
            } else {
                input.type = 'password';
                eyeShow.style.display = 'block';
                eyeHide.style.display = 'none';
            }
        });
    });
}

function showMessage(element, textId, message) {
    document.getElementById(textId).textContent = message;
    element.style.display = 'flex';
    element.classList.add('shake');
    setTimeout(() => element.classList.remove('shake'), 500);
}

function hideMessage(element) {
    element.style.display = 'none';
}
