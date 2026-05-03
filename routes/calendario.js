const express = require("express");
const router  = express.Router();
const auth    = require("../middleware/auth"); // seu middleware existente
const c       = require("../controllers/calendarioController");

router.use(auth); // todas as rotas exigem autenticação

router.get   ("/",          c.getEventos);     // ?inicio=&fim=&tipo=&status=
router.get   ("/proximos",  c.getProximos);    // widget do dashboard
router.get   ("/:id",       c.getEventoById);
router.post  ("/",          c.createEvento);
router.put   ("/:id",       c.updateEvento);
router.patch ("/:id/status",c.updateStatus);   // atualização rápida de status
router.delete("/:id",       c.deleteEvento);

module.exports = router;