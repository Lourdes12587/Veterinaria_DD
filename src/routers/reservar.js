// Portada con la agenda y POST /reservar.
//
// Funciona sin JavaScript: la portada se pinta en el servidor con la selección
// que llega en la URL (?servicio=&profesional=&fecha=) y el formulario de datos
// hace un POST normal. Con JavaScript, public/js/inicio.js hace lo mismo sin
// recargar la página.
const express = require("express");
const { DateTime } = require("luxon");
const { rateLimit } = require("express-rate-limit");
const { body, validationResult } = require("express-validator");
const { reservar, despuesDeReservar, ErrorReserva } = require("../../services/reservas");
const { crearModeloReserva } = require("../../services/vista-agenda");

const quiereJson = (req) => (req.get("Accept") || "").includes("application/json");

module.exports = function crearRouterReservar(negocio) {
  const router = express.Router();
  const zona = negocio.zonaHoraria;

  const modeloReserva = crearModeloReserva(negocio);

  async function pintarInicio(res, estado = 200, opciones = {}) {
    res.status(estado).render("inicio", { reserva: await modeloReserva(opciones) });
  }

  // --- Portada ---
  router.get("/", async (req, res) => {
    const leer = (k) => (typeof req.query[k] === "string" ? req.query[k] : undefined);
    await pintarInicio(res, 200, { seleccion: { servicio: leer("servicio"), profesional: leer("profesional"), fecha: leer("fecha") } });
  });

  // --- Reservar ---
  const responderError = async (req, res, estado, mensaje, extra = {}) => {
    if (quiereJson(req)) return res.status(estado).json({ error: mensaje, ...extra });
    const b = req.body || {};
    await pintarInicio(res, estado, {
      seleccion: { servicio: b.servicio, profesional: b.profesional, fecha: b.inicio && DateTime.fromISO(b.inicio, { zone: zona }).toISODate(), inicio: b.inicio },
      valores: { nombre: b.nombre, telefono: b.telefono, email: b.email, nota: b.nota, privacidad: b.privacidad === "si" },
      error: mensaje,
    });
  };

  // 5 reservas por hora y por IP. Solo cuentan las que salen bien
  // (un error de validación o una hora ocupada no gastan intentos).
  const limiteReservas = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    skipFailedRequests: true,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (req, res) => responderError(req, res, 429, "Has hecho muchas reservas seguidas. Si necesitas más, llámanos."),
  });

  const servicioIds = negocio.servicios.map((s) => s.id);
  const profesionalIds = ["cualquiera", ...negocio.profesionales.map((p) => p.id)];

  router.post(
    "/reservar",
    limiteReservas,
    body("servicio").isIn(servicioIds).withMessage("Elige un servicio."),
    body("profesional").optional({ values: "falsy" }).isIn(profesionalIds).withMessage("Elige un profesional."),
    body("inicio").isISO8601({ strict: true }).withMessage("Elige una hora."),
    body("nombre").trim().isLength({ min: 2, max: 120 }).withMessage("Escribe tu nombre."),
    body("telefono")
      .trim()
      .matches(/^\+?[0-9 ()-]{9,20}$/)
      .withMessage("Escribe un teléfono válido.")
      .bail()
      .custom((v) => v.replace(/\D/g, "").length >= 9 && v.replace(/\D/g, "").length <= 15)
      .withMessage("Escribe un teléfono válido."),
    body("email").trim().isEmail().withMessage("Escribe un email válido.").bail().isLength({ max: 254 }),
    body("nota").optional({ values: "falsy" }).trim().isLength({ max: 500 }).withMessage("La nota es demasiado larga (máximo 500 caracteres)."),
    body("privacidad").equals("si").withMessage("Para reservar tienes que aceptar la política de privacidad."),
    async (req, res) => {
      // Honeypot: un campo oculto que una persona nunca rellena.
      if (req.body && req.body.web) return responderError(req, res, 400, "No se pudo enviar la reserva.");

      const errores = validationResult(req);
      if (!errores.isEmpty()) {
        const lista = errores.array();
        return responderError(req, res, 400, lista[0].msg, { campos: [...new Set(lista.map((e) => e.path))] });
      }

      const datos = req.body;
      try {
        const resultado = await reservar({ negocio, datos: { ...datos, profesional: datos.profesional || "cualquiera" } });
        // Después de soltar el candado: si algo de esto falla, la cita sigue siendo válida.
        despuesDeReservar(negocio, resultado).catch((e) => console.error("Error después de reservar:", e.message));
        const url = `/cita/${resultado.token}/confirmada`;
        if (quiereJson(req)) return res.status(201).json({ ok: true, url });
        return res.redirect(303, url);
      } catch (e) {
        if (e instanceof ErrorReserva) {
          if (e.codigo === "ocupado") return responderError(req, res, 409, e.message, { codigo: "ocupado" });
          if (e.codigo === "no_valido") return responderError(req, res, 400, e.message);
          if (e.codigo === "candado") return responderError(req, res, 503, e.message);
          console.error("Configuración incompleta:", e.message);
        } else {
          console.error("Error al reservar:", e.code || e.message);
        }
        return responderError(req, res, 503, "No hemos podido guardar la cita. Inténtalo de nuevo en unos minutos.");
      }
    },
  );

  return router;
};
