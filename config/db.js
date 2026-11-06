// Pool de conexiones MySQL con promesas.
// timezone: 'Z' hace que mysql2 envíe y lea las fechas DATETIME como UTC,
// sin aplicar la zona horaria del ordenador donde corre Node.
const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  timezone: "Z",
  waitForConnections: true,
  connectionLimit: 10,
});

// Comprueba la conexión sin detener la app: la web pública no depende de MySQL
// para mostrarse, solo la agenda.
async function comprobarConexion() {
  try {
    await pool.query("SELECT 1");
    console.log(`Conectado a MySQL (${process.env.DB_NAME})`);
    return true;
  } catch (e) {
    console.warn(`Aviso: no se pudo conectar a MySQL (${e.code || e.message}). La agenda no funcionará hasta que la base esté disponible.`);
    return false;
  }
}

module.exports = pool;
module.exports.comprobarConexion = comprobarConexion;
