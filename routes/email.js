const express = require("express");
const router = express.Router();
const { verificarEmail, listarEmails, cadastrarEmail, desativarEmail } = require("../controllers/emailController");

// 🔹 Rota pública para verificação (usada pela automação)
router.post("/verificar", verificarEmail);

// 🔹 Rotas protegidas (ex: admin do FluxoEasy)
router.get("/", listarEmails);
router.post("/", cadastrarEmail);
router.put("/:id/desativar", desativarEmail);

module.exports = router;
