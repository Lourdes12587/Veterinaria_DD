const express = require('express');
const app = express();
require("dotenv").config({ path: "./env/.env" });
const { cargarNegocio } = require("./config/negocio");
const { comprobarConexion } = require("./config/db");
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
    comprobarConexion();
});

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
app.use("/", require("./src/routers/inicio"));
app.use("/", require("./src/routers/peluqueria"));
app.use("/", require("./src/routers/servicios"));






