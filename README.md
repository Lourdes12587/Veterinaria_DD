# Agenda con cita previa · demo Dog DD

Web de un negocio con varios profesionales y una agenda real: el cliente elige servicio, profesional (o "Cualquiera"), día y hora entre los huecos libres, y recibe la confirmación por email con enlaces para cambiar o cancelar. El negocio ve cada cita en el Google Calendar de cada profesional y recibe un aviso (webhook a n8n → Telegram).

Es una demo de Creaciones Digitales: la marca "Dog DD" es ficticia y todo lo que cambia de un negocio a otro está en un JSON.

- Express 5 + EJS, MySQL/MariaDB (`mysql2/promise`), `luxon` para las horas.
- Las horas se guardan en **UTC** y se muestran en la zona del negocio (`Europe/Madrid`).
- Funciona sin servicios externos: sin Google, sin Resend (emails en la consola) y sin n8n.

## Instalar en local

Requisitos: Node 22 y MySQL 8 o MariaDB 10.4+ (por ejemplo, el de XAMPP).

```bash
npm install
cp env/.env.example env/.env    # y rellena los valores (ver abajo)
```

### Crear la base de datos

Como administrador (`root`), en phpMyAdmin o en la consola de MySQL. Cambia `CAMBIA_ESTO` por una contraseña propia:

```sql
CREATE DATABASE IF NOT EXISTS agenda CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'agenda'@'localhost' IDENTIFIED BY 'CAMBIA_ESTO';
GRANT SELECT, INSERT, UPDATE, DELETE ON agenda.* TO 'agenda'@'localhost';
FLUSH PRIVILEGES;
```

Y las tablas:

```bash
mysql -u root -p agenda < db/schema.sql
```

La app entra con el usuario `agenda`, que solo puede leer y escribir datos (no crear ni borrar tablas).

### Arrancar

```bash
npm start            # http://localhost:4000
```

Al arrancar, la consola dice qué está activado (emails, avisos, Google Calendar) y avisa si falta algo. Si el JSON del negocio tiene un error, la app no arranca y dice qué está mal.

## Variables de entorno (`env/.env`)

`env/.env` está en `.gitignore`. Nunca subas claves al repositorio.

| Variable | Para qué | Si está vacía |
|---|---|---|
| `PORT` | Puerto (la app escucha en 4000) | — |
| `NEGOCIO` | Archivo de `config/negocios/` sin `.json` | `dog-dd` |
| `URL_PUBLICA` | URL de la web para los enlaces de los emails, sin `/` final | `http://localhost:4000` |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASS` | Conexión a MySQL (usuario `agenda`) | — |
| `TOKEN_PEPPER` | Secreto para los enlaces de cambiar/cancelar | **No se puede reservar** |
| `RESEND_API_KEY` | Envío de emails con Resend | Los emails se imprimen en la consola |
| `EMAIL_FROM` | Remitente verificado en Resend (`Dog DD <citas@tudominio.com>`) | Obligatorio si hay `RESEND_API_KEY` |
| `N8N_WEBHOOK_URL` | Webhook de n8n para avisar al negocio | No se envía ningún aviso |
| `N8N_WEBHOOK_SECRET` | Se envía en la cabecera `x-webhook-secret` | Se envía sin cabecera |
| `GOOGLE_SA_KEY_FILE` | Ruta al JSON de la cuenta de servicio de Google, **fuera del proyecto** | Sin calendario |

Generar `TOKEN_PEPPER`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Si lo cambias, los enlaces de los emails ya enviados dejan de funcionar.

## Tests y scripts

```bash
npm test                              # cálculo de huecos y Google Calendar (sin red ni base)
node scripts/prueba-concurrencia.js   # 10 reservas a la vez al mismo hueco: debe entrar 1
node scripts/recordatorios.js         # una vuelta de recordatorios ahora
```

`prueba-concurrencia.js` usa la base de `env/.env` y borra la cita de prueba al terminar (salvo con `--conservar`).

## Crear la demo de otro negocio

1. Copia `config/negocios/dog-dd.json` como `config/negocios/<slug>.json` (por ejemplo `peluqueria-ana.json`) y cambia `"slug"` para que coincida con el nombre del archivo.
2. Edita nombre, teléfono, servicios, profesionales y horarios.
3. Pon `NEGOCIO=<slug>` en `env/.env` y arranca.

No hay que tocar código. Al arrancar se valida el JSON:

- `horario`: días `lun` a `dom`, tramos `"HH:MM-HH:MM"` sin solaparse.
- `servicios[].id` y `profesionales[].id` únicos (`cualquiera` está reservado).
- Cada profesional solo puede tener servicios que existen, y cada servicio debe hacerlo alguien.
- `pasoMinutos` divide 60; `zonaHoraria` es una zona IANA válida.

`calendarId` y `emailNegocio` nunca llegan al navegador.

| Campo | Qué hace |
|---|---|
| `pasoMinutos` | Cada cuánto empieza un hueco (15 → 9:30, 9:45…) |
| `antelacionMinimaHoras` | No se puede reservar con menos antelación |
| `diasVisibles` | Días que se ofrecen, contando hoy |
| `cancelacionMinimaHoras` | Por debajo, el enlace dice "llama al …" en vez de cambiar/cancelar |
| `servicios[].margenMin` | Tiempo libre tras cada cita (limpieza, notas); no lo ve el cliente |
| `etiquetaDemo` | Banda "Demo de Creaciones Digitales…", pie en los emails y limpieza diaria |

## Cómo funciona

- **Huecos** (`services/disponibilidad.js`): función pura con tests. Recibe horario, citas, bloqueos de Google, servicio, fecha y "ahora", y devuelve las horas libres. Tiene en cuenta el margen, la antelación y el cambio de hora.
- **Reservar sin dobles reservas** (`services/reservas.js`): `GET_LOCK('agenda:<negocio>:<profesional>')` en la misma conexión, comprobación en MySQL y Google, `INSERT` y `RELEASE_LOCK` en `finally`. Una transacción sola no basta: para ver que un hueco está libre se hace un `SELECT` que no devuelve filas, y sin filas no hay nada que bloquear.
- **Después de soltar el candado** (`services/notificaciones.js`): evento en Google, email y aviso a n8n. Si alguno falla, la cita sigue siendo válida y el error queda en la tabla `eventos`.
- **Enlaces de cambiar/cancelar**: el token se genera con `crypto.randomBytes(32)` y en la base solo se guarda `sha256(token + TOKEN_PEPPER)`. `GET /cita/:token` solo muestra; cancelar y cambiar son `POST`, para que un antivirus de correo que abra el enlace no cancele nada. Por eso el recordatorio no puede llevar el enlace: no se puede reconstruir a partir del hash.
- **Recordatorios** (`services/recordatorios.js`): `node-cron` cada 15 minutos, con candado para no enviar dos veces.
- **Limpieza** (`services/limpieza.js`): con `etiquetaDemo`, cada día a las 03:30 borra las citas creadas hace más de 30 días que ya han pasado.
- **Sin JavaScript** la agenda funciona con formularios normales (GET para elegir, POST para reservar).

## Google Calendar

1. En https://console.cloud.google.com crea un proyecto y habilita **Google Calendar API**.
2. Crea una **cuenta de servicio** (sin roles) y descarga una clave **JSON**. Guárdala fuera del proyecto y pon su ruta en `GOOGLE_SA_KEY_FILE`.
3. En cada calendario de profesional: *Configuración y uso compartido → Compartir con determinadas personas →* el email de la cuenta de servicio con **"Hacer cambios en eventos"**.
4. Copia el **ID del calendario** (*Integrar el calendario*) en el `calendarId` de su profesional.

Los eventos que pone el negocio a mano (vacaciones, descansos) bloquean esas horas. La cuenta de servicio no puede invitar al cliente: por eso el cliente recibe un `.ics` por email.

## Avisos con n8n

Webhook (POST) → nodo IF que compruebe la cabecera `x-webhook-secret` → Telegram. El cuerpo lleva `evento` (`reserva`, `cambio`, `cancelacion`) y la cita con los datos de contacto del cliente, nunca el token. Envía el mensaje a Telegram como texto normal, no como HTML: el nombre y la nota los escribe el cliente.

## En producción (detrás de Nginx)

- `app.set('trust proxy', 1)` ya está: el límite por IP usa la IP real del cliente.
- Nginx debe servir HTTPS y redirigir HTTP → HTTPS; `URL_PUBLICA` con `https://`.
- `helmet` añade las cabeceras de seguridad y una CSP estricta.
- La sesión de MySQL se fija en UTC en cada conexión (`config/db.js`).
