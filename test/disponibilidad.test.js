// Tests de services/disponibilidad.js — se ejecutan con `npm test`.
// Usan un negocio propio (no config/negocios/dog-dd.json) para que cambiar
// la demo no rompa los tests.
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { calcularHuecos } = require("../services/disponibilidad");

const negocioBase = () => ({
  slug: "prueba",
  zonaHoraria: "Europe/Madrid",
  pasoMinutos: 15,
  antelacionMinimaHoras: 2,
  diasVisibles: 30,
  servicios: [
    { id: "consulta", nombre: "Consulta", minutos: 30, precio: 40, margenMin: 10 },
    { id: "sin-margen", nombre: "Consulta rápida", minutos: 30, precio: 20, margenMin: 0 },
    { id: "bano", nombre: "Baño", minutos: 60, precio: 30, margenMin: 0 },
  ],
  profesionales: [
    { id: "laura", nombre: "Laura", servicios: ["consulta", "sin-margen"], horario: { lun: ["09:30-14:00", "16:00-20:00"], mar: ["09:30-14:00"] } },
    { id: "marc", nombre: "Marc", servicios: ["bano"], horario: { dom: ["09:30-11:00"] } },
  ],
});

// Domingo 28/02/2027 a las 13:00 en Madrid. El lunes 01/03 queda dentro de los 30 días.
const AHORA = new Date("2027-02-28T12:00:00Z");
const LUNES = "2027-03-01";
const horas = (huecos) => huecos.map((h) => h.hora);

describe("calcularHuecos", () => {
  test("un día sin citas ofrece todo el horario", () => {
    const huecos = calcularHuecos({ negocio: negocioBase(), servicioId: "consulta", profesionalId: "laura", fecha: LUNES, ahora: AHORA });
    // Mañana 09:30 a 13:30 (la última termina a las 14:00) y tarde 16:00 a 19:30.
    assert.equal(huecos.length, 17 + 15);
    assert.equal(huecos[0].hora, "09:30");
    assert.equal(huecos[16].hora, "13:30");
    assert.equal(huecos[17].hora, "16:00");
    assert.equal(huecos.at(-1).hora, "19:30");
    // En marzo, antes del cambio de hora, Madrid es UTC+1.
    assert.equal(huecos[0].inicio, "2027-03-01T08:30:00.000Z");
    assert.ok(huecos.every((h) => h.profesional === "laura"));
  });

  test("una cita en medio quita las horas que se solapan con ella", () => {
    // Cita de 11:00 a 11:30 (bloquea hasta 11:40), en UTC.
    const citas = [{ profesional: "laura", inicio: "2027-03-01T10:00:00Z", finBloqueo: "2027-03-01T10:40:00Z" }];
    const h = horas(calcularHuecos({ negocio: negocioBase(), servicioId: "consulta", profesionalId: "laura", fecha: LUNES, citas, ahora: AHORA }));
    for (const ocupada of ["10:30", "10:45", "11:00", "11:15", "11:30"]) assert.ok(!h.includes(ocupada), `${ocupada} no debería estar libre`);
    assert.ok(h.includes("10:15"));
    assert.ok(h.includes("11:45"));
  });

  test("el margen separa las citas por los dos lados", () => {
    const citas = [{ profesional: "laura", inicio: "2027-03-01T10:00:00Z", finBloqueo: "2027-03-01T10:40:00Z" }];
    const conMargen = horas(calcularHuecos({ negocio: negocioBase(), servicioId: "consulta", profesionalId: "laura", fecha: LUNES, citas, ahora: AHORA }));
    // 10:30 terminaría justo a las 11:00, pero su margen de 10 min pisa la cita.
    assert.ok(!conMargen.includes("10:30"));
    // 11:30: la cita termina a las 11:30, pero su margen llega a las 11:40.
    assert.ok(!conMargen.includes("11:30"));

    // Mismo hueco con un servicio sin margen y una cita sin margen: 10:30 sí cabe.
    const citasSinMargen = [{ profesional: "laura", inicio: "2027-03-01T10:00:00Z", finBloqueo: "2027-03-01T10:30:00Z" }];
    const sinMargen = horas(calcularHuecos({ negocio: negocioBase(), servicioId: "sin-margen", profesionalId: "laura", fecha: LUNES, citas: citasSinMargen, ahora: AHORA }));
    assert.ok(sinMargen.includes("10:30"));
    assert.ok(sinMargen.includes("11:30"));
  });

  test("respeta la antelación mínima", () => {
    // Lunes a las 09:05 en Madrid: con 2 h de antelación, lo primero es 11:15.
    const ahora = new Date("2027-03-01T08:05:00Z");
    const h = horas(calcularHuecos({ negocio: negocioBase(), servicioId: "consulta", profesionalId: "laura", fecha: LUNES, ahora }));
    assert.equal(h[0], "11:15");
    assert.ok(!h.includes("11:00"));
  });

  test("un día sin horario no tiene huecos", () => {
    const miercoles = calcularHuecos({ negocio: negocioBase(), servicioId: "consulta", profesionalId: "laura", fecha: "2027-03-03", ahora: AHORA });
    assert.deepEqual(miercoles, []);
  });

  test("fuera de los días visibles o en el pasado no hay huecos", () => {
    const negocio = negocioBase();
    // Contando hoy (domingo 28/02) como día 1, el lunes 29/03 es el día 30: aún se ve.
    assert.ok(calcularHuecos({ negocio, servicioId: "consulta", profesionalId: "laura", fecha: "2027-03-29", ahora: AHORA }).length > 0);
    // El martes 30/03 sería el día 31: ya no se ve (y Laura trabaja los martes).
    assert.deepEqual(calcularHuecos({ negocio, servicioId: "consulta", profesionalId: "laura", fecha: "2027-03-30", ahora: AHORA }), []);
    assert.deepEqual(calcularHuecos({ negocio, servicioId: "consulta", profesionalId: "laura", fecha: "2027-02-22", ahora: AHORA }), []);
  });

  test("el día del cambio de hora (28/03/2027) usa UTC+2", () => {
    const ahora = new Date("2027-03-20T12:00:00Z");
    const antes = calcularHuecos({ negocio: negocioBase(), servicioId: "bano", profesionalId: "marc", fecha: "2027-03-21", ahora });
    const cambio = calcularHuecos({ negocio: negocioBase(), servicioId: "bano", profesionalId: "marc", fecha: "2027-03-28", ahora });
    // Las mismas horas locales…
    assert.deepEqual(horas(cambio), horas(antes));
    assert.deepEqual(horas(cambio), ["09:30", "09:45", "10:00"]);
    // …pero una hora menos en UTC.
    assert.equal(antes[0].inicio, "2027-03-21T08:30:00.000Z");
    assert.equal(cambio[0].inicio, "2027-03-28T07:30:00.000Z");
  });

  test("el día del cambio de hora no ofrece horas que no existen", () => {
    // A las 02:00 el reloj salta a las 03:00. Tramo 01:00-04:00 = 2 h reales.
    const negocio = negocioBase();
    negocio.pasoMinutos = 30;
    negocio.antelacionMinimaHoras = 0;
    negocio.profesionales[1].horario.dom = ["01:00-04:00"];
    const huecos = calcularHuecos({ negocio, servicioId: "bano", profesionalId: "marc", fecha: "2027-03-28", ahora: new Date("2027-03-20T12:00:00Z") });
    assert.deepEqual(horas(huecos), ["01:00", "01:30", "03:00"]);
    assert.deepEqual(huecos.map((h) => h.inicio), ["2027-03-28T00:00:00.000Z", "2027-03-28T00:30:00.000Z", "2027-03-28T01:00:00.000Z"]);
  });

  test('"Cualquiera" asigna el profesional con menos citas ese día', () => {
    const negocio = negocioBase();
    negocio.profesionales.push({ id: "pau", nombre: "Pau", servicios: ["consulta"], horario: { lun: ["09:30-14:00"] } });
    const citas = [{ profesional: "laura", inicio: "2027-03-01T12:00:00Z", finBloqueo: "2027-03-01T12:40:00Z" }];
    const huecos = calcularHuecos({ negocio, servicioId: "consulta", fecha: LUNES, citas, ahora: AHORA });
    const a = (hora) => huecos.find((h) => h.hora === hora);
    // Por la mañana están los dos libres: va Pau, que no tiene citas.
    assert.equal(a("09:30").profesional, "pau");
    // Por la tarde solo trabaja Laura.
    assert.equal(a("16:00").profesional, "laura");
    // Sin citas, empate: el primero del JSON.
    const sinCitas = calcularHuecos({ negocio, servicioId: "consulta", fecha: LUNES, ahora: AHORA });
    assert.equal(sinCitas.find((h) => h.hora === "09:30").profesional, "laura");
    // No repite horas.
    assert.equal(new Set(horas(huecos)).size, huecos.length);
  });

  test("ignora citas canceladas y aplica los bloqueos del calendario", () => {
    const citas = [{ profesional: "laura", estado: "cancelada", inicio: "2027-03-01T10:00:00Z", finBloqueo: "2027-03-01T10:40:00Z" }];
    // Descanso de 12:00 a 13:00 (Madrid) puesto en Google Calendar.
    const bloqueos = [{ profesional: "laura", inicio: "2027-03-01T11:00:00Z", fin: "2027-03-01T12:00:00Z" }];
    const h = horas(calcularHuecos({ negocio: negocioBase(), servicioId: "consulta", profesionalId: "laura", fecha: LUNES, citas, bloqueos, ahora: AHORA }));
    assert.ok(h.includes("11:00"));
    assert.ok(!h.includes("11:30"));
    assert.ok(!h.includes("12:30"));
    assert.ok(h.includes("13:00"));
  });

  test("rechaza datos incorrectos", () => {
    const negocio = negocioBase();
    assert.throws(() => calcularHuecos({ negocio, servicioId: "peinado", fecha: LUNES, ahora: AHORA }), /no existe/);
    assert.throws(() => calcularHuecos({ negocio, servicioId: "bano", profesionalId: "laura", fecha: LUNES, ahora: AHORA }), /no hace/);
    assert.throws(() => calcularHuecos({ negocio, servicioId: "consulta", fecha: "2027-02-30", ahora: AHORA }), /Fecha no válida/);
  });
});
