# Dog DD — Hotel y spa canino en Barcelona

Web para un hotel, guardería y spa canino de Barcelona: presenta los servicios, la peluquería y el equipo, y recoge solicitudes de contacto y reserva que se guardan en una base de datos.

**Demo:** https://veterinaria-dd.vercel.app/

## Funcionalidades

- Páginas de inicio, servicios (con detalle por tipo), peluquería y spa, quiénes somos y contacto
- Sección "Cómo reservar" con el mensaje de reserva ya redactado para el cliente
- Formulario de contacto validado en el servidor (`express-validator`) que guarda los mensajes en MySQL
- Plantillas reutilizables (cabecera, pie y `<head>` como *partials* de EJS)
- Diseño adaptable a móvil con animaciones de entrada

## Tecnologías

| Área | Stack |
|---|---|
| Backend | Node.js + Express |
| Vistas | EJS |
| Base de datos | MySQL (`mysql2`) |
| Validación y sesiones | `express-validator`, `express-session` |
| Despliegue | Vercel |

## Estructura

```
index.js          servidor Express
config/db.js      conexión a MySQL
src/routers/      rutas (inicio, servicios, peluquería, contacto)
views/            plantillas EJS y partials
public/           CSS, JS e imágenes
```

## Puesta en marcha

Requisitos: Node.js 18+ y MySQL.

```bash
npm install
mkdir env && cp .env.example env/.env   # y rellena los valores
node index.js                           # http://localhost:4000
```

## Autora

**María de Lourdes Ortiz** — Desarrolladora web full-stack · [Creaciones Digitales](https://www.creaciones-digitales.com/)
