// Envío de emails. Con RESEND_API_KEY se envían con Resend; sin ella, se
// imprimen en la consola (modo local, para probar sin cuentas externas).
const { Resend } = require("resend");

let cliente = null;
const clave = () => (process.env.RESEND_API_KEY || "").trim();
const modoConsola = () => !clave();

function resend() {
  if (!cliente) cliente = new Resend(clave());
  return cliente;
}

/**
 * @param {object} m  { to, subject, html, text, replyTo, attachments: [{ filename, content (string|Buffer), contentType }] }
 * @returns {Promise<{ id: string|null, modo: "resend"|"consola" }>}  Lanza un error si no se pudo enviar.
 */
async function enviarEmail(m) {
  if (modoConsola()) {
    const linea = "─".repeat(60);
    console.log(
      [
        "",
        linea,
        `EMAIL (modo consola: no hay RESEND_API_KEY)`,
        `Para:    ${m.to}`,
        m.replyTo ? `Responder a: ${m.replyTo}` : null,
        `Asunto:  ${m.subject}`,
        (m.attachments || []).length ? `Adjuntos: ${m.attachments.map((a) => a.filename).join(", ")}` : null,
        linea,
        m.text,
        linea,
        "",
      ]
        .filter((l) => l !== null)
        .join("\n"),
    );
    return { id: null, modo: "consola" };
  }

  const from = (process.env.EMAIL_FROM || "").trim();
  if (!from) throw new Error("Falta EMAIL_FROM en env/.env (remitente verificado en Resend).");

  // Resend no lanza excepciones: devuelve { data, error }.
  const { data, error } = await resend().emails.send({
    from,
    to: m.to,
    subject: m.subject,
    html: m.html,
    text: m.text,
    replyTo: m.replyTo,
    attachments: (m.attachments || []).map((a) => ({
      filename: a.filename,
      content: Buffer.isBuffer(a.content) ? a.content : Buffer.from(a.content, "utf8"),
      contentType: a.contentType,
    })),
  });
  if (error) throw new Error(`Resend: ${error.name || "error"}: ${error.message || JSON.stringify(error)}`);
  return { id: data && data.id, modo: "resend" };
}

module.exports = { enviarEmail, modoConsola };
