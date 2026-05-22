const express = require("express");
const router = express.Router();
const { body, validationResult } = require("express-validator");
const db = require("../../config/db");


router.get("/", (req, res) => {
  res.render("contacto", { errors: [], old: {} });
});

router.post(
  "/",
  [
    body("nombre").notEmpty().withMessage("El nombre es obligatorio"),
    body("email").isEmail().withMessage("Email inválido"),
    body("mensaje").notEmpty().withMessage("El mensaje no puede estar vacío"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.render("contacto", { errors: errors.array(), old: req.body });
    }

    const { nombre, email, mensaje } = req.body;
    try {
      await db.query("INSERT INTO contactos (nombre, email, mensaje) VALUES (?, ?, ?)", [nombre, email, mensaje]);
      res.render("contacto", { success: "Mensaje enviado correctamente", errors: [], old: {} });
    } catch (err) {
      console.error(err);
      res.render("contacto", { errors: [{ msg: "Error al enviar mensaje" }], old: req.body });
    }
  }
);

module.exports = router;
