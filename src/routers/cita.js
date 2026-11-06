// Enlace del cliente: /cita/:token
//
// GET nunca cambia nada (un antivirus de correo que abra el enlace no cancela
// la cita): solo muestra la cita y los botones. Cancelar y cambiar son POST.
const express = require("express");
const { DateTime } = require("luxon");
const { body, validationResult } = require("express-validator");
const { reservar, cancelar, buscarPorToken, despuesDeCambiar, despuesDeCancelar, ErrorReserva } = require("../../services/reservas");
const { crearModeloReserva } = require("../../services/vista-agenda");
const { icsDeCita } = require("../../services/ics");
const fmt = require("../../services/formato");

const quiereJson = (req) => (req.get("Accept") || "").includes("application/json");

module.exports = function crearRouterCita(negocio) {
  const router = express.Router();
  const zona = negocio.zonaHoraria;
  const modeloReserva = crearModeloReserva(negocio);
  const servicioDe = (id) => negocio.servicios.find((s) => s.id === id);
  const profesionalDe = (id) => negocio.profesionales.find((p) => p.id === id);
  const profesionalIds = ["cualquiera", ...negocio.profesionales.map((p) => p.id)];

  // El token va en la URL: que no salga hacia otras webs ni se guarde en cachés.
  router.use("/cita/:token", (req, res, next) => {
    res.set({ "Referrer-Policy": "no-referrer", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" });
    next();
  });

  const noValido = (res) => res.status(404).render("enlace-no-valido", { mensaje: "Este enlace ya no es válido." });

  // Busca la cita del token. Si no existe o ya pasó, responde "no válido" y devuelve null.
  async function cargar(req, res) {
    let cita;
    try {
      cita = await buscarPorToken(negocio, req.params.token);
    } catch (e) {
      console.error("Error al buscar la cita:", e.code || e.message);
      res.status(503).render("enlace-no-valido", { mensaje: "No podemos mostrar la cita ahora mismo. Inténtalo más tarde." });
      return null;
    }
    if (!cita || cita.inicio <= new Date()) {
      noValido(res);
      return null;
    }
    return cita;
  }

  // ¿Queda tiempo para cambiar o cancelar por la web?
  const aTiempo = (cita) => cita.inicio.getTime() - Date.now() >= negocio.cancelacionMinimaHoras * 3600 * 1000;

  function detalle(cita) {
    const s = servicioDe(cita.servicio);
    return {
      servicio: s ? s.nombre : cita.servicio,
      minutos: s ? s.minutos : null,
      precio: s ? fmt.precio(s.precio) : "",
      profesional: (profesionalDe(cita.profesional) || { nombre: cita.profesional }).nombre,
      fecha: fmt.fechaLarga(cita.inicio, zona),
      hora: fmt.hora(cita.inicio, zona),
      cliente: cita.cliente_nombre,
    };
  }

  async function pintarCita(res, cita, { estado = 200, mensaje = null, cambiar = false, seleccion = {}, aviso = null } = {}) {
    let vista;
    if (cita.estado === "cancelada") vista = "cancelada";
    else if (!aTiempo(cita)) vista = "cerca";
    else if (cambiar) vista = "cambiar";
    else vista = "activa";
    const reserva =
      vista === "cambiar"
        ? await modeloReserva({
            seleccion: { profesional: cita.profesional, fecha: DateTime.fromJSDate(cita.inicio, { zone: zona }).toISODate(), ...seleccion },
            servicioFijo: cita.servicio,
            excluirId: cita.id,
            error: aviso,
          })
        : null;
    res.status(estado).render("cita", { token: res.req.params.token, vista, cita: detalle(cita), mensaje, reserva });
  }

  // --- Ver la cita (no cambia nada) ---
  router.get("/cita/:token", async (req, res) => {
    const cita = await cargar(req, res);
    if (!cita) return;
    const leer = (k) => (typeof req.query[k] === "string" ? req.query[k] : undefined);
    const mensaje = req.query.cancelada ? "Tu cita se ha cancelado." : null;
    await pintarCita(res, cita, {
      mensaje,
      cambiar: req.query.cambiar === "1",
      seleccion: Object.fromEntries(Object.entries({ profesional: leer("profesional"), fecha: leer("fecha") }).filter(([, v]) => v)),
    });
  });

  // --- Cancelar ---
  router.post("/cita/:token/cancelar", async (req, res) => {
    const cita = await cargar(req, res);
    if (!cita) return;
    if (cita.estado !== "confirmada") return res.redirect(303, `/cita/${req.params.token}`);
    if (!aTiempo(cita)) return pintarCita(res, cita, { estado: 403 });
    try {
      if (await cancelar({ negocio, citaId: cita.id })) {
        despuesDeCancelar(negocio, { cita }).catch((e) => console.error("Error después de cancelar:", e.message));
      }
    } catch (e) {
      console.error("Error al cancelar:", e.code || e.message);
      return pintarCita(res, cita, { estado: 503, mensaje: "No hemos podido cancelar la cita. Inténtalo de nuevo o llámanos." });
    }
    res.redirect(303, `/cita/${req.params.token}?cancelada=1`);
  });

  // --- Cambiar ---
  router.post(
    "/cita/:token/cambiar",
    body("inicio").isISO8601({ strict: true }).withMessage("Elige una hora."),
    body("profesional").optional({ values: "falsy" }).isIn(profesionalIds).withMessage("Elige un profesional."),
    async (req, res) => {
      const cita = await cargar(req, res);
      if (!cita) return;
      const responder = async (estado, mensaje, extra = {}) => {
        if (quiereJson(req)) return res.status(estado).json({ error: mensaje, ...extra });
        await pintarCita(res, cita, {
          estado,
          cambiar: true,
          aviso: mensaje,
          seleccion: { profesional: req.body.profesional, fecha: req.body.inicio && DateTime.fromISO(req.body.inicio, { zone: zona }).toISODate(), inicio: req.body.inicio },
        });
      };

      if (cita.estado !== "confirmada") return quiereJson(req) ? res.status(409).json({ error: "Esta cita ya no está activa." }) : res.redirect(303, `/cita/${req.params.token}`);
      if (!aTiempo(cita)) return quiereJson(req) ? res.status(403).json({ error: `Faltan menos de ${negocio.cancelacionMinimaHoras} horas: llámanos al ${negocio.telefono}.` }) : pintarCita(res, cita, { estado: 403 });

      const errores = validationResult(req);
      if (!errores.isEmpty()) return responder(400, errores.array()[0].msg);

      const profesional = req.body.profesional || "cualquiera";
      const nuevoInicio = new Date(req.body.inicio);
      if (nuevoInicio.getTime() === cita.inicio.getTime() && (profesional === "cualquiera" || profesional === cita.profesional)) {
        return responder(400, "Esa ya es la hora de tu cita. Elige otra.");
      }

      try {
        const resultado = await reservar({
          negocio,
          datos: {
            servicio: cita.servicio,
            profesional,
            inicio: req.body.inicio,
            nombre: cita.cliente_nombre,
            telefono: cita.cliente_telefono,
            email: cita.cliente_email,
            nota: cita.nota,
          },
          reemplazaCitaId: cita.id,
          privacidadAceptadaAt: cita.privacidad_aceptada_at,
        });
        despuesDeCambiar(negocio, { anterior: cita, ...resultado }).catch((e) => console.error("Error después de cambiar:", e.message));
        const url = `/cita/${resultado.token}/confirmada`;
        if (quiereJson(req)) return res.status(201).json({ ok: true, url });
        return res.redirect(303, url);
      } catch (e) {
        if (e instanceof ErrorReserva) {
          if (e.codigo === "ocupado") return responder(409, "Esa hora se acaba de ocupar. Elige otra: tu cita actual sigue igual.", { codigo: "ocupado" });
          if (e.codigo === "ya_cambiada") return quiereJson(req) ? res.status(409).json({ error: e.message }) : res.redirect(303, `/cita/${req.params.token}`);
          if (e.codigo === "no_valido") return responder(400, e.message);
          if (e.codigo === "candado") return responder(503, e.message);
          console.error("Configuración incompleta:", e.message);
        } else {
          console.error("Error al cambiar la cita:", e.code || e.message);
        }
        return responder(503, "No hemos podido cambiar la cita. Inténtalo de nuevo en unos minutos.");
      }
    },
  );

  // --- Cita confirmada y .ics (solo citas confirmadas) ---
  async function confirmadaOFuera(req, res) {
    const cita = await cargar(req, res);
    if (!cita) return null;
    if (cita.estado !== "confirmada") {
      noValido(res);
      return null;
    }
    return cita;
  }

  router.get("/cita/:token/confirmada", async (req, res) => {
    const cita = await confirmadaOFuera(req, res);
    if (!cita) return;
    res.render("cita-confirmada", { token: req.params.token, cita: detalle(cita) });
  });

  router.get("/cita/:token/cita.ics", async (req, res) => {
    const cita = await confirmadaOFuera(req, res);
    if (!cita) return;
    const ics = icsDeCita(negocio, cita);
    res.set({ "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="cita-${negocio.slug}.ics"` });
    res.send(ics);
  });

  return router;
};
