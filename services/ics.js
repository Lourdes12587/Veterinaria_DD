// Archivo .ics (iCalendar, RFC 5545) para "Añadir a mi calendario".
// Las horas van en UTC (sufijo Z): cada calendario las muestra en la zona del usuario.

const escapar = (t = "") => String(t).replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/([,;])/g, "\\$1");
const fechaIcs = (d) => new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

// Las líneas de más de 75 octetos se parten y la continuación empieza con un espacio.
function plegar(linea) {
  const bytes = Buffer.from(linea, "utf8");
  if (bytes.length <= 75) return linea;
  const partes = [];
  let actual = "";
  for (const ch of linea) {
    if (Buffer.byteLength(actual + ch, "utf8") > (partes.length ? 74 : 75)) {
      partes.push(actual);
      actual = "";
    }
    actual += ch;
  }
  partes.push(actual);
  return partes.join("\r\n ");
}

function crearIcs({ uid, inicio, fin, titulo, descripcion = "", organizador = "", ahora = new Date() }) {
  const lineas = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${escapar(organizador || "Agenda")}//Agenda//ES`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${fechaIcs(ahora)}`,
    `DTSTART:${fechaIcs(inicio)}`,
    `DTEND:${fechaIcs(fin)}`,
    `SUMMARY:${escapar(titulo)}`,
    `DESCRIPTION:${escapar(descripcion)}`,
    "STATUS:CONFIRMED",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapar(titulo)}`,
    "TRIGGER:-PT2H",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lineas.map(plegar).join("\r\n") + "\r\n";
}

// .ics de una fila de la tabla citas (para la descarga y el adjunto del email).
function icsDeCita(negocio, cita) {
  const s = negocio.servicios.find((x) => x.id === cita.servicio);
  const p = negocio.profesionales.find((x) => x.id === cita.profesional);
  return crearIcs({
    uid: `cita-${cita.id}@${negocio.slug}`,
    inicio: cita.inicio,
    fin: cita.fin,
    titulo: `${s ? s.nombre : "Cita"} · ${negocio.nombre}`,
    descripcion: `Con ${p ? p.nombre : cita.profesional}. Teléfono de ${negocio.nombre}: ${negocio.telefono}`,
    organizador: negocio.nombre,
  });
}

module.exports = { crearIcs, icsDeCita };
