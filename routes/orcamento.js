const express = require("express");
const router  = express.Router();
const auth    = require("../middleware/auth");
const {
  criarOrcamento,
  listarOrcamentos,
  getOrcamento,
  atualizarStatus,
  converterEmVenda,
  editarOrcamento,
  deletarOrcamento,
} = require("../controllers/orcamentoController");

router.get("/",    auth, listarOrcamentos);
router.post("/",   auth, criarOrcamento);

router.get("/:id",           auth, getOrcamento);
router.put("/:id",           auth, editarOrcamento);
router.delete("/:id",        auth, deletarOrcamento);
router.put("/:id/status",    auth, atualizarStatus);
router.post("/:id/converter-venda", auth, converterEmVenda);

module.exports = router;