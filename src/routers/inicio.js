const express = require("express");
const router = express.Router();

router.get("/contacto", (req, res) => {
  res.redirect("/#contacto");
});

router.get("/quienessomos", (req, res) => {
  res.redirect("/#experiencia");
});

router.get("/privacidad", (req, res) => {
  res.render("privacidad");
});

module.exports = router;
