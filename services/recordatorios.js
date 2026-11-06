// Recordatorios 24 h antes, con node-cron cada 15 minutos.
//
// Se envían a citas que:
//   - están confirmadas y aún no tienen recordatorio,
//   - empiezan en menos de 24 h,
//   - se reservaron con más de 24 h de antelación (si reservas hoy para
//     mañana, acabas de recibir la confirmación: otro email sobra).
// recordatorio_enviado_at se marca solo si el envío sale bien; si falla, se
// vuelve a intentar en la siguiente vuelta.
const cron = require("node-cron");
const db = require("../config/db");
const { enviarEmail } = require("./email");
const plantillas = require("./plantillas-email");
const { registrarEvento } = require("./eventos");

const HORA = 3600 * 1000;

async function enviarRecordatorios(negocio, ahora = new Date()) {
  // Candado para que dos procesos (la app y el script manual, o dos servidores)
  // no envíen el mismo recordatorio. Espera 0 s: si otro ya está en ello, se salta.
  const nombre = `agenda:recordatorios:${negocio.slug}`;
  const conexion = await db.getConnection();
  try {
    const [[{ ok }]] = await conexion.query("SELECT GET_LOCK(?, 0) AS ok", [nombre]);
    if (ok !== 1) return { saltado: true, revisadas: 0, enviados: 0, fallidos: 0 };
    try {
      const [citas] = await conexion.query(
        `SELECT * FROM citas
          WHERE estado = 'confirmada' AND recordatorio_enviado_at IS NULL
            AND inicio > ? AND inicio <= ?
            AND negocio = ?
            AND creada_at < inicio - INTERVAL 24 HOUR
          ORDER BY inicio`,
        [ahora, new Date(ahora.getTime() + 24 * HORA), negocio.slug],
      );
      let enviados = 0;
      let fallidos = 0;
      for (const cita of citas) {
        try {
          await enviarEmail({ to: cita.cliente_email, replyTo: negocio.emailNegocio, ...plantillas.recordatorio(negocio, cita) });
        } catch (e) {
          fallidos++;
          console.error(`Cita #${cita.id}: error_email (recordatorio): ${e.message}`);
          await registrarEvento(cita.id, "error_email", { contexto: "recordatorio", mensaje: e.message });
          continue;
        }
        const [u] = await conexion.query("UPDATE citas SET recordatorio_enviado_at = ? WHERE id = ? AND recordatorio_enviado_at IS NULL", [new Date(), cita.id]);
        if (u.affectedRows === 1) {
          enviados++;
          await registrarEvento(cita.id, "recordatorio");
        }
      }
      return { saltado: false, revisadas: citas.length, enviados, fallidos };
    } finally {
      await conexion.query("DO RELEASE_LOCK(?)", [nombre]).catch(() => conexion.destroy());
    }
  } finally {
    conexion.release();
  }
}

function iniciarRecordatorios(negocio) {
  const vuelta = async () => {
    try {
      const r = await enviarRecordatorios(negocio);
      if (r.revisadas) console.log(`Recordatorios: ${r.enviados} enviados, ${r.fallidos} fallidos.`);
    } catch (e) {
      console.error("Recordatorios: no se pudieron revisar:", e.code || e.message);
    }
  };
  // Cada 15 minutos (00, 15, 30, 45) y una vez al arrancar, por si la app estuvo parada.
  const tarea = cron.schedule("*/15 * * * *", vuelta);
  vuelta();
  return tarea;
}

module.exports = { enviarRecordatorios, iniciarRecordatorios };
