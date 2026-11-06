// Portada con la agenda, POST /reservar y página de cita confirmada.
//
// Funciona sin JavaScript: la portada se pinta en el servidor con la selección
// que llega en la URL (?servicio=&profesional=&fecha=) y el formulario de datos
// hace un POST normal. Con JavaScript, public/js/inicio.js hace lo mismo sin
// recargar la página.
const express = require("express");
const { DateTime } = require("luxon");
const { rateLimit } = require("express-rate-limit");
const { body, validationResult } = require("express-validator");
const { calcularHuecos, calcularDias, fechasVisibles } = require("../../services/disponibilidad");
const { candidatos, citasEntre } = require("../../services/citas");
const { reservar, despuesDeReservar, buscarPorToken, ErrorReserva } = require("../../services/reservas");
const { crearIcs } = require("../../services/ics");
const fmt = require("../../services/formato");

const quiereJson = (req) => (req.get("Accept") || "").includes("application/json");

module.exports = function crearRouterReservar(negocio) {
  const router = express.Router();
  const zona = negocio.zonaHoraria;
  const servicioDe = (id) => negocio.servicios.find((s) => s.id === id);
  const profesionalDe = (id) => negocio.profesionales.find((p) => p.id === id);

  // Datos de la sección de reserva para la vista. Nunca incluye calendarId.
  async function modeloReserva({ seleccion = {}, valores = {}, error = null }) {
    const servicio = servicioDe(seleccion.servicio) || negocio.servicios[0];
    const pros = candidatos(negocio, servicio.id);
    const profesional = pros.some((p) => p.id === seleccion.profesional) ? seleccion.profesional : "cualquiera";
    const modelo = {
      servicios: negocio.servicios.map(({ id, nombre, minutos, precio }) => ({ id, nombre, minutos, precio: fmt.precio(precio) })),
      profesionales: pros.map(({ id, nombre }) => ({ id, nombre })),
      seleccion: { servicio: servicio.id, profesional, fecha: null, inicio: null },
      dias: [],
      huecos: [],
      valores,
      error,
      caida: false,
      resumen: `${servicio.nombre} · ${servicio.minutos} min · ${fmt.precio(servicio.precio)}. Elige día y hora.`,
    };

    const ahora = new Date();
    const fechas = fechasVisibles(negocio, ahora);
    const desde = DateTime.fromISO(fechas[0], { zone: zona });
    const hasta = DateTime.fromISO(fechas.at(-1), { zone: zona }).plus({ days: 1 });
    let citas;
    try {
      citas = await citasEntre({ negocio, profesionales: candidatos(negocio, servicio.id, profesional).map((p) => p.id), desde: desde.toJSDate(), hasta: hasta.toJSDate() });
    } catch (e) {
      console.error("Error al leer citas:", e.code || e.message);
      modelo.caida = true;
      modelo.error = error || "La agenda no está disponible ahora mismo. Inténtalo más tarde.";
      return modelo;
    }

    const base = { negocio, servicioId: servicio.id, profesionalId: profesional, citas, bloqueos: [], ahora };
    modelo.dias = calcularDias(base).map((d) => ({ ...d, etiqueta: fmt.etiquetaDia(d.fecha, zona) }));
    const libres = modelo.dias.filter((d) => d.disponible).map((d) => d.fecha);
    const fecha = libres.includes(seleccion.fecha) ? seleccion.fecha : libres[0] || null;
    modelo.seleccion.fecha = fecha;
    if (fecha) {
      modelo.huecos = calcularHuecos({ ...base, fecha }).map(({ hora, inicio }) => ({ hora, inicio }));
      if (modelo.huecos.some((h) => h.inicio === seleccion.inicio)) {
        modelo.seleccion.inicio = seleccion.inicio;
        const quien = profesional === "cualquiera" ? "" : ` con ${profesionalDe(profesional).nombre}`;
        modelo.resumen = `${servicio.nombre}${quien}, el ${fmt.fechaLarga(seleccion.inicio, zona)} a las ${fmt.hora(seleccion.inicio, zona)}. ${servicio.minutos} min · ${fmt.precio(servicio.precio)}.`;
      }
    }
    return modelo;
  }

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
        despuesDeReservar(resultado).catch((e) => console.error("Error después de reservar:", e.message));
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

  // --- Cita confirmada y .ics ---
  // El token va en la URL: que no salga hacia otras webs ni se guarde en cachés.
  router.use("/cita/:token", (req, res, next) => {
    res.set({ "Referrer-Policy": "no-referrer", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" });
    next();
  });

  async function citaVigente(req, res) {
    let cita = null;
    try {
      cita = await buscarPorToken(negocio, req.params.token);
    } catch (e) {
      console.error("Error al buscar la cita:", e.code || e.message);
      res.status(503).render("enlace-no-valido", { mensaje: "No podemos mostrar la cita ahora mismo. Inténtalo más tarde." });
      return null;
    }
    if (!cita || cita.estado !== "confirmada" || cita.fin <= new Date()) {
      res.status(404).render("enlace-no-valido", { mensaje: "Este enlace ya no es válido." });
      return null;
    }
    return cita;
  }

  router.get("/cita/:token/confirmada", async (req, res) => {
    const cita = await citaVigente(req, res);
    if (!cita) return;
    const servicio = servicioDe(cita.servicio);
    res.render("cita-confirmada", {
      token: req.params.token,
      cita: {
        servicio: servicio ? servicio.nombre : cita.servicio,
        minutos: servicio ? servicio.minutos : null,
        precio: servicio ? fmt.precio(servicio.precio) : "",
        profesional: (profesionalDe(cita.profesional) || { nombre: cita.profesional }).nombre,
        fecha: fmt.fechaLarga(cita.inicio, zona),
        hora: fmt.hora(cita.inicio, zona),
        cliente: cita.cliente_nombre,
      },
    });
  });

  router.get("/cita/:token/cita.ics", async (req, res) => {
    const cita = await citaVigente(req, res);
    if (!cita) return;
    const servicio = servicioDe(cita.servicio);
    const pro = profesionalDe(cita.profesional);
    const ics = crearIcs({
      uid: `cita-${cita.id}@${negocio.slug}`,
      inicio: cita.inicio,
      fin: cita.fin,
      titulo: `${servicio ? servicio.nombre : "Cita"} · ${negocio.nombre}`,
      descripcion: `Con ${pro ? pro.nombre : cita.profesional}. Teléfono de ${negocio.nombre}: ${negocio.telefono}`,
      organizador: negocio.nombre,
    });
    res.set({ "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="cita-${negocio.slug}.ics"` });
    res.send(ics);
  });

  return router;
};
