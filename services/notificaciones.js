// Lo que pasa después de reservar, cambiar o cancelar (ya sin candado):
// email al cliente y aviso al negocio. Cada paso es independiente: si uno
// falla, se apunta en "eventos" (error_email, error_aviso) y se sigue.
// La cita ya está guardada y es válida pase lo que pase aquí.
const db = require("../config/db");
const { enviarEmail } = require("./email");
const { avisarNegocio } = require("./avisos");
const plantillas = require("./plantillas-email");
const { icsDeCita } = require("./ics");
const { registrarEvento } = require("./eventos");
const fmt = require("./formato");

async function cargarCita(id) {
  const [filas] = await db.query("SELECT * FROM citas WHERE id = ?", [id]);
  return filas[0] || null;
}

async function intentar(citaId, tipoError, contexto, fn) {
  try {
    return await fn();
  } catch (e) {
    console.error(`Cita #${citaId}: ${tipoError} (${contexto}): ${e.message}`);
    await registrarEvento(citaId, tipoError, { contexto, mensaje: e.message });
    return null;
  }
}

const adjuntoIcs = (negocio, cita) => ({
  filename: `cita-${negocio.slug}.ics`,
  content: icsDeCita(negocio, cita),
  contentType: "text/calendar; charset=utf-8; method=PUBLISH",
});

// Lo que recibe n8n. Sin token: con él cualquiera podría cancelar la cita.
function datosAviso(negocio, cita) {
  const s = negocio.servicios.find((x) => x.id === cita.servicio);
  const p = negocio.profesionales.find((x) => x.id === cita.profesional);
  return {
    negocio: negocio.slug,
    cita: {
      id: cita.id,
      estado: cita.estado,
      servicio: cita.servicio,
      servicioNombre: s ? s.nombre : cita.servicio,
      profesional: cita.profesional,
      profesionalNombre: p ? p.nombre : cita.profesional,
      inicio: new Date(cita.inicio).toISOString(),
      fin: new Date(cita.fin).toISOString(),
      cuando: `${fmt.fechaLarga(cita.inicio, negocio.zonaHoraria)} a las ${fmt.hora(cita.inicio, negocio.zonaHoraria)}`,
      cliente: { nombre: cita.cliente_nombre, telefono: cita.cliente_telefono, email: cita.cliente_email },
      nota: cita.nota || "",
    },
  };
}

async function alReservar(negocio, { cita: { id }, token }) {
  const cita = await cargarCita(id);
  if (!cita) return;
  await intentar(id, "error_email", "confirmación", () =>
    enviarEmail({ to: cita.cliente_email, replyTo: negocio.emailNegocio, ...plantillas.confirmacion(negocio, cita, token), attachments: [adjuntoIcs(negocio, cita)] }),
  );
  await intentar(id, "error_aviso", "reserva", () => avisarNegocio("reserva", datosAviso(negocio, cita)));
}

async function alCambiar(negocio, { anteriorId, nuevaId, token }) {
  const [anterior, cita] = await Promise.all([cargarCita(anteriorId), cargarCita(nuevaId)]);
  if (!anterior || !cita) return;
  await intentar(nuevaId, "error_email", "cambio", () =>
    enviarEmail({ to: cita.cliente_email, replyTo: negocio.emailNegocio, ...plantillas.cambio(negocio, cita, token, anterior), attachments: [adjuntoIcs(negocio, cita)] }),
  );
  await intentar(nuevaId, "error_aviso", "cambio", () =>
    avisarNegocio("cambio", { ...datosAviso(negocio, cita), anterior: { id: anterior.id, inicio: new Date(anterior.inicio).toISOString(), profesional: anterior.profesional } }),
  );
}

async function alCancelar(negocio, { citaId }) {
  const cita = await cargarCita(citaId);
  if (!cita) return;
  await intentar(citaId, "error_email", "cancelación", () => enviarEmail({ to: cita.cliente_email, replyTo: negocio.emailNegocio, ...plantillas.cancelacion(negocio, cita) }));
  await intentar(citaId, "error_aviso", "cancelación", () => avisarNegocio("cancelacion", datosAviso(negocio, cita)));
}

module.exports = { alReservar, alCambiar, alCancelar, datosAviso };
