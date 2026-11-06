// Datos que necesita la vista del selector de cita (servicio, profesional,
// días y horas). Lo usan la portada y la página de cambiar cita.
// Nunca incluye calendarId ni emailNegocio.
const { DateTime } = require("luxon");
const { calcularHuecos, calcularDias, fechasVisibles } = require("./disponibilidad");
const { candidatos, citasEntre } = require("./citas");
const fmt = require("./formato");

function crearModeloReserva(negocio) {
  const zona = negocio.zonaHoraria;
  const servicioDe = (id) => negocio.servicios.find((s) => s.id === id);
  const profesionalDe = (id) => negocio.profesionales.find((p) => p.id === id);

  /**
   * @param {object} [o.seleccion]  { servicio, profesional, fecha, inicio } que llegan del cliente (sin validar).
   * @param {object} [o.valores]    Datos ya escritos por el cliente, para no borrarlos.
   * @param {string} [o.error]
   * @param {string} [o.servicioFijo]  Solo se ofrece este servicio (al cambiar una cita).
   * @param {number} [o.excluirId]     Cita que no cuenta como ocupada (la que se está cambiando).
   */
  return async function modeloReserva({ seleccion = {}, valores = {}, error = null, servicioFijo = null, excluirId = null } = {}) {
    const servicio = servicioDe(servicioFijo) || servicioDe(seleccion.servicio) || negocio.servicios[0];
    const pros = candidatos(negocio, servicio.id);
    const profesional = pros.some((p) => p.id === seleccion.profesional) ? seleccion.profesional : "cualquiera";
    const ofrecidos = servicioFijo ? [servicio] : negocio.servicios;
    const modelo = {
      servicios: ofrecidos.map(({ id, nombre, minutos, precio }) => ({ id, nombre, minutos, precio: fmt.precio(precio) })),
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
      citas = await citasEntre({
        negocio,
        profesionales: candidatos(negocio, servicio.id, profesional).map((p) => p.id),
        desde: desde.toJSDate(),
        hasta: hasta.toJSDate(),
        excluirId,
      });
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
  };
}

module.exports = { crearModeloReserva };
