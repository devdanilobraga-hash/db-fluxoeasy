const express = require("express");
const router  = express.Router();
const auth    = require("../middleware/auth");
const { criarVenda }                  = require("../controllers/vendaController");
const { listarVendas, getVenda }      = require("../controllers/vendaHistoricoController");

router.post("/",    auth, criarVenda);
router.get("/",     auth, listarVendas);
router.get("/:id",  auth, getVenda);

module.exports = router;