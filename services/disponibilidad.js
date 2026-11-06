// Cálculo de huecos libres. Función pura: no lee la base ni el reloj.
// Todo lo que necesita llega por parámetros (incluido "ahora"), así se puede
// probar con cualquier fecha, también la del cambio de hora.
//
// Reglas:
// - Las horas del horario son hora local del negocio (zonaHoraria).
// - Un hueco empieza cada `pasoMinutos` desde el inicio de cada tramo.
// - El servicio debe terminar dentro del tramo. El margen (limpieza, notas)
//   puede pasar del cierre: después de cerrar no hay nadie a quien bloquear.
// - Ocupa [inicio, fin + margen). No puede pisar ninguna cita existente
//   (que ocupa [inicio, fin_bloqueo)) ni ningún bloqueo del calendario.
// - Debe empezar al menos `antelacionMinimaHoras` después de "ahora".
// - Solo se ofrecen días entre hoy y hoy + diasVisibles - 1.
const { DateTime } = require("luxon");

const DIAS = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"]; // luxon: weekday 1 = lunes
const MIN = 60 * 1000;

const ms = (v) => (v instanceof Date ? v.getTime() : new Date(v).getTime());
const seSolapan = (a1, a2, b1, b2) => a1 < b2 && b1 < a2; // intervalos [a1, a2) y [b1, b2)

function leerTramo(tramo) {
  const [desde, hasta] = tramo.split("-").map((h) => {
    const [hh, mm] = h.split(":").map(Number);
    return hh * 60 + mm;
  });
  return { desde, hasta };
}

// Hora local exacta de un día. Devuelve null si esa hora no existe ese día
// (por ejemplo las 02:30 del día en que se adelanta el reloj).
function horaLocal(dia, minutosDelDia) {
  const hour = Math.floor(minutosDelDia / 60);
  const minute = minutosDelDia % 60;
  const t = dia.set({ hour, minute, second: 0, millisecond: 0 });
  return t.hour === hour && t.minute === minute ? t : null;
}

function huecosDeProfesional({ profesional, servicio, dia, paso, limiteAntelacion, ocupado }) {
  const tramos = profesional.horario[DIAS[dia.weekday - 1]] || [];
  const huecos = [];
  for (const tramo of tramos) {
    const { desde, hasta } = leerTramo(tramo);
    // El cierre se mide en tiempo real: en el día del cambio de hora
    // un tramo 01:00-04:00 dura 2 horas, no 3.
    const cierre = horaLocal(dia, hasta) || dia.set({ hour: Math.floor(hasta / 60), minute: hasta % 60 });
    for (let m = desde; m < hasta; m += paso) {
      const local = horaLocal(dia, m);
      if (!local) continue; // hora que no existe ese día
      const inicio = local.toMillis();
      const fin = inicio + servicio.minutos * MIN;
      const finBloqueo = fin + servicio.margenMin * MIN;
      if (fin > cierre.toMillis()) continue;
      if (inicio < limiteAntelacion) continue;
      if (ocupado(inicio, finBloqueo)) continue;
      huecos.push(inicio);
    }
  }
  return huecos;
}

/**
 * @param {object}   p
 * @param {object}   p.negocio       Configuración completa del negocio (con horarios y márgenes).
 * @param {string}   p.servicioId
 * @param {string}   [p.profesionalId="cualquiera"]
 * @param {string}   p.fecha         "YYYY-MM-DD", día en la zona horaria del negocio.
 * @param {Array}    [p.citas]       Citas confirmadas: { profesional, inicio, finBloqueo } (Date o ISO).
 * @param {Array}    [p.bloqueos]    Bloqueos del calendario: { profesional, inicio, fin }.
 * @param {Date}     p.ahora
 * @returns {Array<{hora: string, inicio: string, profesional: string}>}  Ordenados por hora.
 */
function calcularHuecos({ negocio, servicioId, profesionalId = "cualquiera", fecha, citas = [], bloqueos = [], ahora }) {
  const servicio = negocio.servicios.find((s) => s.id === servicioId);
  if (!servicio) throw new Error(`El servicio "${servicioId}" no existe.`);

  const zona = negocio.zonaHoraria;
  const dia = DateTime.fromISO(fecha, { zone: zona });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !dia.isValid) throw new Error(`Fecha no válida: "${fecha}".`);
  if (!(ahora instanceof Date) || Number.isNaN(ahora.getTime())) throw new Error('"ahora" debe ser una fecha válida.');

  let candidatos;
  if (profesionalId === "cualquiera") {
    candidatos = negocio.profesionales.filter((p) => p.servicios.includes(servicioId));
  } else {
    const p = negocio.profesionales.find((x) => x.id === profesionalId);
    if (!p) throw new Error(`El profesional "${profesionalId}" no existe.`);
    if (!p.servicios.includes(servicioId)) throw new Error(`${p.nombre} no hace el servicio "${servicioId}".`);
    candidatos = [p];
  }

  const hoy = DateTime.fromJSDate(ahora, { zone: zona }).startOf("day");
  if (dia < hoy || dia >= hoy.plus({ days: negocio.diasVisibles })) return [];

  const inicioDia = dia.toMillis();
  const finDia = dia.plus({ days: 1 }).toMillis();
  const limiteAntelacion = ahora.getTime() + negocio.antelacionMinimaHoras * 60 * MIN;

  const vigentes = citas.filter((c) => c.estado === undefined || c.estado === "confirmada");
  const ocupaciones = (id) => [
    ...vigentes.filter((c) => c.profesional === id).map((c) => [ms(c.inicio), ms(c.finBloqueo)]),
    ...bloqueos.filter((b) => b.profesional === id).map((b) => [ms(b.inicio), ms(b.fin)]),
  ];
  // Carga del día: citas que empiezan ese día. Sirve para repartir "Cualquiera".
  const carga = (id) => vigentes.filter((c) => c.profesional === id && ms(c.inicio) >= inicioDia && ms(c.inicio) < finDia).length;

  // Para cada hora, el profesional libre con menos citas ese día.
  // Empate: el primero en el orden del JSON.
  const porHora = new Map();
  for (const profesional of candidatos) {
    const ocupado_ = ocupaciones(profesional.id);
    const ocupado = (a, b) => ocupado_.some(([c, d]) => seSolapan(a, b, c, d));
    const suCarga = carga(profesional.id);
    const huecos = huecosDeProfesional({ profesional, servicio, dia, paso: negocio.pasoMinutos, limiteAntelacion, ocupado });
    for (const inicio of huecos) {
      const actual = porHora.get(inicio);
      if (!actual || suCarga < actual.carga) porHora.set(inicio, { profesional: profesional.id, carga: suCarga });
    }
  }

  return [...porHora.entries()]
    .sort(([a], [b]) => a - b)
    .map(([inicio, { profesional }]) => ({
      hora: DateTime.fromMillis(inicio, { zone: zona }).toFormat("HH:mm"),
      inicio: new Date(inicio).toISOString(),
      profesional,
    }));
}

module.exports = { calcularHuecos };
