// Google Calendar con una cuenta de servicio.
//
// MySQL es la fuente de verdad de las citas. Google Calendar es:
//   - una copia para el negocio (cada cita es un evento en el calendario del profesional),
//   - y una fuente de bloqueos (vacaciones, descansos) que se consulta con freebusy.
//
// Sin GOOGLE_SA_KEY_FILE, o con calendarId vacío, la agenda funciona sin calendario:
// sin bloqueos y sin crear eventos.
const fs = require("fs");

const ESCALA = ["https://www.googleapis.com/auth/calendar"];
const CACHE_MS = 60 * 1000;

let cliente = null; // cliente de la API (o uno falso en las pruebas)
let clientePrueba = null;
const cache = new Map();

const archivoClave = () => (process.env.GOOGLE_SA_KEY_FILE || "").trim();

function configurado() {
  if (clientePrueba) return true;
  const f = archivoClave();
  return Boolean(f) && fs.existsSync(f);
}

// googleapis tarda varios segundos en cargarse: solo se carga si hace falta.
function api() {
  if (clientePrueba) return clientePrueba;
  if (!cliente) {
    const { google } = require("googleapis");
    const auth = new google.auth.GoogleAuth({ keyFile: archivoClave(), scopes: ESCALA });
    cliente = google.calendar({ version: "v3", auth });
  }
  return cliente;
}

// Para las pruebas: un objeto con la misma forma que google.calendar().
function usarClienteDePrueba(falso) {
  clientePrueba = falso;
  cache.clear();
}

const calendarioDe = (negocio, profesionalId) => {
  const p = negocio.profesionales.find((x) => x.id === profesionalId);
  return p && p.calendarId ? p.calendarId : null;
};

// --- Funciones puras (con tests) ---

// Respuesta de freebusy → [{ profesional, inicio, fin }]. Si Google no pudo leer
// un calendario (no compartido, id erróneo), lo trata como error: mejor no
// reservar que reservar encima de unas vacaciones que no vemos.
function bloqueosDeFreebusy(datos, calendarios) {
  const bloqueos = [];
  for (const [profesional, calendarId] of calendarios) {
    const cal = datos.calendars && datos.calendars[calendarId];
    if (!cal) throw new Error(`freebusy no devolvió el calendario de ${profesional}.`);
    if (cal.errors && cal.errors.length) throw new Error(`Google no puede leer el calendario de ${profesional}: ${cal.errors.map((e) => e.reason).join(", ")}.`);
    for (const b of cal.busy || []) bloqueos.push({ profesional, inicio: new Date(b.start), fin: new Date(b.end) });
  }
  return bloqueos;
}

// Quita de los bloqueos el hueco del evento propio (al cambiar una cita).
// freebusy no dice qué evento ocupa cada hueco, solo cuándo está ocupado, así
// que se resta el intervalo de la cita: lo que quede a los lados sigue bloqueado.
function quitarIntervalo(bloqueos, ignorar) {
  if (!ignorar) return bloqueos;
  const a = new Date(ignorar.inicio).getTime();
  const b = new Date(ignorar.fin).getTime();
  const resultado = [];
  for (const x of bloqueos) {
    const i = x.inicio.getTime();
    const f = x.fin.getTime();
    if (x.profesional !== ignorar.profesional || f <= a || i >= b) {
      resultado.push(x);
      continue;
    }
    if (i < a) resultado.push({ ...x, fin: new Date(a) });
    if (f > b) resultado.push({ ...x, inicio: new Date(b) });
  }
  return resultado;
}

// --- Lecturas ---

/**
 * Bloqueos de Google para unos profesionales entre [desde, hasta).
 * @param {boolean} [o.fresco=false]  true dentro del candado (sin caché).
 * @param {object}  [o.ignorar]       { profesional, inicio, fin } del evento propio al cambiar.
 */
async function obtenerBloqueos(negocio, { profesionales, desde, hasta, ignorar = null, fresco = false }) {
  if (!configurado()) return [];
  const calendarios = profesionales.map((id) => [id, calendarioDe(negocio, id)]).filter(([, c]) => c);
  if (calendarios.length === 0) return [];

  const clave = `${calendarios.map(([, c]) => c).join(",")}|${new Date(desde).toISOString()}|${new Date(hasta).toISOString()}`;
  const guardado = cache.get(clave);
  let bloqueos;
  if (!fresco && guardado && guardado.expira > Date.now()) {
    bloqueos = guardado.bloqueos;
  } else {
    const r = await api().freebusy.query({
      requestBody: {
        timeMin: new Date(desde).toISOString(),
        timeMax: new Date(hasta).toISOString(),
        timeZone: "UTC",
        items: calendarios.map(([, id]) => ({ id })),
      },
    });
    bloqueos = bloqueosDeFreebusy(r.data, calendarios);
    if (cache.size > 200) cache.clear();
    cache.set(clave, { expira: Date.now() + CACHE_MS, bloqueos });
  }
  return quitarIntervalo(bloqueos, ignorar);
}

// Para mostrar huecos: si Google falla, se muestran sin bloqueos (la reserva
// vuelve a comprobar dentro del candado y allí sí falla si Google no responde).
async function bloqueosParaMostrar(negocio, opciones) {
  try {
    return await obtenerBloqueos(negocio, opciones);
  } catch (e) {
    console.error("Google Calendar (mostrar huecos):", e.message);
    return [];
  }
}

// --- Escrituras (después de soltar el candado) ---

function cuerpoEvento(negocio, cita) {
  const s = negocio.servicios.find((x) => x.id === cita.servicio);
  const descripcion = [
    `Cliente: ${cita.cliente_nombre}`,
    `Teléfono: ${cita.cliente_telefono}`,
    `Email: ${cita.cliente_email}`,
    cita.nota ? `Nota: ${cita.nota}` : null,
    "",
    `Reservada en la web (cita #${cita.id}). Para cambiarla, hazlo desde la agenda, no moviendo este evento.`,
  ]
    .filter((l) => l !== null)
    .join("\n");
  return {
    summary: `${s ? s.nombre : cita.servicio} · ${cita.cliente_nombre}`,
    description: descripcion,
    start: { dateTime: new Date(cita.inicio).toISOString(), timeZone: negocio.zonaHoraria },
    end: { dateTime: new Date(cita.fin).toISOString(), timeZone: negocio.zonaHoraria },
    extendedProperties: { private: { citaId: String(cita.id), negocio: negocio.slug } },
    // Sin invitados: una cuenta de servicio no puede invitar al cliente
    // (por eso el cliente recibe el .ics por email).
  };
}

// Devuelve el id del evento creado, o null si ese profesional no tiene calendario.
async function crearEvento(negocio, cita) {
  const calendarId = configurado() && calendarioDe(negocio, cita.profesional);
  if (!calendarId) return null;
  const r = await api().events.insert({ calendarId, requestBody: cuerpoEvento(negocio, cita) });
  return r.data.id;
}

// Mueve el evento de la cita anterior a los datos de la nueva (otra hora y, si
// cambia de profesional, otro calendario). Devuelve el id del evento resultante.
async function moverEvento(negocio, anterior, nueva) {
  if (!configurado()) return null;
  const origen = calendarioDe(negocio, anterior.profesional);
  const destino = calendarioDe(negocio, nueva.profesional);
  if (!anterior.google_event_id || !origen) return crearEvento(negocio, nueva);
  if (!destino) {
    await borrarEvento(negocio, anterior);
    return null;
  }
  let eventId = anterior.google_event_id;
  if (origen !== destino) {
    const m = await api().events.move({ calendarId: origen, eventId, destination: destino });
    eventId = m.data.id;
  }
  const r = await api().events.patch({ calendarId: destino, eventId, requestBody: cuerpoEvento(negocio, nueva) });
  return r.data.id;
}

async function borrarEvento(negocio, cita) {
  const calendarId = configurado() && calendarioDe(negocio, cita.profesional);
  if (!calendarId || !cita.google_event_id) return false;
  try {
    await api().events.delete({ calendarId, eventId: cita.google_event_id });
  } catch (e) {
    const codigo = e.code || (e.response && e.response.status);
    if (codigo !== 404 && codigo !== 410) throw e; // ya no existía: no es un error
  }
  return true;
}

// Texto para la consola al arrancar, con avisos si algo no cuadra.
function estadoConfiguracion(negocio) {
  const f = archivoClave();
  const conCalendario = negocio.profesionales.filter((p) => p.calendarId).map((p) => p.nombre);
  const avisos = [];
  if (f && !fs.existsSync(f)) avisos.push(`GOOGLE_SA_KEY_FILE apunta a un archivo que no existe: ${f}`);
  if (f && fs.existsSync(f)) {
    const repo = require("path").resolve(__dirname, "..");
    if (require("path").resolve(f).startsWith(repo + require("path").sep)) avisos.push("La clave de la cuenta de servicio está dentro del proyecto: muévela fuera para que nunca acabe en git.");
  }
  if (!f && conCalendario.length) avisos.push(`Hay calendarId para ${conCalendario.join(", ")} pero falta GOOGLE_SA_KEY_FILE: no se usará Google Calendar.`);
  const activo = configurado() && conCalendario.length > 0;
  return { texto: activo ? `activado (${conCalendario.join(", ")})` : "desactivado", avisos };
}

module.exports = {
  configurado,
  estadoConfiguracion,
  obtenerBloqueos,
  bloqueosParaMostrar,
  crearEvento,
  moverEvento,
  borrarEvento,
  bloqueosDeFreebusy,
  quitarIntervalo,
  usarClienteDePrueba,
};
