// Lanza 10 reservas a la vez al mismo hueco. Debe entrar exactamente 1.
//
// Uso:  node scripts/prueba-concurrencia.js [--conservar]
// Usa la base de env/.env. Al terminar borra la cita de prueba (salvo --conservar).
//
// Llama directamente a services/reservas.js en vez de pasar por HTTP: así se
// prueba el candado y no el límite de 5 reservas por hora de la ruta.
require("dotenv").config({ path: require("path").join(__dirname, "../env/.env"), quiet: true });
const { cargarNegocio } = require("../config/negocio");
const db = require("../config/db");
const { calcularHuecos, fechasVisibles } = require("../services/disponibilidad");
const { citasEntre } = require("../services/citas");
const { reservar } = require("../services/reservas");
const { DateTime } = require("luxon");

const INTENTOS = 10;

(async () => {
  const negocio = cargarNegocio(process.env.NEGOCIO || "dog-dd").completo;
  const servicio = negocio.servicios[0];
  const profesional = negocio.profesionales.find((p) => p.servicios.includes(servicio.id));
  const ahora = new Date();

  // Primer hueco libre real de ese profesional.
  let hueco = null;
  for (const fecha of fechasVisibles(negocio, ahora)) {
    const dia = DateTime.fromISO(fecha, { zone: negocio.zonaHoraria });
    const citas = await citasEntre({ negocio, profesionales: [profesional.id], desde: dia.toJSDate(), hasta: dia.plus({ days: 1 }).toJSDate() });
    hueco = calcularHuecos({ negocio, servicioId: servicio.id, profesionalId: profesional.id, fecha, citas, ahora })[0];
    if (hueco) break;
  }
  if (!hueco) throw new Error("No hay ningún hueco libre en los próximos días.");
  console.log(`Hueco: ${servicio.nombre} con ${profesional.nombre}, ${hueco.inicio} (${hueco.hora} en ${negocio.zonaHoraria})`);
  console.log(`Lanzando ${INTENTOS} reservas a la vez…`);

  const datos = (i) => ({
    servicio: servicio.id,
    profesional: profesional.id,
    inicio: hueco.inicio,
    nombre: `Prueba concurrencia ${i}`,
    telefono: "600000000",
    email: `prueba${i}@example.com`,
    nota: "",
  });
  const resultados = await Promise.allSettled(Array.from({ length: INTENTOS }, (_, i) => reservar({ negocio, datos: datos(i + 1) })));

  const entraron = resultados.filter((r) => r.status === "fulfilled").map((r) => r.value.cita);
  const motivos = {};
  for (const r of resultados) {
    if (r.status === "rejected") motivos[r.reason.codigo || r.reason.message] = (motivos[r.reason.codigo || r.reason.message] || 0) + 1;
  }
  console.log(`Resultado: ${entraron.length} reserva${entraron.length === 1 ? "" : "s"}. Rechazadas: ${JSON.stringify(motivos)}`);

  const [[{ n }]] = await db.query("SELECT COUNT(*) AS n FROM citas WHERE negocio = ? AND profesional = ? AND inicio = ? AND estado = 'confirmada'", [negocio.slug, profesional.id, new Date(hueco.inicio)]);
  console.log(`En la base hay ${n} cita(s) confirmada(s) en ese hueco.`);

  if (!process.argv.includes("--conservar") && entraron.length) {
    await db.query("DELETE FROM citas WHERE id IN (?)", [entraron.map((c) => c.id)]);
    console.log("Cita de prueba borrada.");
  }
  await db.end();
  process.exit(entraron.length === 1 && Number(n) === 1 ? 0 : 1);
})().catch(async (e) => {
  console.error("Error:", e.message);
  await db.end().catch(() => {});
  process.exit(1);
});
