/**
 * GALENO-IA - Complete Registration Logic
 */

(function () {
    'use strict';

    let invitationToken = null;

    document.addEventListener('DOMContentLoaded', async function () {
        const urlParams = new URLSearchParams(window.location.search);
        invitationToken = urlParams.get('token');

        // Limpiar el token de la URL inmediatamente para evitar que se comparta
        if (invitationToken) {
            const newUrl = window.location.pathname;
            window.history.replaceState({}, document.title, newUrl);
        }

        const loadingState = document.getElementById('loading-state');
        const invalidToken = document.getElementById('invalid-token');
        const registrationForm = document.getElementById('registration-form');

        if (!invitationToken) {
            showInvalidToken('No se proporcionó un token de invitación válido.');
            return;
        }

        // Verificar invitación con el servidor
        try {
            const response = await window.urlHelper.fetchWithBasePath(`/api/invitation/${invitationToken}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            const data = await response.json();

            loadingState.style.display = 'none';

            if (data.valid) {
                // Invitación válida - mostrar formulario
                document.getElementById('display-email').textContent = data.email;
                document.getElementById('display-role').textContent = formatRole(data.role);
                document.getElementById('display-institution').textContent = data.institution || 'N/A';
                registrationForm.style.display = 'block';
                setupFormHandlers();
            } else {
                showInvalidToken(data.message);
            }
        } catch (error) {
            loadingState.style.display = 'none';
            showInvalidToken('Error al verificar la invitación. Inténtalo de nuevo.');
        }

        function formatRole(role) {
            const roles = {
                'admin': 'Administrador',
                'tester': 'Tester',
                'user': 'Doctor (Usuario)'
            };
            return roles[role] || role;
        }

        function showInvalidToken(message) {
            loadingState.style.display = 'none';
            document.getElementById('invalid-token-message').textContent = message;
            invalidToken.style.display = 'block';
        }

        /**
         * Obtiene el token CSRF del meta tag.
         */
        function getCsrfToken() {
            const meta = document.querySelector('meta[name="csrf-token"]');
            return meta ? meta.content : '';
        }

        function setupFormHandlers() {
            const form = document.getElementById('registration-form');
            const firstNameInput = document.getElementById('firstName');
            const lastNameInput = document.getElementById('lastName');
            const passwordInput = document.getElementById('password');
            const confirmPasswordInput = document.getElementById('confirm-password');
            const btnSubmit = document.getElementById('btn-submit');
            const errorMessage = document.getElementById('error-message');
            const errorText = document.getElementById('error-text');
            const successMessage = document.getElementById('success-message');
            const successText = document.getElementById('success-text');

            // Toggle mostrar/ocultar contraseña con SVG
            document.querySelectorAll('.toggle-password').forEach(btn => {
                btn.addEventListener('click', function () {
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

            // Validación en tiempo real
            // Validación en tiempo real - Sincronizada
            function validatePasswordMatch() {
                if (confirmPasswordInput.value) {
                    if (passwordInput.value !== confirmPasswordInput.value) {
                        confirmPasswordInput.setCustomValidity('Las contraseñas no coinciden');
                    } else {
                        confirmPasswordInput.setCustomValidity('');
                    }
                } else {
                    confirmPasswordInput.setCustomValidity('');
                }
            }

            passwordInput.addEventListener('input', validatePasswordMatch);
            confirmPasswordInput.addEventListener('input', validatePasswordMatch);

            form.addEventListener('submit', async function (e) {
                e.preventDefault();

                const firstName = firstNameInput.value.trim();
                const lastName = lastNameInput.value.trim();
                const password = passwordInput.value;
                const confirmPassword = confirmPasswordInput.value;

                // Validaciones
                if (!firstName || !lastName) {
                    showError('Por favor completa tu nombre y apellidos');
                    return;
                }

                if (password !== confirmPassword) {
                    showError('Las contraseñas no coinciden');
                    return;
                }

                // Validar requisitos de contraseña
                if (password.length < 8) {
                    showError('La contraseña debe tener al menos 8 caracteres');
                    return;
                }

                if (!/\d/.test(password)) {
                    showError('La contraseña debe contener al menos un número');
                    return;
                }

                if (!/[^a-zA-Z0-9\sñÑáéíóúÁÉÍÓÚ]/.test(password)) {
                    showError('La contraseña debe contener al menos un símbolo');
                    return;
                }

                // Limpiar mensajes
                errorMessage.style.display = 'none';
                successMessage.style.display = 'none';

                // Deshabilitar botón
                btnSubmit.disabled = true;
                btnSubmit.querySelector('span:first-child').style.display = 'none';
                btnSubmit.querySelector('.btn-loader').style.display = 'inline-block';

                try {
                    const response = await window.urlHelper.fetchWithBasePath('/api/complete-registration', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRF-Token': getCsrfToken()
                        },
                        body: JSON.stringify({
                            token: invitationToken,
                            firstName,
                            lastName,
                            password
                        })
                    });

                    const data = await response.json();

                    if (data.success) {
                        showSuccess(data.message);

                        // Redirigir al login después de 2.5 segundos
                        setTimeout(() => {
                            window.urlHelper.navigateTo('/login');
                        }, 2500);
                    } else {
                        showError(data.message);
                        btnSubmit.disabled = false;
                        btnSubmit.querySelector('span:first-child').style.display = 'inline';
                        btnSubmit.querySelector('.btn-loader').style.display = 'none';
                    }

                } catch (error) {
                    showError('Error al crear la cuenta. Inténtalo de nuevo.');
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
                btnSubmit.innerHTML = '<span>✓ Cuenta Creada</span>';
            }
        }

        // Animación de entrada
        setTimeout(() => {
            document.querySelector('.registration-card').classList.add('show');
        }, 100);
    });
})();
