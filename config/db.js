const mysql = require("mysql2"); 

const conexion = mysql.createConnection({
    host: process.env.DB_HOST, 
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    
});

conexion.connect((error) => {
    if (error) {
        console.log(error);
    } else {
        console.log("Conectado a la base de datos");
    }
});

module.exports = conexion;