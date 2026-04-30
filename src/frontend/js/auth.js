/**
 * GALENO-IA - Autenticación y Gestión de Sesión (Cliente)
 * 
 * Maneja: formulario de login, menú de usuario en header, logout.
 * 
 * Seguridad (OWASP 2026):
 * - XSS: toda inyección en DOM usa textContent o escapeHtml()
 * - CSRF: todos los fetch POST/PUT/DELETE incluyen header X-CSRF-Token
 * - Timeout: fetch con AbortController (10 segundos)
 * - Datos del usuario en closure privado (no en window global)
 * - Auto-logout por inactividad (30 minutos)
 * - Sin logs de datos sensibles en consola
 */

(function () {
    'use strict';

    // ==========================================
    // CONSTANTES DE SEGURIDAD
    // ==========================================
    const FETCH_TIMEOUT_MS = 10000;          // 10 segundos
    const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutos

    // ==========================================
    // CLOSURE PRIVADO: Datos del usuario
    // ==========================================
    // Los datos mínimos del usuario se inyectan desde el servidor como window.__GALENO_INIT__
    // Los consumimos y limpiamos inmediatamente para no dejarlos accesibles globalmente
    // ==========================================
    // CLOSURE PRIVADO: Datos del usuario
    // ==========================================
    // Los datos se obtienen una sola vez mediante un getter seguro que se autodestruye
    let _userData = null;
    if (typeof window.__GET_GALENO_INIT__ === 'function') {
        try {
            const data = window.__GET_GALENO_INIT__();
            if (data) {
                _userData = Object.freeze({ ...data });
            }
        } catch (e) {
            console.error('Error initializing user data');
        }
    } else if (window.__GALENO_INIT__) {
        // Fallback por si acaso (aunque el backend ya no debería enviarlo así)
        _userData = Object.freeze({ ...window.__GALENO_INIT__ });
        delete window.__GALENO_INIT__;
    }

    // ==========================================
    // UTILIDADES DE SEGURIDAD
    // ==========================================

    /**
     * Sanitiza texto para prevenir inyección XSS.
     * Convierte caracteres peligrosos en entidades HTML.
     * @param {string} text - Texto a sanitizar
     * @returns {string} Texto seguro para inyección en HTML
     */
    function escapeHtml(text) {
        if (!text || typeof text !== 'string') return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Obtiene el token CSRF del meta tag inyectado por el servidor.
     * @returns {string} Token CSRF o cadena vacía
     */
    function getCsrfToken() {
        const meta = document.querySelector('meta[name="csrf-token"]');
        return meta ? meta.content : '';
    }

    /**
     * Realiza un fetch seguro con:
     * - Timeout de 10 segundos (AbortController)
     * - Token CSRF automático en POST/PUT/DELETE
     * - Manejo de errores de red específicos
     * 
     * @param {string} url - URL relativa (se ajusta con urlHelper)
     * @param {object} options - Opciones de fetch
     * @returns {Promise<Response>}
     */
    async function secureFetch(url, options = {}) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

        // Añadir token CSRF a métodos que modifican estado
        const method = (options.method || 'GET').toUpperCase();
        if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
            options.headers = {
                ...options.headers,
                'X-CSRF-Token': getCsrfToken()
            };
        }

        options.signal = controller.signal;

        try {
            const response = await window.urlHelper.fetchWithBasePath(url, options);
            clearTimeout(timeoutId);

            // MANEJO GLOBAL DE 401 (Sesión/Token Expirado)
            if (response.status === 401) {
                // Si el servidor devuelve 401, significa que la sesión o el token CSRF han expirado.
                // Redirigir al login inmediatamente para evitar estado inconsistente.
                console.warn('Sesión expirada (401). Redirigiendo al login...');

                // Opcional: Podríamos mostrar un mensaje antes, pero la redirección es más segura
                window.urlHelper.navigateTo('/login?expired=true');
                return response; // Devolver response para que el caller pueda detener ejecución si quiere
            }

            return response;
        } catch (error) {
            clearTimeout(timeoutId);

            if (error.name === 'AbortError') {
                throw new Error('TIMEOUT');
            }

            throw new Error('NETWORK_ERROR');
        }
    }

    /**
     * Traduce errores de red a mensajes para el usuario.
     * @param {Error} error
     * @returns {string}
     */
    function getNetworkErrorMessage(error) {
        switch (error.message) {
            case 'TIMEOUT':
                return 'El servidor no responde. Verifica tu conexión e inténtalo de nuevo.';
            case 'NETWORK_ERROR':
                return 'Error de conexión. Verifica que estás conectado a Internet.';
            default:
                return 'Error de conexión con el servidor.';
        }
    }

    // ==========================================
    // AUTO-LOGOUT POR INACTIVIDAD
    // ==========================================
    let inactivityTimer = null;

    function resetInactivityTimer() {
        if (inactivityTimer) clearTimeout(inactivityTimer);

        if (_userData) {
            inactivityTimer = setTimeout(async () => {
                try {
                    await secureFetch('/api/logout', { method: 'POST' });
                } catch (e) {
                    // Silenciar errores en logout automático
                }
                window.urlHelper.navigateTo('/login');
            }, INACTIVITY_TIMEOUT_MS);
        }
    }

    // Escuchar eventos de actividad del usuario
    if (_userData) {
        const activityEvents = ['mousedown', 'keydown', 'scroll', 'touchstart'];
        activityEvents.forEach(event => {
            document.addEventListener(event, resetInactivityTimer, { passive: true });
        });
        resetInactivityTimer(); // Iniciar el timer
    }

    // ==========================================
    // INICIALIZACIÓN
    // ==========================================
    document.addEventListener('DOMContentLoaded', function () {
        // 1. Handle Login Form (si estamos en la página de login)
        const loginForm = document.getElementById('login-form');
        if (loginForm) {
            initLoginPage(loginForm);
        }

        // 2. Handle User Menu Injection (Global)
        initUserMenu();
    });

    /**
     * Inicializa la lógica de la página de login.
     */
    function initLoginPage(form) {
        const emailInput = document.getElementById('email');
        const passwordInput = document.getElementById('password');
        const btnLogin = document.getElementById('btn-login');
        const errorMessage = document.getElementById('error-message');
        const errorText = document.getElementById('error-text');
        const loginCard = document.querySelector('.login-card');

        // Mostrar la tarjeta de login con transición
        setTimeout(function () {
            if (loginCard) loginCard.classList.add('show');
        }, 100);

        form.addEventListener('submit', async function (e) {
            e.preventDefault();

            const email = emailInput.value.trim();
            const password = passwordInput.value;

            // Validación UX básica (solo formato, la lógica está en el servidor)
            if (!email || !password) return;

            // Reset UI
            errorMessage.style.display = 'none';
            btnLogin.disabled = true;
            var loader = btnLogin.querySelector('.btn-loader');
            var btnText = btnLogin.querySelector('span:not(.btn-loader)');
            if (loader) loader.style.display = 'inline-block';
            if (btnText) btnText.style.display = 'none';

            try {
                const response = await secureFetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: email, password: password })
                });

                const data = await response.json();

                if (data.success) {
                    // Redirigir al dashboard
                    window.urlHelper.navigateTo('/');
                } else {
                    showError(data.message || 'Email o contraseña incorrectos');
                }
            } catch (error) {
                showError(getNetworkErrorMessage(error));
            } finally {
                btnLogin.disabled = false;
                if (loader) loader.style.display = 'none';
                if (btnText) btnText.style.display = 'inline';
            }
        });

        function showError(message) {
            // Usar textContent para prevenir XSS
            errorText.textContent = message;
            errorMessage.style.display = 'block';
            errorMessage.classList.add('shake');
            setTimeout(function () { errorMessage.classList.remove('shake'); }, 500);
        }

        // Toggle de visibilidad de contraseña
        var toggleBtn = document.getElementById('toggle-password');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', function () {
                var type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
                passwordInput.setAttribute('type', type);
            });
        }
    }

    /**
     * Inyecta el menú de usuario en el header usando datos mínimos
     * del closure privado. Todo el contenido se sanitiza contra XSS.
     */
    function initUserMenu() {
        var container = document.querySelector('.user-menu-container');
        if (!container) return;

        if (_userData) {
            // Construir el menú de usuario con DOM API (no innerHTML con datos de usuario)
            var li = document.createElement('li');
            li.className = 'user-menu';

            var wrapper = document.createElement('div');
            wrapper.className = 'account-wrapper';

            // Avatar button
            var avatarBtn = document.createElement('button');
            avatarBtn.className = 'account-avatar';
            avatarBtn.id = 'account-avatar-btn';
            avatarBtn.setAttribute('aria-expanded', 'false');
            avatarBtn.setAttribute('aria-label', 'Menú de usuario');

            var avatarSpan = document.createElement('span');
            avatarSpan.className = 'avatar-initial';
            avatarSpan.textContent = _userData.firstName ? _userData.firstName[0].toUpperCase() : 'U';
            avatarBtn.appendChild(avatarSpan);

            // Dropdown
            var dropdown = document.createElement('div');
            dropdown.className = 'account-dropdown';
            dropdown.id = 'account-dropdown';

            // Dropdown header
            var dropdownHeader = document.createElement('div');
            dropdownHeader.className = 'dropdown-header';

            var dropdownAvatar = document.createElement('div');
            dropdownAvatar.className = 'dropdown-avatar';
            dropdownAvatar.textContent = _userData.firstName ? _userData.firstName[0].toUpperCase() : 'U';

            var dropdownInfo = document.createElement('div');
            dropdownInfo.className = 'dropdown-info';

            var greeting = document.createElement('div');
            greeting.className = 'dropdown-greeting';
            greeting.textContent = 'Hola,';

            var nameDiv = document.createElement('div');
            nameDiv.className = 'dropdown-name';
            nameDiv.textContent = escapeHtml(_userData.firstName); // Solo firstName (no lastName)

            dropdownInfo.appendChild(greeting);
            dropdownInfo.appendChild(nameDiv);

            dropdownHeader.appendChild(dropdownAvatar);
            dropdownHeader.appendChild(dropdownInfo);

            // Dropdown actions
            var actions = document.createElement('div');
            actions.className = 'dropdown-actions';

            // "Mi Cuenta" link
            var accountLink = document.createElement('a');
            accountLink.href = window.urlHelper.buildUrl('/account');
            accountLink.className = 'dropdown-action';
            accountLink.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>';
            var accountText = document.createTextNode(' Mi Cuenta');
            accountLink.appendChild(accountText);

            // Logout button
            var logoutBtn = document.createElement('button');
            logoutBtn.id = 'btn-logout';
            logoutBtn.className = 'dropdown-action dropdown-action-logout';
            logoutBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>';
            var logoutText = document.createTextNode(' Cerrar Sesión');
            logoutBtn.appendChild(logoutText);

            actions.appendChild(accountLink);
            actions.appendChild(logoutBtn);

            dropdown.appendChild(dropdownHeader);
            dropdown.appendChild(actions);

            wrapper.appendChild(avatarBtn);
            wrapper.appendChild(dropdown);
            li.appendChild(wrapper);

            container.innerHTML = ''; // Limpiar contenido previo
            container.appendChild(li);

            // Dropdown toggle logic
            if (avatarBtn && dropdown) {
                avatarBtn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var isExpanded = avatarBtn.getAttribute('aria-expanded') === 'true';
                    if (isExpanded) {
                        closeDropdown();
                    } else {
                        openDropdown();
                    }
                });

                document.addEventListener('click', function (e) {
                    if (!dropdown.contains(e.target) && !avatarBtn.contains(e.target)) {
                        closeDropdown();
                    }
                });

                document.addEventListener('keydown', function (e) {
                    if (e.key === 'Escape') {
                        closeDropdown();
                    }
                });

                function openDropdown() {
                    avatarBtn.setAttribute('aria-expanded', 'true');
                    dropdown.classList.add('open');
                    requestAnimationFrame(function () {
                        dropdown.classList.add('visible');
                    });
                }

                function closeDropdown() {
                    avatarBtn.setAttribute('aria-expanded', 'false');
                    dropdown.classList.remove('visible');
                    setTimeout(function () {
                        if (avatarBtn.getAttribute('aria-expanded') === 'false') {
                            dropdown.classList.remove('open');
                        }
                    }, 300);
                }
            }

            // Logout handler
            if (logoutBtn) {
                logoutBtn.addEventListener('click', handleLogout);
            }
        }
    }

    /**
     * Maneja el proceso de logout.
     * Envía POST al servidor con CSRF token.
     */
    async function handleLogout() {
        try {
            var response = await secureFetch('/api/logout', {
                method: 'POST'
            });

            if (response.ok) {
                window.urlHelper.navigateTo('/login');
            }
        } catch (error) {
            // Fallback: forzar redirección al login
            window.urlHelper.navigateTo('/login');
        }
    }

    // ==========================================
    // AUTH MANAGER (closure - no global)
    // ==========================================
    var authManager = {
        isAuthenticated: function () {
            return !!_userData;
        },
        getCurrentUser: function () {
            // Devolver copia congelada, no la referencia original
            return _userData ? Object.freeze({ ..._userData }) : null;
        }
    };

    // Exponer authManager al window para uso por otros módulos (account.js, etc.)
    // Nota: authManager solo expone métodos, NO datos directamente
    window.authManager = authManager;

})();
