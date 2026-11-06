// Ejecuta una vuelta de recordatorios ahora, sin esperar a node-cron.
// Uso: node scripts/recordatorios.js
// Es seguro lanzarlo con la app en marcha: un candado evita enviar dos veces.
require("dotenv").config({ path: require("path").join(__dirname, "../env/.env"), quiet: true });
const { cargarNegocio } = require("../config/negocio");
const db = require("../config/db");
const { enviarRecordatorios } = require("../services/recordatorios");

(async () => {
  const negocio = cargarNegocio(process.env.NEGOCIO || "dog-dd").completo;
  const r = await enviarRecordatorios(negocio);
  if (r.saltado) console.log("Otro proceso está enviando recordatorios ahora mismo. No se ha hecho nada.");
  else console.log(`Revisadas: ${r.revisadas} · enviados: ${r.enviados} · fallidos: ${r.fallidos}`);
  await db.end();
})().catch(async (e) => {
  console.error("Error:", e.message);
  await db.end().catch(() => {});
  process.exit(1);
});
