// Reservar una cita sin dobles reservas.
//
// Por qué un candado y no solo una transacción:
// para saber si un hueco está libre hacemos un SELECT que no devuelve filas
// (no hay ninguna cita ahí). Una transacción solo bloquea filas que existen,
// así que dos peticiones a la vez leen "libre", insertan las dos y la base
// acepta ambas: no hay ninguna fila en común por la que tengan que esperar.
// GET_LOCK pone un candado con nombre ("agenda:<negocio>:<profesional>") que
// solo una conexión puede tener: la segunda petición espera a que la primera
// haya insertado y, al comprobar, ya ve la cita.
const crypto = require("crypto");
const { DateTime } = require("luxon");
const db = require("../config/db");
const { calcularHuecos } = require("./disponibilidad");
const { candidatos, citasEntre } = require("./citas");

const ESPERA_CANDADO_S = 5;
const TOKEN = /^[A-Za-z0-9_-]{43}$/; // 32 bytes en base64url

class ErrorReserva extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.codigo = codigo; // "no_valido" | "ocupado" | "candado" | "configuracion"
  }
}

function pepper() {
  const p = process.env.TOKEN_PEPPER;
  if (!p) throw new ErrorReserva("configuracion", "Falta TOKEN_PEPPER en env/.env.");
  return p;
}
const nuevoToken = () => crypto.randomBytes(32).toString("base64url");
const hashToken = (token) => crypto.createHash("sha256").update(token + pepper()).digest("hex");

// Ejecuta fn con el candado tomado en ESA conexión y lo suelta siempre.
async function conCandado(conexion, nombre, fn) {
  const [[{ ok }]] = await conexion.query("SELECT GET_LOCK(?, ?) AS ok", [nombre, ESPERA_CANDADO_S]);
  if (ok !== 1) throw new ErrorReserva("candado", "Hay mucha gente reservando ahora mismo. Inténtalo de nuevo en unos segundos.");
  try {
    return await fn();
  } finally {
    try {
      await conexion.query("DO RELEASE_LOCK(?)", [nombre]);
    } catch {
      // Si no se puede soltar, se cierra la conexión: MySQL suelta sus candados al cerrarla.
      conexion.destroy();
    }
  }
}

async function registrarEvento(citaId, tipo, detalle = null, conexion = db) {
  try {
    await conexion.query("INSERT INTO eventos (cita_id, tipo, detalle) VALUES (?, ?, ?)", [citaId, tipo, detalle && JSON.stringify(detalle)]);
  } catch (e) {
    console.error(`No se pudo guardar el evento "${tipo}" de la cita ${citaId}:`, e.code || e.message);
  }
}

/**
 * Reserva un hueco. Lanza ErrorReserva si no se puede.
 * @param {object} p.negocio  Configuración completa.
 * @param {object} p.datos    { servicio, profesional, inicio (ISO UTC), nombre, telefono, email, nota }
 * @param {Function} [p.obtenerBloqueos]  async ({ profesional, desde, hasta }) => [{ profesional, inicio, fin }] (Google, Fase 6)
 * @param {number} [p.reemplazaCitaId]  Al cambiar una cita: no cuenta como ocupada y se cancela
 *                                     en la misma transacción que crea la nueva (si la nueva no entra,
 *                                     la antigua sigue igual).
 * @param {Date}   [p.privacidadAceptadaAt]  Al cambiar, se conserva la fecha en que aceptó.
 */
async function reservar({ negocio, datos, ahora = new Date(), obtenerBloqueos = async () => [], reemplazaCitaId = null, privacidadAceptadaAt = null }) {
  const ignorarCitaId = reemplazaCitaId;
  const servicio = negocio.servicios.find((s) => s.id === datos.servicio);
  if (!servicio) throw new ErrorReserva("no_valido", "El servicio no existe.");
  const inicio = DateTime.fromISO(datos.inicio, { zone: "utc" });
  if (!inicio.isValid) throw new ErrorReserva("no_valido", "La hora no es válida.");
  const pros = candidatos(negocio, servicio.id, datos.profesional || "cualquiera");
  if (pros.length === 0) throw new ErrorReserva("no_valido", "Ese profesional no hace este servicio.");

  const token = nuevoToken();
  const tokenHash = hashToken(token); // falla pronto si falta TOKEN_PEPPER
  const inicioIso = inicio.toJSDate().toISOString();
  const dia = inicio.setZone(negocio.zonaHoraria).startOf("day");
  const fecha = dia.toISODate();
  const desde = dia.toJSDate();
  const hasta = dia.plus({ days: 1 }).toJSDate();

  // Con "Cualquiera", se prueba primero con quien tiene menos citas ese día.
  // Es solo el orden de intento: la comprobación buena es la de dentro del candado.
  let orden = pros.map((p) => p.id);
  if (orden.length > 1) {
    const delDia = await citasEntre({ negocio, profesionales: orden, desde, hasta, excluirId: ignorarCitaId });
    const carga = (id) => delDia.filter((c) => c.profesional === id && c.inicio >= desde).length;
    orden = orden.map((id, i) => ({ id, i, c: carga(id) })).sort((a, b) => a.c - b.c || a.i - b.i).map((x) => x.id);
  }

  for (const profesional of orden) {
    const conexion = await db.getConnection();
    let cita = null;
    try {
      cita = await conCandado(conexion, `agenda:${negocio.slug}:${profesional}`, async () => {
        const citas = await citasEntre({ negocio, profesionales: [profesional], desde, hasta, conexion, excluirId: ignorarCitaId });
        const bloqueos = await obtenerBloqueos({ profesional, desde, hasta });
        const libres = calcularHuecos({ negocio, servicioId: servicio.id, profesionalId: profesional, fecha, citas, bloqueos, ahora });
        if (!libres.some((h) => h.inicio === inicioIso)) return null;

        const fin = inicio.plus({ minutes: servicio.minutos });
        const finBloqueo = fin.plus({ minutes: servicio.margenMin });
        const nueva = {
          negocio: negocio.slug,
          profesional,
          servicio: servicio.id,
          inicio: inicio.toJSDate(),
          fin: fin.toJSDate(),
          finBloqueo: finBloqueo.toJSDate(),
          clienteNombre: datos.nombre,
          clienteTelefono: datos.telefono,
          clienteEmail: datos.email,
          nota: datos.nota || null,
        };
        // Al cambiar, crear la nueva y cancelar la antigua es todo o nada.
        if (reemplazaCitaId) await conexion.beginTransaction();
        try {
          const [r] = await conexion.query(
            `INSERT INTO citas (negocio, profesional, servicio, inicio, fin, fin_bloqueo,
                                cliente_nombre, cliente_telefono, cliente_email, nota,
                                estado, token_hash, privacidad_aceptada_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmada', ?, ?)`,
            [nueva.negocio, nueva.profesional, nueva.servicio, nueva.inicio, nueva.fin, nueva.finBloqueo,
              nueva.clienteNombre, nueva.clienteTelefono, nueva.clienteEmail, nueva.nota, tokenHash, privacidadAceptadaAt || ahora],
          );
          if (reemplazaCitaId) {
            // "AND estado = 'confirmada'": si dos clics llegan a la vez, solo uno cambia la cita.
            const [u] = await conexion.query("UPDATE citas SET estado = 'cancelada' WHERE id = ? AND negocio = ? AND estado = 'confirmada'", [reemplazaCitaId, negocio.slug]);
            if (u.affectedRows !== 1) throw new ErrorReserva("ya_cambiada", "Esta cita ya se cambió o se canceló.");
            await conexion.commit();
          }
          return { id: r.insertId, ...nueva, estado: "confirmada" };
        } catch (e) {
          if (reemplazaCitaId) await conexion.rollback().catch(() => {});
          throw e;
        }
      });
    } finally {
      conexion.release();
    }
    if (cita) return { cita, token };
  }
  throw new ErrorReserva("ocupado", "Esa hora se acaba de ocupar. Elige otra, tus datos siguen aquí.");
}

// Tareas después de soltar el candado. Si fallan, la cita sigue siendo válida
// y el error queda apuntado en "eventos".
// Fase 5: email y aviso a n8n. Fase 6: evento en Google Calendar.
async function despuesDeReservar({ cita, token }) {
  await registrarEvento(cita.id, "creada", { profesional: cita.profesional, servicio: cita.servicio });
  const base = (process.env.URL_PUBLICA || `http://localhost:${process.env.PORT || 4000}`).trim().replace(/\/$/, "");
  console.log(`Cita #${cita.id} creada (${cita.profesional}, ${cita.inicio.toISOString()}). Enlace del cliente: ${base}/cita/${token}`);
}

// Cancelar: solo una cita confirmada. Devuelve true si la ha cancelado ahora.
async function cancelar({ negocio, citaId }) {
  const [u] = await db.query("UPDATE citas SET estado = 'cancelada' WHERE id = ? AND negocio = ? AND estado = 'confirmada'", [citaId, negocio.slug]);
  return u.affectedRows === 1;
}

// Tareas después de cambiar o cancelar (Fase 5: email y n8n; Fase 6: Google).
async function despuesDeCambiar({ anterior, cita, token }) {
  await registrarEvento(anterior.id, "cambiada", { nueva: cita.id, inicioAnterior: anterior.inicio, inicioNuevo: cita.inicio });
  await registrarEvento(cita.id, "creada", { cambiadaDesde: anterior.id, profesional: cita.profesional, servicio: cita.servicio });
  const base = (process.env.URL_PUBLICA || `http://localhost:${process.env.PORT || 4000}`).trim().replace(/\/$/, "");
  console.log(`Cita #${anterior.id} cambiada por #${cita.id} (${cita.profesional}, ${cita.inicio.toISOString()}). Enlace nuevo del cliente: ${base}/cita/${token}`);
}

async function despuesDeCancelar({ cita }) {
  await registrarEvento(cita.id, "cancelada", { inicio: cita.inicio });
  console.log(`Cita #${cita.id} cancelada por el cliente.`);
}

async function buscarPorToken(negocio, token) {
  if (typeof token !== "string" || !TOKEN.test(token)) return null;
  const [filas] = await db.query("SELECT * FROM citas WHERE negocio = ? AND token_hash = ? LIMIT 1", [negocio.slug, hashToken(token)]);
  return filas[0] || null;
}

module.exports = {
  reservar,
  cancelar,
  despuesDeReservar,
  despuesDeCambiar,
  despuesDeCancelar,
  buscarPorToken,
  registrarEvento,
  ErrorReserva,
  hashToken,
  conCandado,
};
