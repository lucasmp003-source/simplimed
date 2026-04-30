# Política de Registros de Auditoría (Audit Logs) - SIMPLIMED

**Versión**: 1.0  
**Fecha**: 15 de Febrero de 2026  
**Responsable**: Lucas - Desarrollador Principal  
**Aprobado por**: Supervisor Técnico

## 1. Objetivo

Esta política establece los requisitos para el registro, almacenamiento, protección y retención de logs de auditoría en SIMPLIMED, en cumplimiento con RGPD, LOPDGDD, Ley 41/2002 e ISO 27001.

## 2. Alcance

Aplica a todos los sistemas y componentes de SIMPLIMED que procesen datos de salud.

## 3. Eventos Registrados

### 3.1 Autenticación
- Login exitoso/fallido
- Logout
- Cambio de contraseña
- Bloqueo de cuenta

### 3.2 Acceso a Datos Médicos
- Subida de informe médico
- Visualización de informe
- Edición de simplificación
- Descarga de informe
- Eliminación de datos

### 3.3 Seguridad
- Violaciones CSRF
- Intentos de acceso no autorizado
- Rate limiting activado
- Cambios en configuración

### 3.4 Administración
- Creación/modificación/eliminación de usuarios
- Cambios en roles y permisos
- Modificación de configuración del sistema

## 4. Contenido de Cada Log

Cada entrada incluye obligatoriamente:
- Timestamp (UTC, ISO 8601)
- User ID (con email ofuscado)
- Event Type
- Action
- Outcome (SUCCESS/FAILED/ERROR)
- IP Address
- User Agent
- Resource ID (pseudonimizado con HMAC)
- Hash del log anterior (integridad)

## 5. Protección de Logs

- **Inmutabilidad**: Logs en modo append-only, no editables.
- **Cryptographic sealing**: Hash chain para detectar manipulación.
- **Cifrado**: Logs cifrados en reposo (AES-256) [Pendiente: Implementación completa].
- **Permisos**: Solo lectura para auditores, escritura solo por aplicación.
- **Segregación**: Almacenados fuera de datos de aplicación.

## 6. Retención

| Tipo de Log | Período de Retención | Base Legal |
|-------------|----------------------|------------|
| Acceso a datos médicos | 5 años | Ley 41/2002 Art. 17 |
| Autenticación | 2 años | ISO 27001 + RGPD |
| Seguridad | 2 años | ISO 27001 |
| Sistema | 1 año | Buenas prácticas |

Tras expirar, los logs se archivan cifrados durante 1 año adicional antes de eliminación segura.

## 7. Monitorización

- Revisión diaria automática de eventos críticos.
- Análisis periódico de alertas.
- Auditoría semestral de integridad de logs.

## 8. Acceso a Logs

| Rol | Permisos |
|-----|----------|
| Aplicación | Escritura append-only |
| Administrador Sistema | Lectura (acceso registrado) |
| DPO | Lectura completa |
| Auditor Externo | Lectura (con autorización) |

## 9. Alertas Automáticas

Eventos que generan alerta inmediata:
- 5+ logins fallidos desde misma IP en 15 minutos.
- Acceso a datos médicos fuera de horario (20:00-08:00).
- Violación CSRF.
- Error en verificación de integridad de logs.

## 10. Responsabilidades

- **Desarrollador Principal**: Mantenimiento del sistema de logs.
- **Admin Sistemas**: Monitorización diaria.
- **DPO**: Revisión mensual y auditorías.
- **Dirección**: Aprobación de política.

## 11. Cumplimiento

Esta política será revisada anualmente y tras cualquier cambio regulatorio relevante.
