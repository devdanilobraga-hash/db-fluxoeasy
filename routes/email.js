const express = require("express");
const router = express.Router();
const { verificarEmail, listarEmails, cadastrarEmail, desativarEmail, ativarEmail, deletarEmail, atualizarDataPagamento, atualizarVencimento } = require("../controllers/emailController");

// Rota DELETE
router.delete("/:id", deletarEmail);

// 🔹 Rota pública para verificação (usada pela automação)
router.post("/verificar", verificarEmail);

// 🔹 Rotas protegidas (ex: admin do FluxoEasy)
router.get("/", listarEmails);
router.post("/", cadastrarEmail);
router.put("/:id/desativar", desativarEmail);
router.put("/:id/ativar", ativarEmail);
router.put('/emails/pagamento/:id', atualizarDataPagamento);
router.put('/emails/vencimento/:id', atualizarVencimento);

module.exports = router;