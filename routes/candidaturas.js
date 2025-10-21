const express = require("express");
const router = express.Router();
const {
  cadastrarCandidatura,
  listarCandidaturas,
  listarCandidaturasPorEmail,
  deletarCandidatura
} = require("../controllers/candidaturasController");

// Rotas públicas (ou podem colocar auth/checkClienteAtivo se quiser proteção)
router.post("/", cadastrarCandidatura);
router.get("/", listarCandidaturas);
router.get("/email/:email_id", listarCandidaturasPorEmail);
router.delete("/:id", deletarCandidatura);

module.exports = router;
