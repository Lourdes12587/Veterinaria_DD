const express = require('express');
const app = express();
require("dotenv").config({ path: "./env/.env" });
const { cargarNegocio } = require("./config/negocio");
const { comprobarConexion } = require("./config/db");
const { iniciarRecordatorios } = require("./services/recordatorios");
const { modoConsola } = require("./services/email");
const { estadoConfiguracion } = require("./services/calendario");
const { iniciarLimpieza } = require("./services/limpieza");
const helmet = require("helmet");
//const { swaggerJSDoc, swaggerUi, swaggerSpec } = require("./swagger");
//const http = require ("http");
//const server = http.createServer(app);
//const cookieSession = require('cookie-session');
//const cookieParser = require('cookie-parser');

// Configuración del negocio: si el JSON tiene errores, la app no arranca.
let negocio;
try {
    negocio = cargarNegocio(process.env.NEGOCIO || "dog-dd");
} catch (e) {
    console.error(`No se puede arrancar: ${e.message}`);
    process.exit(1);
}
app.locals.negocio = negocio.publico;

app.listen(4000, () => {
    console.log("Servidor corriendo en http://localhost:4000");
    console.log(`Negocio: ${negocio.publico.nombre} (${negocio.publico.slug})`);
    console.log(`Emails: ${modoConsola() ? "en la consola (no hay RESEND_API_KEY)" : "con Resend"} · Avisos n8n: ${(process.env.N8N_WEBHOOK_URL || "").trim() ? "activados" : "desactivados"}`);
    const google = estadoConfiguracion(negocio.completo);
    console.log(`Google Calendar: ${google.texto}`);
    google.avisos.forEach((a) => console.warn(`Aviso: ${a}`));
    comprobarConexion();
    iniciarRecordatorios(negocio.completo);
    iniciarLimpieza(negocio.completo);
});

// Detrás de Nginx: la IP real del cliente llega en X-Forwarded-For. Con 1 se
// confía solo en el primer proxy; sin esto, el límite por IP contaría a todos
// los visitantes como uno (la IP de Nginx).
app.set("trust proxy", 1);

// Cabeceras de seguridad. La CSP solo permite:
// - scripts propios y el script en línea que añade la clase "js" (por su hash),
// - estilos propios, de Google Fonts y en atributos style="" (los usa el diseño),
// - fuentes de Google Fonts y peticiones (fetch) a este mismo servidor.
const scriptJs = 'document.documentElement.classList.add("js");';
const hashScriptJs = `'sha256-${require("crypto").createHash("sha256").update(scriptJs).digest("base64")}'`;
app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                "default-src": ["'self'"],
                "script-src": ["'self'", hashScriptJs],
                "style-src": ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
                "font-src": ["'self'", "https://fonts.gstatic.com"],
                "img-src": ["'self'", "data:"],
                "connect-src": ["'self'"],
                "form-action": ["'self'"],
                "frame-ancestors": ["'none'"],
                // Sin esto, el móvil en la red local (http://192.168…) pediría
                // el CSS y el JS por https y la página saldría sin estilos.
                // En producción, Nginx redirige a https.
                "upgrade-insecure-requests": null,
            },
        },
    }),
);

//app.use(cookieSession({
//    name: 'session',
//    keys: ['claveSecreta1', 'claveSecreta2'],  
//    maxAge: 24 * 60 * 60 * 1000 
//}));

//server.listen(4000, () => { 
//    console.log("Servidor corriendo en http://localhost:4000");
//});

//app.use((req, res, next) => {
//  res.locals.user = req.session.user || null;
//  res.locals.rol = req.session.rol || null;
//  next();
//});

app.use("/resources", express.static(__dirname + "/public")); 

app.set('view engine', 'ejs'); 
//app.set('views', path.join(__dirname, 'views'));

//middlewares
app.use(express.urlencoded({ extended: true })); 
app.use(express.json());
//app.use(cookieParser());
//app.use('/uploads', express.static('public/uploads'));

//rutas
app.use("/", require("./src/routers/reservar")(negocio.completo));
app.use("/", require("./src/routers/cita")(negocio.completo));
app.use("/", require("./src/routers/inicio"));
app.use("/", require("./src/routers/peluqueria"));
app.use("/", require("./src/routers/servicios"));
app.use("/api", require("./src/routers/agenda")(negocio.completo));






