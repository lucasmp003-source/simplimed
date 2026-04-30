# 📧 Guía Completa: Configurar Gmail para GALENO-IA

## 🎯 Resumen Rápido

**Tiempo estimado:** 10 minutos  
**Puertos necesarios:** 587 (salida/outbound)  
**Costo:** Gratis (hasta 500 emails por día)

---

## 📋 Paso a Paso Detallado

### Paso 1: Preparar Cuenta de Gmail (3 minutos)

#### Opción A: Usar cuenta existente
- Puedes usar tu cuenta personal de Gmail

#### Opción B: Crear cuenta nueva (Recomendado)
1. Ve a: https://accounts.google.com/signup
2. Crea una cuenta específica para GALENO-IA
3. Ejemplo: `galeno.ia.ujaen@gmail.com`
4. Completa el registro

---

### Paso 2: Activar Verificación en 2 Pasos (2 minutos)

> ⚠️ **IMPORTANTE:** Gmail requiere verificación en 2 pasos para generar contraseñas de aplicación.

1. **Ir a tu cuenta de Google:**
   ```
   https://myaccount.google.com/security
   ```

2. **Buscar "Verificación en 2 pasos"** en la sección de seguridad

3. **Hacer clic en "Empezar" o "Activar"**

4. **Seguir los pasos:**
   - Confirmar tu contraseña
   - Añadir tu número de teléfono
   - Verificar con código SMS
   - Activar

5. **✅ Verificación activada**

---

### Paso 3: Generar Contraseña de Aplicación (2 minutos)

1. **Ir a contraseñas de aplicación:**
   ```
   https://myaccount.google.com/apppasswords
   ```

2. **Iniciar sesión** si te lo pide

3. **Seleccionar app:**
   - En "Selecciona la app": elige **Correo**

4. **Seleccionar dispositivo:**
   - En "Selecciona el dispositivo": elige **Otro (nombre personalizado)**
   - Escribe: `GALENO-IA` o `SINAI UJaen`

5. **Hacer clic en "Generar"**

6. **Copiar la contraseña:**
   ```
   Aparecerá algo como: abcd efgh ijkl mnop
   ```
   
   > 💡 **IMPORTANTE:** 
   > - Esta contraseña solo se muestra UNA VEZ
   > - Cópiala y guárdala en lugar seguro
   > - Son 16 caracteres con espacios
   > - NO uses tu contraseña normal de Gmail

7. **Hacer clic en "Listo"**

---

### Paso 4: Configurar GALENO-IA (3 minutos)

#### Método 1: Editar archivo de configuración

1. **Abrir el archivo de configuración:**
   ```bash
   nano /home/galeno/SIMPLIMED/src/backend/smtp-config.js
   ```

2. **Editar las credenciales:**
   ```javascript
   gmail: {
       host: 'smtp.gmail.com',
       port: 587,
       secure: false,
       auth: {
           user: 'tu_email@gmail.com',      // ← CAMBIA ESTO
           pass: 'abcd efgh ijkl mnop'      // ← CAMBIA ESTO
       }
   }
   ```

3. **Guardar:** `Ctrl + O`, luego `Enter`, luego `Ctrl + X`

#### Método 2: Dime tus datos y lo configuro yo

Solo dime:
- **Email de Gmail:** _______@gmail.com
- **Contraseña de aplicación:** ____ ____ ____ ____

---

### Paso 5: Abrir Puerto en Firewall (1 minuto)

Gmail usa el puerto **587** de salida.

#### Ubuntu/Debian con UFW:
```bash
sudo ufw allow out 587/tcp
sudo ufw status
```

#### CentOS/RHEL con firewalld:
```bash
sudo firewall-cmd --permanent --add-port=587/tcp
sudo firewall-cmd --reload
sudo firewall-cmd --list-ports
```

#### Verificar que el puerto esté abierto:
```bash
telnet smtp.gmail.com 587
# O
nc -zv smtp.gmail.com 587
```

Deberías ver: `Connected to smtp.gmail.com`

---

### Paso 6: Probar Configuración (1 minuto)

1. **Reiniciar el servidor:**
   ```bash
   cd /home/galeno/SIMPLIMED/src/backend
   node api.js
   ```

2. **Probar recuperación de contraseña:**
   - Ir a: http://localhost:8080/login
   - Clic en "¿Olvidaste tu contraseña?"
   - Ingresar cualquier email de usuario
   - **Revisar tu bandeja de Gmail** ✅

---

## 🔍 Verificación Rápida

Ejecuta este script de prueba:

```bash
cd /home/galeno/SIMPLIMED/src/backend
node -e "
const nodemailer = require('nodemailer');
const config = require('./smtp-config');

const transporter = nodemailer.createTransport(config.active);

transporter.sendMail({
    from: config.active.auth.user,
    to: config.active.auth.user,
    subject: '✅ Test SMTP - GALENO-IA',
    text: 'Si recibes este correo, la configuración funciona!'
}, (error, info) => {
    if (error) {
        console.log('❌ Error:', error.message);
    } else {
        console.log('✅ Email enviado!');
        console.log('Message ID:', info.messageId);
        console.log('Revisa tu bandeja de entrada');
    }
});
"
```

---

## 🎯 Puertos Resumen

| Puerto | Protocolo | Uso | Estado |
|--------|-----------|-----|--------|
| **587** | SMTP + STARTTLS | Envío de correo | ✅ Recomendado |
| 465 | SMTPS (SSL/TLS) | Envío de correo | ⚠️ Alternativa |
| 25 | SMTP | Envío tradicional | ❌ Bloqueado por ISPs |

**Solo necesitas el puerto 587 de salida (outbound).**

---

## ⚠️ Troubleshooting

### Error: "Invalid login"
- ✅ Verifica que usas la **contraseña de aplicación** (16 caracteres)
- ✅ NO uses tu contraseña normal de Gmail
- ✅ Confirma que la verificación en 2 pasos está activa

### Error: "Connection timeout"
- ✅ Verifica que el puerto 587 esté abierto
- ✅ Comprueba tu conexión a internet
- ✅ Prueba con puerto 465 (cambia `port: 465` y `secure: true`)

### No recibo el correo
- ✅ Revisa la carpeta de Spam
- ✅ Verifica que el email esté bien escrito
- ✅ Espera 1-2 minutos (puede tardar)

### Error: "Username and Password not accepted"
- ✅ Regenera la contraseña de aplicación
- ✅ Copia sin espacios extras
- ✅ Verifica que la verificación en 2 pasos esté activa

---

## 📊 Límites de Gmail

| Concepto | Límite |
|----------|--------|
| Emails por día | 500 (cuenta gratuita) |
| Emails por minuto | ~20 |
| Destinatarios por mensaje | 100 |
| Tamaño máximo | 25 MB |

> 💡 Para GALENO-IA estos límites son más que suficientes

---

## 🔒 Seguridad

### ✅ Buenas Prácticas:
- Usar cuenta de Gmail específica para GALENO-IA
- No compartir la contraseña de aplicación
- Mantener `smtp-config.js` fuera de Git
- Rotar contraseñas periódicamente

### ⚠️ NO Hacer:
- No usar tu contraseña personal de Gmail
- No subir credenciales a repositorios públicos
- No compartir el archivo de configuración

---

## 📝 Checklist Final

- [ ] Cuenta de Gmail lista
- [ ] Verificación en 2 pasos activada
- [ ] Contraseña de aplicación generada
- [ ] Archivo `smtp-config.js` editado
- [ ] Puerto 587 abierto en firewall
- [ ] Servidor reiniciado
- [ ] Email de prueba enviado exitosamente
- [ ] ✅ **Sistema funcionando!**

---

## 🎉 ¿Listo para Configurar?

**Dime cuándo tengas:**
1. Tu email de Gmail
2. La contraseña de aplicación generada

Y te ayudo a configurarlo todo en 2 minutos. O si prefieres, sigue la guía paso a paso arriba.

---

**GALENO-IA - SINAI - Universidad de Jaén**

_Configuración actualizada: Octubre 2025_

