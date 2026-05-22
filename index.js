const express = require('express');
const app = express();
require("dotenv").config({ path: "./env/.env" }); 
const session = require('express-session');
//const { swaggerJSDoc, swaggerUi, swaggerSpec } = require("./swagger"); 
//const http = require ("http");
//const server = http.createServer(app);
//const cookieSession = require('cookie-session');
//const cookieParser = require('cookie-parser');

app.use(
    session({
        secret: "secret", 
        resave: false, 
        saveUninitialized: false, 
    })
);

app.listen(4000, () => { 
    console.log("Servidor corriendo en http://localhost:4000");
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






