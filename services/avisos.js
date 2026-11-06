// Aviso al negocio por webhook (n8n → Telegram).
// Si N8N_WEBHOOK_URL está vacía, no se envía nada y no es un error.
const TIEMPO_MAX_MS = 5000;

/**
 * @param {string} evento  "reserva" | "cambio" | "cancelacion"
 * @param {object} datos   Lo que recibe n8n (sin tokens).
 * @returns {Promise<boolean>}  true si se envió; false si no hay URL configurada. Lanza si falla.
 */
async function avisarNegocio(evento, datos) {
  const url = (process.env.N8N_WEBHOOK_URL || "").trim();
  if (!url) return false;
  const secreto = (process.env.N8N_WEBHOOK_SECRET || "").trim();
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(secreto ? { "x-webhook-secret": secreto } : {}) },
    body: JSON.stringify({ evento, enviadoAt: new Date().toISOString(), ...datos }),
    signal: AbortSignal.timeout(TIEMPO_MAX_MS),
  });
  if (!r.ok) throw new Error(`n8n respondió ${r.status}`);
  return true;
}

module.exports = { avisarNegocio };
