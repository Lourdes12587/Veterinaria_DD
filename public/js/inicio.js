// Dog DD — inicio
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Aparición única cuando un bloque entra en pantalla. Nunca deja contenido oculto.
// Se comprueba en cada scroll, así un salto rápido (un ancla, la tecla Fin) no deja nada oculto.
(() => {
  let pending = [...document.querySelectorAll("[data-reveal], .step")];
  let ticking = false;
  const check = () => {
    ticking = false;
    const limit = innerHeight * 0.92;
    pending = pending.filter((el) => {
      if (el.getBoundingClientRect().top < limit) {
        el.classList.add("is-in");
        return false;
      }
      return true;
    });
    if (!pending.length) window.removeEventListener("scroll", onScroll);
  };
  const onScroll = () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(check);
    }
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  check();
})();

// La tarjeta del hero se achica hacia la esquina inferior izquierda al bajar.
(() => {
  const hero = document.querySelector(".hero");
  const card = document.querySelector("[data-hero-card]");
  if (!hero || !card || reduced) return;
  let ticking = false;
  const update = () => {
    ticking = false;
    const run = hero.offsetHeight - innerHeight;
    const p = Math.min(Math.max(window.scrollY / run, 0), 1);
    const s = 1 - p * 0.55;
    const left = card.offsetLeft;
    const top = card.offsetTop;
    const dx = -left + 16;
    const dy = innerHeight - (top + card.offsetHeight) - 16;
    card.style.transform = `translate(${dx * p}px, ${dy * p}px) scale(${s})`;
  };
  window.addEventListener("scroll", () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  }, { passive: true });
  window.addEventListener("resize", update);
  update();
})();

// Servicios: la fila activa abre su texto y cambia la foto fija.
(() => {
  const rows = [...document.querySelectorAll("[data-row]")];
  const frames = [...document.querySelectorAll("[data-frame]")];
  if (!rows.length) return;
  let current = rows.find((r) => r.classList.contains("is-active"));
  const activate = (row) => {
    if (row === current) return;
    current = row;
    rows.forEach((r) => {
      const on = r === row;
      r.classList.toggle("is-active", on);
      r.querySelector(".row__head").setAttribute("aria-expanded", String(on));
    });
    frames.forEach((f) => f.classList.toggle("is-on", f.dataset.frame === row.dataset.row));
  };
  const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  rows.forEach((row) => {
    const head = row.querySelector(".row__head");
    head.addEventListener("click", () => activate(row));
    head.addEventListener("focus", () => activate(row));
    if (fine) head.addEventListener("mouseenter", () => activate(row));
  });
})();

// Agenda: sin recargar la página, pide días y horas libres a /api y envía la reserva.
// Si este código falla, los formularios siguen funcionando como GET y POST normales.
(() => {
  const root = document.querySelector("[data-agenda]");
  const datosEl = document.getElementById("agenda-datos");
  if (!root || !datosEl || !window.fetch) return;
  const datos = JSON.parse(datosEl.textContent);
  const seleccion = root.querySelector("[data-seleccion]");
  const reserva = root.querySelector("[data-reserva]");
  const cajaPros = root.querySelector("[data-profesionales]");
  const cajaDias = root.querySelector("[data-dias]");
  const cajaHoras = root.querySelector("[data-horas]");
  const sinDias = root.querySelector("[data-sin-dias]");
  const sinHoras = root.querySelector("[data-sin-horas]");
  const aviso = root.querySelector("[data-aviso]");
  const resumen = root.querySelector("[data-resumen]");
  const confirmar = root.querySelector("[data-confirmar]");

  const valor = (form, name) => (form.querySelector(`input[name="${name}"]:checked`) || {}).value || "";
  const estado = () => ({ servicio: valor(seleccion, "servicio"), profesional: valor(seleccion, "profesional") || "cualquiera", fecha: valor(seleccion, "fecha"), inicio: valor(reserva, "inicio") });

  const mostrarAviso = (texto) => {
    aviso.textContent = texto || "";
    aviso.hidden = !texto;
  };

  async function api(ruta, params) {
    const r = await fetch(`/api/${encodeURIComponent(datos.slug)}/${ruta}?${new URLSearchParams(params)}`, { headers: { Accept: "application/json", ...(datos.token ? { "X-Cita-Token": datos.token } : {}) } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "No se pudo cargar la agenda. Inténtalo de nuevo.");
    return j;
  }

  // Botones con el mismo marcado que pinta el servidor.
  function opcion(name, value, texto, { checked = false, disabled = false, required = false } = {}) {
    const label = document.createElement("label");
    label.className = "choice";
    const input = document.createElement("input");
    Object.assign(input, { type: "radio", name, value, checked, disabled, required });
    const span = document.createElement("span");
    span.textContent = texto;
    label.append(input, span);
    return label;
  }

  const fechaLarga = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", timeZone: datos.zona });
  const horaCorta = new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: datos.zona });
  const euros = (n) => `${n.toLocaleString("es-ES")} €`;

  function pintarResumen() {
    const e = estado();
    const s = datos.servicios.find((x) => x.id === e.servicio);
    if (!s) return;
    const base = `${s.minutos} min · ${euros(s.precio)}`;
    if (!e.inicio) {
      resumen.textContent = `${s.nombre} · ${base}. Elige día y hora.`;
      return;
    }
    const d = new Date(e.inicio);
    const p = datos.profesionales.find((x) => x.id === e.profesional);
    resumen.textContent = `${s.nombre}${p ? ` con ${p.nombre}` : ""}, el ${fechaLarga.format(d).replace(",", "")} a las ${horaCorta.format(d)}. ${base}.`;
  }

  function sincronizarOcultos() {
    const e = estado();
    reserva.querySelector('input[name="servicio"]').value = e.servicio;
    reserva.querySelector('input[name="profesional"]').value = e.profesional;
  }

  function pintarProfesionales() {
    const e = estado();
    const pros = datos.profesionales.filter((p) => p.servicios.includes(e.servicio));
    const actual = pros.some((p) => p.id === e.profesional) ? e.profesional : "cualquiera";
    cajaPros.replaceChildren(
      opcion("profesional", "cualquiera", "Cualquiera", { checked: actual === "cualquiera" }),
      ...pros.map((p) => opcion("profesional", p.id, p.nombre, { checked: actual === p.id })),
    );
  }

  let peticion = 0; // descarta respuestas viejas si el cliente cambia rápido de opción

  async function cargarHoras() {
    const id = ++peticion;
    const e = estado();
    cajaHoras.setAttribute("aria-busy", "true");
    try {
      const huecos = e.fecha ? (await api("huecos", { servicio: e.servicio, profesional: e.profesional, fecha: e.fecha })).huecos : [];
      if (id !== peticion) return;
      cajaHoras.replaceChildren(...huecos.map((h) => opcion("inicio", h.inicio, h.hora, { checked: h.inicio === e.inicio, required: true })));
      sinHoras.hidden = !(e.fecha && huecos.length === 0);
    } finally {
      if (id === peticion) cajaHoras.removeAttribute("aria-busy");
    }
    pintarResumen();
  }

  async function cargarDias() {
    const id = ++peticion;
    const e = estado();
    cajaDias.setAttribute("aria-busy", "true");
    try {
      const { dias } = await api("dias", { servicio: e.servicio, profesional: e.profesional });
      if (id !== peticion) return;
      const libres = dias.filter((d) => d.disponible).map((d) => d.fecha);
      const fecha = libres.includes(e.fecha) ? e.fecha : libres[0] || "";
      cajaDias.replaceChildren(...dias.map((d) => opcion("fecha", d.fecha, d.etiqueta, { checked: d.fecha === fecha, disabled: !d.disponible })));
      sinDias.hidden = libres.length > 0;
    } finally {
      if (id === peticion) cajaDias.removeAttribute("aria-busy");
    }
    await cargarHoras();
  }

  const conAviso = (fn) => fn().then(() => mostrarAviso(""), (err) => mostrarAviso(err.message));

  seleccion.addEventListener("change", (ev) => {
    const name = ev.target.name;
    if (name === "servicio") pintarProfesionales();
    sincronizarOcultos();
    pintarResumen();
    conAviso(name === "fecha" ? cargarHoras : cargarDias);
  });
  seleccion.addEventListener("submit", (ev) => ev.preventDefault());
  reserva.addEventListener("change", (ev) => {
    if (ev.target.name === "inicio") pintarResumen();
  });

  reserva.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!reserva.reportValidity()) return;
    confirmar.disabled = true;
    mostrarAviso("");
    try {
      const r = await fetch(reserva.action.split("#")[0], {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(new FormData(reserva)),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.url) {
        window.location.assign(j.url);
        return;
      }
      mostrarAviso(j.error || "No hemos podido guardar la cita. Inténtalo de nuevo.");
      // La hora se ocupó mientras rellenaba: se recargan días y horas, sus datos no se tocan.
      if (j.codigo === "ocupado") await cargarDias().catch(() => {});
      aviso.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
    } catch {
      mostrarAviso("No hay conexión. Revisa tu internet e inténtalo de nuevo.");
    } finally {
      confirmar.disabled = false;
    }
  });

  sincronizarOcultos();
  pintarResumen();
})();
