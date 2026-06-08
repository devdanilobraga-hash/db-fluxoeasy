const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const { criarDespesa, listarDespesas, atualizarDespesa, deletarDespesa } = require("../controllers/despesaController");

router.use(auth);
router.post("/", criarDespesa);
router.get("/", listarDespesas);
router.put("/:id", atualizarDespesa);
router.delete("/:id", deletarDespesa);

module.exports = router;