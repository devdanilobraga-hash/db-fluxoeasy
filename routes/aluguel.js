const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth"); // ajuste o caminho se necessário

const {
  criarAluguel,
  getAlugueis,
  getAluguelById,
  updateAluguel,
  updateStatusAluguel,
  registrarPagamento,
  verificarDisponibilidade,
  getPagamentos,
  getContrato,
  getComprovante,
} = require("../controllers/aluguelController");

// Todas as rotas exigem autenticação
router.use(authMiddleware);

// ── Disponibilidade (antes de /:id para não colidir) ──────────────────────────
router.get("/disponibilidade", verificarDisponibilidade);

// ── CRUD principal ────────────────────────────────────────────────────────────
router.post("/",       criarAluguel);
router.get("/",        getAlugueis);
router.get("/:id",     getAluguelById);
router.put("/:id",     updateAluguel);

// ── Status ────────────────────────────────────────────────────────────────────
router.patch("/:id/status", updateStatusAluguel);

// ── Pagamentos ────────────────────────────────────────────────────────────────
router.get("/:id/pagamentos",  getPagamentos);
router.post("/:id/pagamento",  registrarPagamento);

// ── Documentos (JSON estruturado para o frontend gerar PDF) ───────────────────
router.get("/:id/contrato",    getContrato);
router.get("/:id/comprovante", getComprovante);

module.exports = router;