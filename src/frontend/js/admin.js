/**
 * GALENO-IA - Admin Panel Logic
 */

// Elementos DOM
const usersTableBody = document.getElementById('usersTableBody');
const userModal = document.getElementById('userModal');
const userForm = document.getElementById('userForm');
const modalTitle = document.getElementById('modalTitle');
const searchInput = document.getElementById('userDetailsSearch');

// Estado
let allUsers = [];

/**
 * Helper: obtiene el token CSRF del meta tag inyectado por el servidor.
 */
function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.content : '';
}

// Inicialización
// Inicialización
document.addEventListener('DOMContentLoaded', () => {
    // Check if elements exist before proceeding
    if (!usersTableBody) return;

    // ✅ VERIFICACIÓN DE ADMIN USANDO authManager
    // Esperar a que authManager esté disponible (cargado por auth.js)
    if (typeof window.authManager === 'undefined') {
        console.error('authManager no disponible. Verifica que auth.js se cargue primero.');
        alert('Error de inicialización. Recarga la página.');
        return;
    }

    const currentUser = window.authManager.getCurrentUser();

    // Verificar autenticación
    if (!currentUser) {
        alert('Sesión no válida. Por favor, inicia sesión nuevamente.');
        window.urlHelper.navigateTo('/login');
        return;
    }

    // Verificar rol de admin
    if (currentUser.role !== 'admin') {
        console.error('Acceso denegado. Rol actual:', currentUser.role);
        alert('Acceso denegado: Necesitas privilegios de administrador.\nTu rol actual: ' + currentUser.role);
        window.urlHelper.navigateTo('/');
        return;
    }

    // ✅ Usuario es admin, continuar
    console.log('Admin verificado:', currentUser.firstName);
    loadUsers();
    setupSearch();
});

// Cargar Usuarios
async function loadUsers() {
    try {
        const response = await window.urlHelper.fetchWithBasePath('/api/users');
        if (!response.ok) throw new Error('Error cargando usuarios');
        allUsers = await response.json();
        renderUsers(allUsers);
    } catch (error) {
        console.error(error);
        if (usersTableBody)
            usersTableBody.innerHTML = '<tr><td colspan="6" class="error-text">Error al cargar usuarios.</td></tr>';
    }
}

// Renderizar Tabla
function renderUsers(users) {
    if (!usersTableBody) return;
    usersTableBody.innerHTML = '';

    if (users.length === 0) {
        usersTableBody.innerHTML = '<tr><td colspan="6" class="text-center">No hay usuarios encontrados.</td></tr>';
        return;
    }

    users.forEach(user => {
        const row = document.createElement('tr');

        // Badge para el rol
        let roleBadgeClass = 'badge-user';
        let roleLabel = 'Doctor';
        if (user.role === 'admin') { roleBadgeClass = 'badge-admin'; roleLabel = 'Administrador'; }
        if (user.role === 'tester') { roleBadgeClass = 'badge-tester'; roleLabel = 'Tester'; }

        row.innerHTML = `
            <td>#${user.id}</td>
            <td class="font-medium">${user.firstName} ${user.lastName}</td>
            <td>${user.email}</td>
            <td><span class="role-badge ${roleBadgeClass}">${roleLabel}</span></td>
            <td>${user.institution || '-'}</td>
            <td class="actions-cell">
                <button class="btn-icon edit" onclick="window.adminManager.openEditModal(${user.id})" title="Editar">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn-icon delete" onclick="window.adminManager.deleteUser(${user.id}, '${user.email}')" title="Eliminar">
                    <i class="fas fa-trash-alt"></i>
                </button>
            </td>
        `;
        usersTableBody.appendChild(row);
    });
}

// Filtrado
function setupSearch() {
    if (!searchInput) return;
    searchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const filtered = allUsers.filter(user =>
            user.firstName.toLowerCase().includes(term) ||
            user.lastName.toLowerCase().includes(term) ||
            user.email.toLowerCase().includes(term)
        );
        renderUsers(filtered);
    });
}

// Modal Logic
function openCreateModal() {
    if (!userModal) return;
    modalTitle.textContent = 'Invitar Usuario';
    userForm.reset();
    document.getElementById('userId').value = '';
    // Para invitaciones: ocultar nombre/apellido/password
    document.getElementById('nameRow').style.display = 'none';
    document.getElementById('passwordGroup').style.display = 'none';
    document.getElementById('inviteHelpText').style.display = 'block';
    document.getElementById('firstName').required = false;
    document.getElementById('lastName').required = false;
    document.getElementById('password').required = false;
    document.getElementById('email').readOnly = false;
    document.getElementById('saveUserBtn').textContent = '📧 Enviar Invitación';
    userModal.style.display = 'block';
}

function openEditModal(userId) {
    if (!userModal) return;
    const user = allUsers.find(u => u.id === userId);
    if (!user) return;

    modalTitle.textContent = 'Editar Usuario';
    document.getElementById('userId').value = user.id;
    // Para edición: mostrar todos los campos
    document.getElementById('nameRow').style.display = 'flex';
    document.getElementById('passwordGroup').style.display = 'block';
    document.getElementById('inviteHelpText').style.display = 'none';
    document.getElementById('firstName').value = user.firstName;
    document.getElementById('lastName').value = user.lastName;
    document.getElementById('firstName').required = true;
    document.getElementById('lastName').required = true;
    document.getElementById('email').value = user.email;
    document.getElementById('email').readOnly = true;
    document.getElementById('role').value = user.role;
    document.getElementById('institution').value = user.institution || '';

    document.getElementById('password').required = false;
    document.getElementById('password').value = '';
    document.getElementById('saveUserBtn').textContent = 'Guardar Cambios';

    userModal.style.display = 'block';
}

function closeUserModal() {
    if (userModal) userModal.style.display = 'none';
}

function toggleModalPassword() {
    const input = document.getElementById('password');
    const icon = document.getElementById('modalEyeIcon');
    if (input.type === 'password') {
        input.type = 'text';
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
    } else {
        input.type = 'password';
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
    }
}

// CRUD Operations
if (userForm) {
    userForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const userId = document.getElementById('userId').value;
        const isEdit = !!userId;
        const csrfToken = getCsrfToken();

        if (isEdit) {
            // Modo edición: usar PUT /api/users/:id
            const formData = {
                firstName: document.getElementById('firstName').value,
                lastName: document.getElementById('lastName').value,
                email: document.getElementById('email').value,
                role: document.getElementById('role').value,
                institution: document.getElementById('institution').value,
                password: document.getElementById('password').value
            };

            try {
                const response = await window.urlHelper.fetchWithBasePath(`/api/users/${userId}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRF-Token': csrfToken
                    },
                    body: JSON.stringify(formData)
                });

                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.error || error.message || 'Error al guardar');
                }

                closeUserModal();
                loadUsers();
                alert('Usuario actualizado correctamente');
            } catch (error) {
                alert(error.message);
            }
        } else {
            // Modo invitación: usar POST /api/admin/invite
            const inviteData = {
                email: document.getElementById('email').value,
                role: document.getElementById('role').value,
                institution: document.getElementById('institution').value
            };

            try {
                const btn = document.getElementById('saveUserBtn');
                btn.disabled = true;
                btn.textContent = '⏳ Enviando...';

                const response = await window.urlHelper.fetchWithBasePath('/api/admin/invite', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRF-Token': csrfToken
                    },
                    body: JSON.stringify(inviteData)
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || data.message || 'Error al enviar invitación');
                }

                closeUserModal();
                alert(data.message || 'Invitación enviada correctamente');
            } catch (error) {
                alert(error.message);
                const btn = document.getElementById('saveUserBtn');
                btn.disabled = false;
                btn.textContent = '📧 Enviar Invitación';
            }
        }
    });
}

function deleteUser(id, email) {
    if (!confirm(`¿Estás seguro de que deseas eliminar al usuario ${email}?`)) return;

    // Use async/await IIFE because deleteUser assumes context
    (async () => {
        try {
            const response = await window.urlHelper.fetchWithBasePath(`/api/users/${id}`, {
                method: 'DELETE',
                headers: {
                    'X-CSRF-Token': getCsrfToken()
                }
            });
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Error al eliminar');
            }
            loadUsers();
        } catch (error) {
            alert(error.message);
        }
    })();
}

function logout() {
    window.urlHelper.fetchWithBasePath('/api/logout', {
        method: 'POST',
        headers: {
            'X-CSRF-Token': getCsrfToken()
        }
    })
        .then(() => window.urlHelper.navigateTo('/login'));
}

// Cerrar modal al hacer clic fuera
window.onclick = function (event) {
    if (userModal && event.target == userModal) {
        closeUserModal();
    }
}

// Global functions for inline HTML calls (onclick="...")
window.adminManager = {
    openCreateModal,
    openEditModal,
    closeUserModal,
    toggleModalPassword,
    deleteUser,
    logout,
    // also expose loadUsers if needed
    loadUsers
};

// Expose global functions to window so onclick works (simplest migration)
window.openCreateModal = openCreateModal;
window.closeUserModal = closeUserModal;
window.toggleModalPassword = toggleModalPassword;
// Note: openEditModal and deleteUser were modified in the HTML string construction in renderUsers to use window.adminManager
// BUT the original HTML might have other onclicks.
// The renderUsers I wrote above uses `window.adminManager.openEditModal`.
// But there is a "Nuevo Usuario" button with `onclick="openCreateModal()"`.
// So I need to expose them globally or update the HTML to use `adminManager`.
// I will expose them globally to avoid breaking existing HTML onclicks that I might not update immediately if I miss one.
