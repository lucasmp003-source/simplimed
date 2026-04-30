# DOCUMENTACIÓN TÉCNICA - GALENO-IA

## 1. OBJETIVO
- Proporcionar una plataforma robusta para la simplificación de informes médicos cardiológicos usando inteligencia artificial, cumpliendo máxima seguridad y facilidad de uso.

## 2. ARQUITECTURA Y COMPONENTES
- Backend Node.js/Express (gestión de usuarios, autenticación hash bcrypt, endpoints REST, gestión de recuperación)
- Frontend HTML, CSS y JS plano (formularios login, recuperación…)
- Envío de emails vía SMTP (Nodemailer), configurable por entorno

## 3. FLUJOS PRINCIPALES DE USUARIO
1. Inicio de sesión seguro (hash bcrypt, tokens, endpoints protegidos)
2. Solicitud y restablecimiento de contraseña con email (token seguro, expiración 1h, un solo uso)
3. Carga y procesamiento de informes PDF cardiológicos
4. Descarga de versión simplificada generada por IA

## 4. ENDPOINTS (resumidos claves)
- `POST /api/login` — Login seguro
- `POST /api/forgot-password` — Inicia flujo de recuperación
- `POST /api/verify-reset-token` — Valida el token recibido por email
- `POST /api/reset-password` — Permite establecer nueva contraseña
- (Ver código fuente para endpoints adicionales)

## 5. SEGURIDAD
- Contraseñas siempre cifradas (bcrypt)
- Tokens firmados, seguros, con expiración y borrado automático
- Prevención de enumeración de usuarios
- Validaciones dobles tanto en frontend como en backend
- TODO acceso crítico sólo por backend; nunca contraseñas en frontend

## 6. USUARIOS Y ROLES
- `admin`: usuario completo (gestión total)
- `user`: carga, descarga, recuperación y consulta

Usuarios de ejemplo:
- lmolino@ujaen.es / lmolino (admin)
- mcdiaz@ujaen.es / mcdiaz (user)
- maite@ujaen.es / maite (user)

## 7. FLUJO DE RECUPERACIÓN DE CONTRASEÑA
1. Solicitud desde login → email con enlace único
2. Backend valida, frontend muestra formularios
3. Validaciones multiplataforma (token, fuerza password)
4. Éxito: nueva contraseña cifrada

## 8. PRUEBAS Y MANTENIMIENTO
- Scripts de verificación incluidos (`test-recuperacion.sh`)
- Pruebas manuales y automáticas de flujos críticos
- Consultar scripts adicionales y documentación del código para detalles

## 9. CONTACTO TÉCNICO
- Responsable técnico: lmolino@ujaen.es
- Código, incidencias y sugerencias: contactar preferentemente por email o plataforma de tickets SIPE-SINAI (si aplica)

---
Para cuestiones legales, consulta DOCUMENTACION_LEGAL.md



