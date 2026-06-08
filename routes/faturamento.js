const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const checkClienteAtivo = require("../middleware/checkClienteAtivo");
const getPlano = require("../middleware/plano");
const {
  resumoFaturamento,
  evolucaoFaturamento,
  detalhesFaturamento,
  faturamentoCompleto,
  despesasPorCategoria
} = require("../controllers/faturamentoController");

router.use(auth, checkClienteAtivo, getPlano);

router.get("/resumo", resumoFaturamento);
router.get("/evolucao", evolucaoFaturamento);
router.get("/detalhes", detalhesFaturamento);
router.get("/completo", faturamentoCompleto);
router.get('/despesas-por-categoria', despesasPorCategoria);

module.exports = router;