const express = require("express");
const router = express.Router();

router.get("/contacto", (req, res) => {
  res.redirect("/#contacto");
});

router.get("/quienessomos", (req, res) => {
  res.redirect("/#experiencia");
});

module.exports = router;
