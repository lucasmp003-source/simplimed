# GUÍA DE PRODUCCIÓN Y DESPLIEGUE - GALENO-IA

## 1. REQUISITOS PREVIOS
- Node.js v14+ y npm
- Sistema Linux recomendado
- Acceso SSH/configuración a servidor o cloud

## 2. VARIABLES DE ENTORNO OBLIGATORIAS
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` (correo de recuperación)
- `BASE_URL` (url pública de la plataforma)
- `BASE_PATH` para subcarpetas de despliegue
- Opcional: variables para BBDD y almacenamiento, según ampliaciones

## 3. DESPLIEGUE LOCAL Y PRODUCCIÓN
- **Desarrollo local**:
  ```bash
  npm install
  node src/backend/api.js
  ```
- **Producción básica** (systemd):
  ```
  [Service]
  Environment="BASE_PATH=/galeno"
  ExecStart=/usr/bin/node /ruta/a/src/backend/api.js
  ```
- **Producción avanzada** (pm2):
  ```bash
  pm2 start src/backend/api.js --name galeno-ia
  pm2 save && pm2 startup
  ```
- **Docker**: Exportar todas las variables en el Dockerfile o el entorno

## 4. INTEGRACIÓN SMTP/CORREO
- Proveedores soportados: Gmail, Outlook, SendGrid, Mailgun (ver ejemplos CONFIG_PRODUCCION.md)
- Activar/descomentar bloque nodemailer de producción en el código
- Probar envío con scripts de prueba antes de producción

## 5. PROXIES Y SUBDOMINIOS (APACHE/NGINX)
- **Apache**: ProxyPass y ProxyPassReverse con BASE_PATH correcto
- **Nginx**: location /galeno, proxy_pass, cabeceras web sockets habilitadas, ver DEPLOYMENT.md
- Asegurar compatibilidad con websockets si los usas

## 6. TROUBLESHOOTING FRECUENTE
- **No se envía correo:** Revisar variables SMTP, logs de nodemailer, puertos firewall/salida
- **Fallo archivos estáticos:** BASE_PATH mal configurado o error proxy
- **CORS/API:** Comprobar rutas frontend y backend usan mismo BASE_PATH
- **SSL/HTTPS:** Usar Let’s Encrypt o certificados oficiales. Obligado para datos sensibles

## 7. CHECKLIST DE PRODUCCIÓN
- [ ] Variables de entorno correctas
- [ ] SMTP funcional y probado
- [ ] Proxies y rutas bien configuradas
- [ ] HTTPS activo
- [ ] Logs y backups en marcha
- [ ] Política de privacidad y términos visibles
- [ ] Firewalls y sistema actualizado
- [ ] Usuarios de prueba eliminados antes de real

## 8. CONTACTO PARA SOPORTE
- lmolino@ujaen.es
- SINAI/UJAEN (https://sinai.ujaen.es)

---
Consulta DOCUMENTACION_TECNICA.md para detalles funcionales y DOCUMENTACION_LEGAL.md para requisitos legales asociados al despliegue.



