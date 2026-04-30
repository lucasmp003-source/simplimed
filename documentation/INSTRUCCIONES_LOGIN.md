# 🔐 Instrucciones de Uso - Sistema de Login SIMPLIMED

## ✅ Sistema Implementado Exitosamente

Se ha implementado un **sistema de login completo y profesional** para SIMPLIMED con todas las características modernas de autenticación.

---

## 🚀 Cómo Usar el Sistema

### Paso 1: Acceder a la Aplicación

1. Inicia tu servidor web
2. Navega a cualquier página de SIMPLIMED:
   - `http://tu-servidor/` (Página principal)
   - `http://tu-servidor/performance` (¿Cómo funciona?)
   - `http://tu-servidor/preview` (Previsualización)

### Paso 2: Serás Redirigido al Login

Si no has iniciado sesión, automáticamente serás redirigido a:
```
http://tu-servidor/login
```

### Paso 3: Iniciar Sesión

Usa las siguientes credenciales:

```
📧 Email: lmolino@ujaen.es
🔑 Contraseña: lmolino
```

### Paso 4: Disfrutar de la Aplicación

Después de iniciar sesión correctamente:
- ✅ Serás redirigido automáticamente a la página principal
- ✅ Verás tu información de usuario en el header (nombre, email)
- ✅ Tendrás acceso a todas las páginas de la aplicación
- ✅ Podrás cerrar sesión cuando quieras

---

## 🎯 Características del Sistema

### ✨ Página de Login Moderna

- 🎨 Diseño elegante con gradientes y animaciones
- 💫 Efectos visuales profesionales
- 📱 100% responsive (funciona en todos los dispositivos)
- 🔒 Campos de email y contraseña con validación
- 👁️ Botón para mostrar/ocultar contraseña
- ☑️ Opción "Recordarme"
- 🔗 Enlace para recuperar contraseña

### 🛡️ Seguridad

- ✅ Validación de credenciales
- ✅ Sesión segura con localStorage
- ✅ Expiración automática después de 24 horas
- ✅ Protección de todas las páginas importantes
- ✅ Redirección automática si no estás autenticado

### 👤 Menú de Usuario

Una vez autenticado, verás en el header:
- 👤 Avatar del usuario
- 📝 Nombre completo: "Lucas Molino Piñar"
- 📧 Email: "lmolino@ujaen.es"
- 🚪 Botón "Cerrar Sesión"

### 📱 Responsive Design

El sistema se adapta perfectamente a:
- 💻 Computadoras de escritorio
- 📱 Tablets
- 📱 Teléfonos móviles

---

## 🔄 Flujo de Uso

```
1. Usuario visita SIMPLIMED
   ↓
2. Sistema verifica autenticación
   ↓
3a. NO autenticado → Redirige a /login
    ↓
    Muestra formulario de login
    ↓
    Usuario ingresa credenciales
    ↓
    Sistema valida
    ↓
    3a1. Credenciales correctas → Crea sesión → Redirige a inicio
    3a2. Credenciales incorrectas → Muestra error → Permite reintentar
   
3b. SÍ autenticado → Permite acceso
    ↓
    Muestra información del usuario en header
    ↓
    Usuario puede navegar libremente
    ↓
    Usuario puede cerrar sesión cuando quiera
```

---

## 🎨 Capturas del Sistema

### Página de Login
- Fondo con gradiente púrpura/azul
- Círculos animados en el fondo
- Tarjeta blanca central con el formulario
- Logo SIMPLIMED con corazón animado
- Campos de entrada con iconos
- Botón de login con efecto hover

### Header con Usuario Autenticado
- Aparece a la derecha del menú principal
- Muestra avatar circular
- Nombre y email del usuario
- Botón de "Cerrar Sesión" con efecto hover

---

## 👨‍💻 Información del Usuario

El usuario predefinido tiene los siguientes datos:

```javascript
{
  Email: "lmolino@ujaen.es",
  Contraseña: "lmolino",
  Nombre: "Lucas",
  Apellidos: "Molino Piñar",
  Rol: "Administrador",
  Institución: "Universidad de Jaén - SINAI"
}
```

---

## 🔧 Personalización

### Agregar Más Usuarios

Edita el archivo: `/src/frontend/js/auth.js`

Busca la sección `USERS_DATABASE` y agrega nuevos usuarios:

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
    {
        id: 2,
        email: 'nuevo.usuario@ejemplo.com',
        password: 'contraseña123',
        firstName: 'Nuevo',
        lastName: 'Usuario',
        role: 'user',
        institution: 'Tu Institución'
    }
];
```

### Cambiar Colores

Edita el archivo: `/src/frontend/css/styles.css`

Busca la sección "SISTEMA DE LOGIN" y modifica los gradientes:

```css
.login-page {
    background: linear-gradient(135deg, #TU_COLOR_1 0%, #TU_COLOR_2 100%);
}
```

### Cambiar Duración de Sesión

Edita el archivo: `/src/frontend/js/auth.js`

```javascript
const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 horas
// Cambia a lo que necesites, por ejemplo:
// 1 hora = 1 * 60 * 60 * 1000
// 12 horas = 12 * 60 * 60 * 1000
// 7 días = 7 * 24 * 60 * 60 * 1000
```

---

## 📝 Archivos del Sistema

### Archivos Creados
1. ✅ `/src/frontend/views/login.html` - Página de login
2. ✅ `/src/frontend/js/auth.js` - Lógica de autenticación

### Archivos Modificados
3. ✅ `/src/frontend/css/styles.css` - Estilos agregados
4. ✅ `/src/frontend/views/index.html` - Script agregado
5. ✅ `/src/frontend/views/preview.html` - Script agregado
6. ✅ `/src/frontend/views/performance.html` - Script agregado y corregido

### Archivos de Documentación
7. ✅ `/SISTEMA_LOGIN.md` - Documentación técnica completa
8. ✅ `/INSTRUCCIONES_LOGIN.md` - Este archivo

---

## 🎓 Tips y Trucos

### Cerrar Sesión
1. Click en el botón "Cerrar Sesión" en el header
2. Confirma en el diálogo que aparece
3. Serás redirigido automáticamente a /login

### Mantener Sesión Activa
- Marca la casilla "Recordarme" al iniciar sesión
- Tu sesión se mantendrá activa por 24 horas

### Mostrar/Ocultar Contraseña
- Click en el icono 👁️ junto al campo de contraseña
- Cambia entre 👁️ (ocultar) y 🙈 (mostrar)

### Olvidé mi Contraseña
- Click en "¿Olvidaste tu contraseña?"
- Se mostrará información de contacto con el administrador

---

## ⚠️ Notas Importantes

### Seguridad en Desarrollo
- ⚠️ Este sistema usa localStorage (solo para desarrollo/demostración)
- ⚠️ Las contraseñas están en texto plano (solo para desarrollo)
- ⚠️ Para producción, implementa autenticación en el backend

### Recomendaciones para Producción
1. Implementar backend con API REST
2. Usar JWT (JSON Web Tokens)
3. Hashear contraseñas con bcrypt/argon2
4. Implementar HTTPS
5. Agregar autenticación de dos factores (2FA)
6. Usar base de datos real (PostgreSQL, MySQL, MongoDB)

---

## 🆘 Solución de Problemas

### No puedo acceder al login
- Verifica que el servidor esté corriendo
- Asegúrate de que la ruta `/login` esté configurada en tu servidor

### No me redirige después de login
- Abre la consola del navegador (F12)
- Verifica si hay errores de JavaScript
- Revisa que `/public/js/auth.js` se esté cargando correctamente

### La sesión no persiste
- Verifica que localStorage esté habilitado en tu navegador
- Limpia el localStorage: Consola → `localStorage.clear()`
- Intenta iniciar sesión nuevamente

### El diseño se ve mal
- Verifica que `/public/css/styles.css` se esté cargando
- Limpia la caché del navegador (Ctrl+Shift+R)
- Revisa la consola del navegador por errores de CSS

---

## 📞 Contacto y Soporte

**Desarrollador:** Lucas Molino Piñar  
**Email:** lmolino@ujaen.es  
**Institución:** SINAI - Universidad de Jaén  
**Web:** https://sinai.ujaen.es

---

## 🎉 ¡Listo para Usar!

El sistema está completamente configurado y listo para usar. Solo necesitas:

1. ✅ Iniciar tu servidor web
2. ✅ Navegar a `/login`
3. ✅ Usar las credenciales: `lmolino@ujaen.es` / `lmolino`
4. ✅ ¡Disfrutar de SIMPLIMED!

---

**¡Gracias por usar SIMPLIMED!** ❤️


