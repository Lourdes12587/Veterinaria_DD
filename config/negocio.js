// Carga y valida la configuración del negocio (config/negocios/<slug>.json).
// Si algo está mal, la app no debe arrancar: es mejor fallar al inicio que
// mostrar huecos erróneos a un cliente.
const fs = require("fs");
const path = require("path");
const { IANAZone } = require("luxon");

const DIAS = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"];
const TRAMO = /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const minutos = (hh, mm) => Number(hh) * 60 + Number(mm);

function validar(cfg) {
  const errores = [];
  const err = (msg) => errores.push(msg);
  const esTexto = (v) => typeof v === "string" && v.trim() !== "";
  const esEntero = (v, min = 0) => Number.isInteger(v) && v >= min;

  if (typeof cfg !== "object" || cfg === null || Array.isArray(cfg)) {
    return ["El archivo debe contener un objeto JSON."];
  }

  // Campos generales
  if (!esTexto(cfg.slug) || !SLUG.test(cfg.slug)) err('"slug" debe ser texto en minúsculas con guiones (ej. "dog-dd").');
  for (const campo of ["nombre", "telefono", "emailNegocio"]) {
    if (!esTexto(cfg[campo])) err(`"${campo}" es obligatorio y debe ser texto.`);
  }
  if (cfg.subtitulo !== undefined && typeof cfg.subtitulo !== "string") err('"subtitulo" debe ser texto.');
  if (!esTexto(cfg.zonaHoraria) || !IANAZone.isValidZone(cfg.zonaHoraria)) {
    err(`"zonaHoraria" no es una zona válida: ${JSON.stringify(cfg.zonaHoraria)} (ej. "Europe/Madrid").`);
  }
  if (typeof cfg.etiquetaDemo !== "boolean") err('"etiquetaDemo" debe ser true o false.');
  if (!esEntero(cfg.pasoMinutos, 5) || 60 % cfg.pasoMinutos !== 0) err('"pasoMinutos" debe ser un entero que divida 60 (5, 10, 15, 20, 30 o 60).');
  for (const campo of ["antelacionMinimaHoras", "cancelacionMinimaHoras"]) {
    if (!esEntero(cfg[campo], 0)) err(`"${campo}" debe ser un entero mayor o igual que 0.`);
  }
  if (!esEntero(cfg.diasVisibles, 1)) err('"diasVisibles" debe ser un entero mayor que 0.');

  // Servicios
  const idsServicios = new Set();
  if (!Array.isArray(cfg.servicios) || cfg.servicios.length === 0) {
    err('"servicios" debe ser una lista con al menos un servicio.');
  } else {
    cfg.servicios.forEach((s, i) => {
      const donde = `servicios[${i}]${s && s.id ? ` ("${s.id}")` : ""}`;
      if (!s || typeof s !== "object") return err(`${donde} debe ser un objeto.`);
      if (!esTexto(s.id) || !SLUG.test(s.id)) err(`${donde}: "id" debe ser texto en minúsculas con guiones.`);
      else if (idsServicios.has(s.id)) err(`${donde}: el id "${s.id}" está repetido.`);
      else idsServicios.add(s.id);
      if (!esTexto(s.nombre)) err(`${donde}: falta "nombre".`);
      if (!esEntero(s.minutos, 1)) err(`${donde}: "minutos" debe ser un entero mayor que 0.`);
      if (typeof s.precio !== "number" || s.precio < 0) err(`${donde}: "precio" debe ser un número mayor o igual que 0.`);
      if (!esEntero(s.margenMin, 0)) err(`${donde}: "margenMin" debe ser un entero mayor o igual que 0.`);
    });
  }

  // Profesionales
  const idsProfesionales = new Set();
  const serviciosCubiertos = new Set();
  if (!Array.isArray(cfg.profesionales) || cfg.profesionales.length === 0) {
    err('"profesionales" debe ser una lista con al menos un profesional.');
  } else {
    cfg.profesionales.forEach((p, i) => {
      const donde = `profesionales[${i}]${p && p.id ? ` ("${p.id}")` : ""}`;
      if (!p || typeof p !== "object") return err(`${donde} debe ser un objeto.`);
      if (!esTexto(p.id) || !SLUG.test(p.id)) err(`${donde}: "id" debe ser texto en minúsculas con guiones.`);
      else if (p.id === "cualquiera") err(`${donde}: "cualquiera" está reservado para la opción "Cualquiera".`);
      else if (idsProfesionales.has(p.id)) err(`${donde}: el id "${p.id}" está repetido.`);
      else idsProfesionales.add(p.id);
      if (!esTexto(p.nombre)) err(`${donde}: falta "nombre".`);
      if (p.rol !== undefined && typeof p.rol !== "string") err(`${donde}: "rol" debe ser texto.`);
      if (typeof p.calendarId !== "string") err(`${donde}: "calendarId" debe ser texto (puede estar vacío).`);

      if (!Array.isArray(p.servicios) || p.servicios.length === 0) {
        err(`${donde}: "servicios" debe ser una lista con al menos un id.`);
      } else {
        p.servicios.forEach((id) => {
          if (!idsServicios.has(id)) err(`${donde}: el servicio "${id}" no existe en "servicios".`);
          else serviciosCubiertos.add(id);
        });
      }

      if (!p.horario || typeof p.horario !== "object" || Array.isArray(p.horario)) {
        return err(`${donde}: "horario" debe ser un objeto con días (lun, mar, mie, jue, vie, sab, dom).`);
      }
      for (const [dia, tramos] of Object.entries(p.horario)) {
        if (!DIAS.includes(dia)) {
          err(`${donde}: el día "${dia}" no es válido. Usa: ${DIAS.join(", ")}.`);
          continue;
        }
        if (!Array.isArray(tramos)) {
          err(`${donde}: horario.${dia} debe ser una lista de tramos "HH:MM-HH:MM".`);
          continue;
        }
        const rangos = [];
        tramos.forEach((t) => {
          const m = typeof t === "string" && t.match(TRAMO);
          if (!m) return err(`${donde}: horario.${dia} tiene un tramo con formato incorrecto: ${JSON.stringify(t)} (debe ser "HH:MM-HH:MM").`);
          const desde = minutos(m[1], m[2]);
          const hasta = minutos(m[3], m[4]);
          if (desde >= hasta) return err(`${donde}: horario.${dia} "${t}": la hora de inicio debe ser anterior a la de fin.`);
          rangos.push([desde, hasta, t]);
        });
        rangos.sort((a, b) => a[0] - b[0]);
        for (let k = 1; k < rangos.length; k++) {
          if (rangos[k][0] < rangos[k - 1][1]) err(`${donde}: horario.${dia} tiene tramos que se solapan: "${rangos[k - 1][2]}" y "${rangos[k][2]}".`);
        }
      }
    });
  }

  for (const id of idsServicios) {
    if (!serviciosCubiertos.has(id)) err(`El servicio "${id}" no lo hace ningún profesional.`);
  }

  return errores;
}

// Lo único que puede llegar al navegador: sin calendarId ni emailNegocio.
function versionPublica(cfg) {
  return {
    slug: cfg.slug,
    nombre: cfg.nombre,
    subtitulo: cfg.subtitulo || "",
    zonaHoraria: cfg.zonaHoraria,
    telefono: cfg.telefono,
    etiquetaDemo: cfg.etiquetaDemo,
    diasVisibles: cfg.diasVisibles,
    cancelacionMinimaHoras: cfg.cancelacionMinimaHoras,
    servicios: cfg.servicios.map(({ id, nombre, minutos, precio }) => ({ id, nombre, minutos, precio })),
    profesionales: cfg.profesionales.map(({ id, nombre, rol, servicios }) => ({ id, nombre, rol: rol || "", servicios: [...servicios] })),
  };
}

function cargarNegocio(slug) {
  if (!slug || !SLUG.test(slug)) {
    throw new Error(`NEGOCIO no es válido: ${JSON.stringify(slug)}. Revisa env/.env (ej. NEGOCIO=dog-dd).`);
  }
  const archivo = path.join(__dirname, "negocios", `${slug}.json`);
  let texto;
  try {
    texto = fs.readFileSync(archivo, "utf8");
  } catch {
    throw new Error(`No encuentro ${path.relative(process.cwd(), archivo)}.`);
  }
  let cfg;
  try {
    cfg = JSON.parse(texto);
  } catch (e) {
    throw new Error(`${path.basename(archivo)} no es JSON válido: ${e.message}`);
  }
  const errores = validar(cfg);
  if (cfg && cfg.slug !== undefined && cfg.slug !== slug) {
    errores.push(`"slug" es "${cfg.slug}" pero el archivo se llama ${slug}.json; deben coincidir.`);
  }
  if (errores.length) {
    throw new Error(`${path.basename(archivo)} tiene ${errores.length} error(es):\n  - ${errores.join("\n  - ")}`);
  }
  return Object.freeze({ completo: cfg, publico: versionPublica(cfg) });
}

module.exports = { cargarNegocio, validar, versionPublica };
