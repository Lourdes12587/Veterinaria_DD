// API de la agenda. Se monta en /api y recibe la configuración completa del
// negocio (con horarios y márgenes). Al navegador solo se envían horas.
const express = require("express");
const { DateTime } = require("luxon");
const { rateLimit } = require("express-rate-limit");
const { query, validationResult } = require("express-validator");
const db = require("../../config/db");
const { calcularHuecos } = require("../../services/disponibilidad");

module.exports = function crearRouterAgenda(negocio) {
  const router = express.Router();

  const limiteHuecos = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Demasiadas consultas seguidas. Espera un minuto y vuelve a intentarlo." },
  });

  const servicioIds = negocio.servicios.map((s) => s.id);
  const profesionalIds = ["cualquiera", ...negocio.profesionales.map((p) => p.id)];

  router.get(
    "/:slug/huecos",
    limiteHuecos,
    query("servicio").isIn(servicioIds).withMessage("El servicio no existe."),
    query("profesional").optional({ values: "falsy" }).isIn(profesionalIds).withMessage("El profesional no existe."),
    query("fecha")
      .matches(/^\d{4}-\d{2}-\d{2}$/)
      .withMessage("La fecha debe tener el formato AAAA-MM-DD.")
      .bail()
      .custom((v) => DateTime.fromISO(v).isValid)
      .withMessage("La fecha no existe."),
    async (req, res) => {
      res.set("Cache-Control", "no-store");
      if (req.params.slug !== negocio.slug) return res.status(404).json({ error: "Negocio no encontrado." });

      const errores = validationResult(req);
      if (!errores.isEmpty()) return res.status(400).json({ error: errores.array()[0].msg });

      const servicioId = req.query.servicio;
      const profesionalId = req.query.profesional || "cualquiera";
      const fecha = req.query.fecha;

      const candidatos = negocio.profesionales.filter(
        (p) => p.servicios.includes(servicioId) && (profesionalId === "cualquiera" || p.id === profesionalId),
      );
      if (candidatos.length === 0) return res.status(400).json({ error: "Ese profesional no hace este servicio." });

      // Citas que tocan ese día (en hora del negocio), pasado a UTC para la consulta.
      const dia = DateTime.fromISO(fecha, { zone: negocio.zonaHoraria });
      const desde = dia.toJSDate();
      const hasta = dia.plus({ days: 1 }).toJSDate();

      let filas;
      try {
        [filas] = await db.query(
          `SELECT profesional, inicio, fin_bloqueo
             FROM citas
            WHERE negocio = ? AND estado = 'confirmada' AND profesional IN (?)
              AND inicio < ? AND fin_bloqueo > ?`,
          [negocio.slug, candidatos.map((p) => p.id), hasta, desde],
        );
      } catch (e) {
        console.error("Error al leer citas:", e.code || e.message);
        return res.status(503).json({ error: "La agenda no está disponible ahora mismo. Inténtalo más tarde." });
      }

      const citas = filas.map((f) => ({ profesional: f.profesional, inicio: f.inicio, finBloqueo: f.fin_bloqueo }));
      const bloqueos = []; // Google Calendar (freebusy) llega en la Fase 6.

      const huecos = calcularHuecos({ negocio, servicioId, profesionalId, fecha, citas, bloqueos, ahora: new Date() });
      res.json({ fecha, servicio: servicioId, profesional: profesionalId, zonaHoraria: negocio.zonaHoraria, huecos });
    },
  );

  return router;
};
