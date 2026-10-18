// DogDreams — inicio
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Aparición única cuando un bloque entra en pantalla. Nunca deja contenido oculto.
// Se comprueba en cada scroll, así un salto rápido (un ancla, la tecla Fin) no deja nada oculto.
(() => {
  let pending = [...document.querySelectorAll("[data-reveal], .gallery__panel, .step")];
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

// Reserva en vivo: arma el mensaje de WhatsApp con lo que elige el visitante.
(() => {
  const form = document.querySelector("[data-compose]");
  const out = document.querySelector("[data-message]");
  const send = document.querySelector("[data-send]");
  if (!form || !out || !send) return;
  const phone = "5492616857811";
  const fecha = (v) => {
    if (!v) return "";
    const [, m, d] = v.split("-");
    return `${d}/${m}`;
  };
  const build = () => {
    const data = new FormData(form);
    const servicio = data.get("servicio") || "hotel";
    const tamano = data.get("tamano") || "mediano";
    const nombre = (data.get("nombre") || "").trim();
    const desde = fecha(data.get("desde"));
    const hasta = fecha(data.get("hasta"));
    const quien = nombre ? nombre : "mi perro";
    let cuando = "";
    if (desde && hasta) cuando = `, del ${desde} al ${hasta}`;
    else if (desde) cuando = `, para el ${desde}`;
    const text = `Hola DogDreams, quiero reservar ${servicio} para ${quien}, de tamaño ${tamano}${cuando}. ¿Tienen lugar?`;
    out.textContent = text;
    send.href = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
  };
  form.addEventListener("input", build);
  form.addEventListener("change", build);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    build();
    window.open(send.href, "_blank", "noopener");
  });
  build();
})();
