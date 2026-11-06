// Textos de fechas y precios en español de España, en la zona del negocio.
const { DateTime } = require("luxon");

const capitalizar = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const enZona = (d, zona) => DateTime.fromJSDate(new Date(d), { zone: zona }).setLocale("es");

// "Lun 9 nov" para los botones de día.
const etiquetaDia = (fecha, zona) => capitalizar(DateTime.fromISO(fecha, { zone: zona }).setLocale("es").toFormat("ccc d LLL").replace(".", ""));
// "lunes 9 de noviembre"
const fechaLarga = (d, zona) => enZona(d, zona).toFormat("cccc d 'de' LLLL");
// "11:45"
const hora = (d, zona) => enZona(d, zona).toFormat("HH:mm");
// "40 €"
const precio = (n) => `${Number(n).toLocaleString("es-ES")} €`;

module.exports = { etiquetaDia, fechaLarga, hora, precio, capitalizar };
