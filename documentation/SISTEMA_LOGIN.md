# Sistema de Login - SIMPLIMED

## 📋 Descripción

Se ha implementado un sistema de autenticación completo y profesional para SIMPLIMED. El sistema protege todas las páginas principales y requiere que los usuarios inicien sesión antes de acceder a la aplicación.

## 🔐 Credenciales de Acceso

### Usuario Predefinido

- **Email:** lmolino@ujaen.es
- **Contraseña:** lmolino
- **Nombre:** Lucas
- **Apellidos:** Molino Piñar
- **Rol:** Administrador
- **Institución:** Universidad de Jaén - SINAI

## 📁 Archivos Creados/Modificados

### Nuevos Archivos

1. **`/src/frontend/views/login.html`**
   - Página de inicio de sesión con diseño moderno
   - Formulario de login con validación
   - Animaciones y efectos visuales
   - Diseño responsive

2. **`/src/frontend/js/auth.js`**
   - Gestor de autenticación (AuthManager)
   - Validación de credenciales
   - Gestión de sesiones con localStorage
   - Protección de páginas
   - Manejo del menú de usuario

### Archivos Modificados

3. **`/src/frontend/css/styles.css`**
   - Estilos para la página de login
   - Estilos para el menú de usuario en el header
   - Animaciones y efectos visuales
   - Diseño responsive

4. **`/src/frontend/views/index.html`**
   - Agregado script de autenticación

5. **`/src/frontend/views/preview.html`**
   - Agregado script de autenticación

6. **`/src/frontend/views/performance.html`**
   - Agregado script de autenticación
   - Corregida estructura HTML
   - Actualizado footer

## 🚀 Características Implementadas

### Sistema de Autenticación

- ✅ Validación de credenciales
- ✅ Gestión de sesiones con localStorage
- ✅ Expiración de sesión (24 horas)
- ✅ Opción "Recordarme"
- ✅ Protección automática de páginas
- ✅ Redirección a login si no está autenticado
- ✅ Redirección a inicio si ya está autenticado

### Interfaz de Usuario

- ✅ Página de login moderna y elegante
- ✅ Formulario con validación en tiempo real
- ✅ Mensajes de error animados
- ✅ Indicador de carga al iniciar sesión
- ✅ Toggle para mostrar/ocultar contraseña
- ✅ Diseño totalmente responsive
- ✅ Animaciones suaves y profesionales

### Menú de Usuario

- ✅ Avatar del usuario en el header
- ✅ Nombre completo del usuario
- ✅ Email del usuario
- ✅ Botón de cerrar sesión
- ✅ Confirmación antes de cerrar sesión
- ✅ Diseño responsive (se adapta en móviles)

### Seguridad

- ✅ Validación de sesión en cada página
- ✅ Expiración automática de sesión
- ✅ Protección contra acceso no autorizado
- ✅ Limpieza de datos al cerrar sesión

## 🎨 Características Visuales

### Página de Login

- Gradiente de fondo atractivo (púrpura/azul)
- Círculos animados en el fondo
- Tarjeta de login con sombra y animación de entrada
- Logo con efecto de gradiente
- Icono de corazón con animación de latido
- Inputs con iconos y efectos de focus
- Botón con gradiente y efectos hover
- Animación "shake" para errores
- Loader animado durante el proceso de login

### Menú de Usuario

- Diseño con efecto glassmorphism
- Avatar circular
- Información del usuario clara
- Botón de logout con efectos hover
- Adaptación automática en dispositivos móviles

## 📱 Responsive Design

El sistema es completamente responsive:

- **Desktop:** Vista completa con todos los detalles
- **Tablet:** Vista adaptada con elementos principales
- **Mobile:** Vista optimizada con elementos esenciales

## 🔄 Flujo de Autenticación

1. Usuario accede a cualquier página protegida (/, /performance, /preview)
2. Si no está autenticado → Redirige a /login
3. Usuario ingresa credenciales en /login
4. Sistema valida credenciales
5. Si son correctas:
   - Crea sesión en localStorage
   - Muestra mensaje de éxito
   - Redirige a página principal (/)
6. Si son incorrectas:
   - Muestra mensaje de error con animación
   - Permite reintentar

## 🔧 Configuración Técnica

### AuthManager (Gestor de Autenticación)

```javascript
const authManager = new AuthManager();

// Métodos disponibles:
authManager.login(email, password, rememberMe)
authManager.logout()
authManager.checkSession()
authManager.getCurrentUser()
authManager.isAuthenticated()
authManager.requireAuth()
```

### Páginas Protegidas

Las siguientes páginas requieren autenticación:
- `/` (Inicio)
- `/performance` (¿Cómo Funciona?)
- `/preview` (Previsualización)

### Duración de Sesión

- **Predeterminada:** 24 horas
- La sesión se verifica automáticamente en cada carga de página
- La sesión expira automáticamente después del tiempo configurado

## 🎯 Agregar Nuevos Usuarios

Para agregar nuevos usuarios, edita el archivo `/src/frontend/js/auth.js`:

```javascript
const USERS_DATABASE = [
    {
        id: 1,
        email: 'lmolino@ujaen.es',
        password: 'lmolino',
        firstName: 'Lucas',
        lastName: 'Molino Piñar',
        role: 'admin',
        institution: 'Universidad de Jaén - SINAI'
    },
    // Agregar más usuarios aquí
    {
        id: 2,
        email: 'nuevo@ejemplo.com',
        password: 'contraseña',
        firstName: 'Nombre',
        lastName: 'Apellidos',
        role: 'user',
        institution: 'Institución'
    }
];
```

## ⚠️ Consideraciones de Seguridad

**IMPORTANTE:** Este sistema está diseñado para desarrollo/demostración. Para producción, se recomienda:

1. ✅ Implementar autenticación en el backend
2. ✅ Usar hashing para contraseñas (bcrypt, argon2)
3. ✅ Implementar tokens JWT
4. ✅ Usar HTTPS
5. ✅ Implementar rate limiting
6. ✅ Agregar autenticación de dos factores (2FA)
7. ✅ Validación en el servidor
8. ✅ Protección CSRF

## 🎨 Personalización

### Colores del Login

Para cambiar los colores del gradiente, edita en `/src/frontend/css/styles.css`:

```css
.login-page {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.btn-login {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}
```

### Duración de Sesión

Para cambiar la duración de la sesión, edita en `/src/frontend/js/auth.js`:

```javascript
const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 horas (en milisegundos)
```

## 📞 Soporte

Para cualquier problema o pregunta sobre el sistema de autenticación, contacta a:
- **Email:** lmolino@ujaen.es
- **Institución:** SINAI - Universidad de Jaén

## ✨ Características Futuras Sugeridas

- [ ] Recuperación de contraseña por email
- [ ] Registro de nuevos usuarios
- [ ] Verificación de email
- [ ] Autenticación de dos factores (2FA)
- [ ] Historial de sesiones
- [ ] Gestión de perfiles de usuario
- [ ] Roles y permisos avanzados
- [ ] Integración con OAuth (Google, Microsoft)
- [ ] Logs de auditoría

---

**Desarrollado por:** Lucas Molino Piñar  
**Institución:** SINAI - Universidad de Jaén  
**Fecha:** 2024


