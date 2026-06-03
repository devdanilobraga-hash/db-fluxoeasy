const express = require("express");
const router  = express.Router();
const auth    = require("../middleware/auth");

const {
  getClientes,
  getClienteById,
  updateCliente,
  uploadLogo,
  upload,
  updateDadosInternos,
  getAllClientes,
  createCliente,
  getClienteByCpfCnpj,
} = require("../controllers/clienteController");

const {
  getTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  restaurarTemplate,
  renderizarRecibo,
  renderizarEtiqueta,
  setPadraoCateg,
} = require("../controllers/templateController");

// ─── Rota pública ─────────────────────────────────────────────────────────────
router.get("/cpf/:cpf_cnpj", getClienteByCpfCnpj);

router.use(auth);

// ─── Clientes ─────────────────────────────────────────────────────────────────
router.get("/all",                             getAllClientes);
router.get("/",                                getClientes);
router.post("/",                               createCliente);
router.get("/:id",                             getClienteById);
router.put("/:id",                             updateCliente);
router.put("/:id/dados-internos",              updateDadosInternos);
router.post("/:id/upload-logo",                upload.single("logo"), uploadLogo);

// ─── Templates ────────────────────────────────────────────────────────────────
router.get("/:id/templates",                   getTemplates);
router.post("/:id/templates",                  createTemplate);
router.put("/:id/templates/:tid",              updateTemplate);
router.delete("/:id/templates/:tid",           deleteTemplate);
router.post("/:id/templates/:tid/restaurar",   restaurarTemplate);
router.post("/:id/templates/:tid/padrao", auth, setPadraoCateg);

// ─── Impressão ────────────────────────────────────────────────────────────────
router.post("/:id/imprimir/recibo",            renderizarRecibo);
router.post("/:id/imprimir/etiqueta",          renderizarEtiqueta);

module.exports = router;