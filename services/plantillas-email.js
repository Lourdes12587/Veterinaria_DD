// Textos de los emails (HTML + texto plano). Todo dato del cliente se escapa.
const fmt = require("./formato");

const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const baseUrl = () => (process.env.URL_PUBLICA || `http://localhost:${process.env.PORT || 4000}`).trim().replace(/\/$/, "");

// Datos comunes de una cita (fila de la tabla citas).
function datosCita(negocio, cita) {
  const s = negocio.servicios.find((x) => x.id === cita.servicio);
  const p = negocio.profesionales.find((x) => x.id === cita.profesional);
  return {
    nombre: cita.cliente_nombre,
    servicio: s ? s.nombre : cita.servicio,
    profesional: p ? p.nombre : cita.profesional,
    fecha: fmt.fechaLarga(cita.inicio, negocio.zonaHoraria),
    hora: fmt.hora(cita.inicio, negocio.zonaHoraria),
    minutos: s ? s.minutos : null,
    precio: s ? fmt.precio(s.precio) : "",
  };
}

function maquetar(negocio, { titulo, parrafos, filas, boton, notas = [] }) {
  const pieDemo = negocio.etiquetaDemo ? "Demo de Creaciones Digitales. Las citas no son reales." : "";
  const html = `<!doctype html>
<html lang="es"><body style="margin:0;padding:0;background:#f2f1ee;font-family:Arial,Helvetica,sans-serif;color:#121110;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f1ee;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;">
<tr><td style="background:#121110;color:#f5c230;padding:20px 24px;font-size:20px;font-weight:bold;">${esc(negocio.nombre)}</td></tr>
<tr><td style="padding:24px;">
<h1 style="margin:0 0 16px;font-size:24px;line-height:1.2;">${esc(titulo)}</h1>
${parrafos.map((p) => `<p style="margin:0 0 12px;font-size:16px;line-height:1.5;">${esc(p)}</p>`).join("\n")}
${filas.length ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;font-size:16px;line-height:1.5;">
${filas.map(([k, v]) => `<tr><td style="padding:2px 16px 2px 0;color:#6b665e;">${esc(k)}</td><td style="padding:2px 0;font-weight:bold;">${esc(v)}</td></tr>`).join("\n")}
</table>` : ""}
${boton ? `<p style="margin:24px 0;"><a href="${esc(boton.url)}" style="display:inline-block;background:#f5c230;color:#121110;padding:14px 22px;font-weight:bold;text-decoration:none;">${esc(boton.texto)}</a></p>` : ""}
${notas.map((p) => `<p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:#6b665e;">${esc(p)}</p>`).join("\n")}
</td></tr>
${pieDemo ? `<tr><td style="padding:12px 24px;font-size:12px;color:#6b665e;border-top:1px solid #e5e2dc;">${esc(pieDemo)}</td></tr>` : ""}
</table></td></tr></table></body></html>`;

  const text = [
    titulo,
    "",
    ...parrafos,
    "",
    ...filas.map(([k, v]) => `${k}: ${v}`),
    ...(boton ? ["", `${boton.texto}: ${boton.url}`] : []),
    ...(notas.length ? ["", ...notas] : []),
    ...(pieDemo ? ["", "--", pieDemo] : []),
  ].join("\n");
  return { html, text };
}

const filasCita = (d) => [
  ["Servicio", d.servicio],
  ["Con", d.profesional],
  ["Día", d.fecha],
  ["Hora", d.hora],
  ...(d.minutos ? [["Duración", `${d.minutos} min`]] : []),
  ...(d.precio ? [["Precio", d.precio]] : []),
];

function confirmacion(negocio, cita, token) {
  const d = datosCita(negocio, cita);
  return {
    subject: `Cita confirmada: ${d.servicio}, ${d.fecha} a las ${d.hora}`,
    ...maquetar(negocio, {
      titulo: "Tu cita está confirmada",
      parrafos: [`Hola, ${d.nombre}. Te esperamos.`],
      filas: filasCita(d),
      boton: { texto: "Ver, cambiar o cancelar la cita", url: `${baseUrl()}/cita/${token}` },
      notas: [
        `Puedes cambiarla o cancelarla desde el enlace hasta ${negocio.cancelacionMinimaHoras} horas antes. Después, llámanos al ${negocio.telefono}.`,
        "Adjuntamos la cita en un archivo .ics para que la añadas a tu calendario.",
      ],
    }),
  };
}

function cambio(negocio, cita, token, anterior) {
  const d = datosCita(negocio, cita);
  const a = datosCita(negocio, anterior);
  return {
    subject: `Cita cambiada: ${d.servicio}, ${d.fecha} a las ${d.hora}`,
    ...maquetar(negocio, {
      titulo: "Hemos cambiado tu cita",
      parrafos: [`Hola, ${d.nombre}. Tu cita del ${a.fecha} a las ${a.hora} queda anulada. Esta es la nueva:`],
      filas: filasCita(d),
      boton: { texto: "Ver, cambiar o cancelar la cita", url: `${baseUrl()}/cita/${token}` },
      notas: [
        "El enlace del email anterior ya no sirve: usa el de este email.",
        "Si añadiste la cita anterior a tu calendario, bórrala y añade el archivo .ics adjunto.",
      ],
    }),
  };
}

function cancelacion(negocio, cita) {
  const d = datosCita(negocio, cita);
  return {
    subject: `Cita cancelada: ${d.servicio}, ${d.fecha} a las ${d.hora}`,
    ...maquetar(negocio, {
      titulo: "Tu cita está cancelada",
      parrafos: [`Hola, ${d.nombre}. Hemos cancelado tu cita.`],
      filas: filasCita(d),
      boton: { texto: "Pedir otra cita", url: `${baseUrl()}/#reservar` },
      notas: ["Si la añadiste a tu calendario, puedes borrarla."],
    }),
  };
}

// El recordatorio no lleva el enlace de la cita: en la base solo guardamos el
// hash del token, así que no podemos volver a escribirlo.
function recordatorio(negocio, cita) {
  const d = datosCita(negocio, cita);
  return {
    subject: `Recordatorio: tu cita es el ${d.fecha} a las ${d.hora}`,
    ...maquetar(negocio, {
      titulo: "Te recordamos tu cita",
      parrafos: [`Hola, ${d.nombre}. Te esperamos:`],
      filas: filasCita(d),
      notas: [`Si necesitas cambiarla o cancelarla, usa el enlace del email de confirmación o llámanos al ${negocio.telefono}.`],
    }),
  };
}

module.exports = { confirmacion, cambio, cancelacion, recordatorio, esc };
