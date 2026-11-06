// Lectura de citas en MySQL. Todas las fechas entran y salen en UTC.
const db = require("../config/db");

// Profesionales que pueden atender una petición (un id concreto o "cualquiera").
function candidatos(negocio, servicioId, profesionalId = "cualquiera") {
  return negocio.profesionales.filter(
    (p) => p.servicios.includes(servicioId) && (profesionalId === "cualquiera" || p.id === profesionalId),
  );
}

// Citas confirmadas que ocupan algo entre [desde, hasta).
// `conexion` permite leer dentro de la misma conexión que tiene el candado.
async function citasEntre({ negocio, profesionales, desde, hasta, conexion = db, excluirId = null }) {
  if (profesionales.length === 0) return [];
  const [filas] = await conexion.query(
    `SELECT id, profesional, inicio, fin_bloqueo
       FROM citas
      WHERE negocio = ? AND estado = 'confirmada' AND profesional IN (?)
        AND inicio < ? AND fin_bloqueo > ?
        AND (? IS NULL OR id <> ?)`,
    [negocio.slug, profesionales, hasta, desde, excluirId, excluirId],
  );
  return filas.map((f) => ({ id: f.id, profesional: f.profesional, inicio: f.inicio, finBloqueo: f.fin_bloqueo }));
}

module.exports = { candidatos, citasEntre };
