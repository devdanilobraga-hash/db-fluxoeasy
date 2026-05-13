const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const {
  getSubClientes, createSubCliente, updateSubCliente, removeSubCliente
} = require("../controllers/subClienteController");

router.get("/",        auth, getSubClientes);
router.post("/",       auth, createSubCliente);
router.put("/:id",     auth, updateSubCliente);
router.delete("/:id",  auth, removeSubCliente);

module.exports = router;