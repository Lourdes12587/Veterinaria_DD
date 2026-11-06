// API de la agenda. Se monta en /api y recibe la configuración completa del
// negocio (con horarios y márgenes). Al navegador solo se envían horas.
const express = require("express");
const { DateTime } = require("luxon");
const { rateLimit } = require("express-rate-limit");
const { query, validationResult } = require("express-validator");
const { calcularHuecos, calcularDias, fechasVisibles } = require("../../services/disponibilidad");
const { candidatos, citasEntre } = require("../../services/citas");
const { etiquetaDia } = require("../../services/formato");
const { buscarPorToken } = require("../../services/reservas");
const calendario = require("../../services/calendario");

module.exports = function crearRouterAgenda(negocio) {
  const router = express.Router();

  const limiteConsultas = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Demasiadas consultas seguidas. Espera un minuto y vuelve a intentarlo." },
  });

  const servicioIds = negocio.servicios.map((s) => s.id);
  const profesionalIds = ["cualquiera", ...negocio.profesionales.map((p) => p.id)];

  const validarServicio = query("servicio").isIn(servicioIds).withMessage("El servicio no existe.");
  const validarProfesional = query("profesional").optional({ values: "falsy" }).isIn(profesionalIds).withMessage("El profesional no existe.");
  const validarFecha = query("fecha")
    .matches(/^\d{4}-\d{2}-\d{2}$/)
    .withMessage("La fecha debe tener el formato AAAA-MM-DD.")
    .bail()
    .custom((v) => DateTime.fromISO(v).isValid)
    .withMessage("La fecha no existe.");

  // Comprobaciones comunes. Devuelve los datos o responde con el error.
  function preparar(req, res) {
    res.set("Cache-Control", "no-store");
    if (req.params.slug !== negocio.slug) {
      res.status(404).json({ error: "Negocio no encontrado." });
      return null;
    }
    const errores = validationResult(req);
    if (!errores.isEmpty()) {
      res.status(400).json({ error: errores.array()[0].msg });
      return null;
    }
    const servicioId = req.query.servicio;
    const profesionalId = req.query.profesional || "cualquiera";
    const pros = candidatos(negocio, servicioId, profesionalId);
    if (pros.length === 0) {
      res.status(400).json({ error: "Ese profesional no hace este servicio." });
      return null;
    }
    return { servicioId, profesionalId, ids: pros.map((p) => p.id) };
  }

  const noDisponible = (res, e) => {
    console.error("Error al leer citas:", e.code || e.message);
    res.status(503).json({ error: "La agenda no está disponible ahora mismo. Inténtalo más tarde." });
  };

  // Al cambiar una cita, la página envía su token en la cabecera X-Cita-Token
  // (no en la URL, para que no quede en los registros del servidor):
  // así su propia hora no cuenta como ocupada (ni en MySQL ni en Google).
  async function citaPropia(req) {
    const token = req.get("X-Cita-Token");
    if (!token) return null;
    const cita = await buscarPorToken(negocio, token);
    return cita && cita.estado === "confirmada" ? cita : null;
  }
  const ignorarDe = (c) => (c ? { profesional: c.profesional, inicio: c.inicio, fin: c.fin } : null);

  // Horas libres de un día.
  router.get("/:slug/huecos", limiteConsultas, validarServicio, validarProfesional, validarFecha, async (req, res) => {
    const p = preparar(req, res);
    if (!p) return;
    const fecha = req.query.fecha;
    const dia = DateTime.fromISO(fecha, { zone: negocio.zonaHoraria });
    try {
      const propia = await citaPropia(req);
      const rango = { desde: dia.toJSDate(), hasta: dia.plus({ days: 1 }).toJSDate() };
      const [citas, bloqueos] = await Promise.all([
        citasEntre({ negocio, profesionales: p.ids, ...rango, excluirId: propia && propia.id }),
        calendario.bloqueosParaMostrar(negocio, { profesionales: p.ids, ...rango, ignorar: ignorarDe(propia) }),
      ]);
      const huecos = calcularHuecos({ negocio, servicioId: p.servicioId, profesionalId: p.profesionalId, fecha, citas, bloqueos, ahora: new Date() });
      res.json({ fecha, servicio: p.servicioId, profesional: p.profesionalId, zonaHoraria: negocio.zonaHoraria, huecos });
    } catch (e) {
      noDisponible(res, e);
    }
  });

  // Días visibles y si tienen huecos (para desactivar los llenos).
  router.get("/:slug/dias", limiteConsultas, validarServicio, validarProfesional, async (req, res) => {
    const p = preparar(req, res);
    if (!p) return;
    const ahora = new Date();
    const fechas = fechasVisibles(negocio, ahora);
    const desde = DateTime.fromISO(fechas[0], { zone: negocio.zonaHoraria });
    const hasta = DateTime.fromISO(fechas.at(-1), { zone: negocio.zonaHoraria }).plus({ days: 1 });
    try {
      const propia = await citaPropia(req);
      const rango = { desde: desde.toJSDate(), hasta: hasta.toJSDate() };
      const [citas, bloqueos] = await Promise.all([
        citasEntre({ negocio, profesionales: p.ids, ...rango, excluirId: propia && propia.id }),
        calendario.bloqueosParaMostrar(negocio, { profesionales: p.ids, ...rango, ignorar: ignorarDe(propia) }),
      ]);
      const dias = calcularDias({ negocio, servicioId: p.servicioId, profesionalId: p.profesionalId, citas, bloqueos, ahora })
        .map((d) => ({ ...d, etiqueta: etiquetaDia(d.fecha, negocio.zonaHoraria) }));
      res.json({ servicio: p.servicioId, profesional: p.profesionalId, dias });
    } catch (e) {
      noDisponible(res, e);
    }
  });

  return router;
};
