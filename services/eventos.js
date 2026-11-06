// Historial de cada cita (tabla eventos). Nunca lanza: si no se puede apuntar,
// se avisa en la consola y la operación principal sigue.
const db = require("../config/db");

async function registrarEvento(citaId, tipo, detalle = null, conexion = db) {
  try {
    await conexion.query("INSERT INTO eventos (cita_id, tipo, detalle) VALUES (?, ?, ?)", [citaId, tipo, detalle && JSON.stringify(detalle)]);
  } catch (e) {
    console.error(`No se pudo guardar el evento "${tipo}" de la cita ${citaId}:`, e.code || e.message);
  }
}

module.exports = { registrarEvento };
