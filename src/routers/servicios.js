const express = require("express");
const router = express.Router();

router.get("/servicios", (req, res) => {
  res.redirect("/#servicios");
});

router.get("/servicios/:tipo", (req, res) => {
  res.redirect("/#servicios");
});

module.exports = router;
