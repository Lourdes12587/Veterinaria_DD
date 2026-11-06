// Limpieza diaria de la demo: borra las citas creadas hace más de 30 días
// que ya han pasado (sus eventos se borran en cascada). Solo si etiquetaDemo
// es true: en un negocio real no se borra nada automáticamente.
const cron = require("node-cron");
const db = require("../config/db");

const DIAS = 30;

async function borrarCitasAntiguas(negocio, ahora = new Date()) {
  if (!negocio.etiquetaDemo) return 0;
  const limite = new Date(ahora.getTime() - DIAS * 24 * 3600 * 1000);
  const [r] = await db.query("DELETE FROM citas WHERE negocio = ? AND creada_at < ? AND inicio < ?", [negocio.slug, limite, ahora]);
  return r.affectedRows;
}

function iniciarLimpieza(negocio) {
  if (!negocio.etiquetaDemo) return null;
  const vuelta = async () => {
    try {
      const n = await borrarCitasAntiguas(negocio);
      if (n) console.log(`Limpieza de la demo: ${n} cita(s) de hace más de ${DIAS} días borrada(s).`);
    } catch (e) {
      console.error("Limpieza de la demo:", e.code || e.message);
    }
  };
  // Todos los días a las 03:30 en la hora del negocio.
  return cron.schedule("30 3 * * *", vuelta, { timezone: negocio.zonaHoraria });
}

module.exports = { borrarCitasAntiguas, iniciarLimpieza };
