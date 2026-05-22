const express = require("express");
const router = express.Router();

router.get("/peluqueria", (req, res) => {
  res.redirect("/#servicios");
});

module.exports = router;
