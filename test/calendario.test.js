// Tests de services/calendario.js sin conectarse a Google: las funciones puras
// y un cliente falso con la misma forma que google.calendar().
const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const cal = require("../services/calendario");

const negocio = {
  slug: "prueba",
  zonaHoraria: "Europe/Madrid",
  servicios: [{ id: "consulta", nombre: "Consulta", minutos: 30, precio: 40, margenMin: 10 }],
  profesionales: [
    { id: "laura", nombre: "Laura", calendarId: "laura@group.calendar.google.com", servicios: ["consulta"], horario: {} },
    { id: "pau", nombre: "Pau", calendarId: "pau@group.calendar.google.com", servicios: ["consulta"], horario: {} },
    { id: "sin", nombre: "Sin calendario", calendarId: "", servicios: ["consulta"], horario: {} },
  ],
};
const d = (s) => new Date(s);

describe("bloqueosDeFreebusy", () => {
  test("convierte los huecos ocupados de cada calendario", () => {
    const datos = { calendars: { "laura@group.calendar.google.com": { busy: [{ start: "2027-03-01T10:00:00Z", end: "2027-03-01T11:00:00Z" }] } } };
    assert.deepEqual(cal.bloqueosDeFreebusy(datos, [["laura", "laura@group.calendar.google.com"]]), [
      { profesional: "laura", inicio: d("2027-03-01T10:00:00Z"), fin: d("2027-03-01T11:00:00Z") },
    ]);
  });
  test("un calendario que Google no puede leer es un error, no un día libre", () => {
    const datos = { calendars: { "laura@group.calendar.google.com": { errors: [{ domain: "global", reason: "notFound" }], busy: [] } } };
    assert.throws(() => cal.bloqueosDeFreebusy(datos, [["laura", "laura@group.calendar.google.com"]]), /notFound/);
  });
});

describe("quitarIntervalo (ignorar el evento propio al cambiar)", () => {
  const b = (p, i, f) => ({ profesional: p, inicio: d(i), fin: d(f) });
  test("quita el bloque que coincide con la cita", () => {
    const r = cal.quitarIntervalo([b("laura", "2027-03-01T10:00:00Z", "2027-03-01T10:30:00Z")], { profesional: "laura", inicio: "2027-03-01T10:00:00Z", fin: "2027-03-01T10:30:00Z" });
    assert.deepEqual(r, []);
  });
  test("si el bloque es más grande, deja lo que sobra a cada lado", () => {
    const r = cal.quitarIntervalo([b("laura", "2027-03-01T09:00:00Z", "2027-03-01T12:00:00Z")], { profesional: "laura", inicio: "2027-03-01T10:00:00Z", fin: "2027-03-01T10:30:00Z" });
    assert.deepEqual(r, [b("laura", "2027-03-01T09:00:00Z", "2027-03-01T10:00:00Z"), b("laura", "2027-03-01T10:30:00Z", "2027-03-01T12:00:00Z")]);
  });
  test("no toca bloques de otro profesional ni bloques que no se solapan", () => {
    const otros = [b("pau", "2027-03-01T10:00:00Z", "2027-03-01T10:30:00Z"), b("laura", "2027-03-01T11:00:00Z", "2027-03-01T12:00:00Z")];
    assert.deepEqual(cal.quitarIntervalo(otros, { profesional: "laura", inicio: "2027-03-01T10:00:00Z", fin: "2027-03-01T10:30:00Z" }), otros);
  });
});

describe("con un cliente falso de Google", () => {
  let llamadas;
  let busy;
  const falso = () => ({
    freebusy: { query: async (p) => (llamadas.push(["freebusy", p.requestBody]), { data: { calendars: Object.fromEntries(p.requestBody.items.map(({ id }) => [id, { busy: busy[id] || [] }])) } }) },
    events: {
      insert: async (p) => (llamadas.push(["insert", p.calendarId, p.requestBody]), { data: { id: "ev1" } }),
      patch: async (p) => (llamadas.push(["patch", p.calendarId, p.eventId, p.requestBody]), { data: { id: p.eventId } }),
      move: async (p) => (llamadas.push(["move", p.calendarId, p.eventId, p.destination]), { data: { id: p.eventId } }),
      delete: async (p) => {
        llamadas.push(["delete", p.calendarId, p.eventId]);
        if (p.eventId === "ya-borrado") throw Object.assign(new Error("Gone"), { code: 410 });
        return { data: "" };
      },
    },
  });
  beforeEach(() => {
    llamadas = [];
    busy = {};
    cal.usarClienteDePrueba(falso());
  });

  const cita = { id: 7, profesional: "laura", servicio: "consulta", inicio: d("2027-03-01T10:00:00Z"), fin: d("2027-03-01T10:30:00Z"), cliente_nombre: "Ana", cliente_telefono: "600", cliente_email: "ana@example.com", nota: "Mora", google_event_id: null };

  test("obtenerBloqueos consulta solo profesionales con calendario y usa caché salvo dentro del candado", async () => {
    busy["laura@group.calendar.google.com"] = [{ start: "2027-03-01T12:00:00Z", end: "2027-03-01T13:00:00Z" }];
    const o = { profesionales: ["laura", "sin"], desde: d("2027-03-01T00:00:00Z"), hasta: d("2027-03-02T00:00:00Z") };
    const r = await cal.obtenerBloqueos(negocio, o);
    assert.equal(r.length, 1);
    assert.deepEqual(llamadas[0][1].items, [{ id: "laura@group.calendar.google.com" }]);
    await cal.obtenerBloqueos(negocio, o);
    assert.equal(llamadas.length, 1, "la segunda vez sale de la caché");
    await cal.obtenerBloqueos(negocio, { ...o, fresco: true });
    assert.equal(llamadas.length, 2, "dentro del candado siempre pregunta a Google");
  });

  test("crearEvento pone los datos del cliente en la descripción y no invita a nadie", async () => {
    assert.equal(await cal.crearEvento(negocio, cita), "ev1");
    const [, calendarId, cuerpo] = llamadas[0];
    assert.equal(calendarId, "laura@group.calendar.google.com");
    assert.match(cuerpo.description, /Ana/);
    assert.match(cuerpo.description, /ana@example\.com/);
    assert.equal(cuerpo.attendees, undefined);
    assert.equal(cuerpo.start.dateTime, "2027-03-01T10:00:00.000Z");
  });

  test("un profesional sin calendarId no crea evento", async () => {
    assert.equal(await cal.crearEvento(negocio, { ...cita, profesional: "sin" }), null);
    assert.equal(llamadas.length, 0);
  });

  test("moverEvento: mismo profesional → solo cambia la hora; otro profesional → move + patch", async () => {
    const anterior = { ...cita, google_event_id: "ev1" };
    await cal.moverEvento(negocio, anterior, { ...cita, id: 8, inicio: d("2027-03-01T11:00:00Z"), fin: d("2027-03-01T11:30:00Z") });
    assert.deepEqual(llamadas.map((l) => l[0]), ["patch"]);
    llamadas = [];
    await cal.moverEvento(negocio, anterior, { ...cita, id: 8, profesional: "pau" });
    assert.deepEqual(llamadas.map((l) => l[0]), ["move", "patch"]);
    assert.equal(llamadas[0][3], "pau@group.calendar.google.com");
  });

  test("borrarEvento ignora un evento que ya no existe", async () => {
    assert.equal(await cal.borrarEvento(negocio, { ...cita, google_event_id: "ya-borrado" }), true);
    assert.equal(await cal.borrarEvento(negocio, { ...cita, google_event_id: null }), false);
  });
});
