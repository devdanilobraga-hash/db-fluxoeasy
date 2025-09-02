const express = require('express');
const router = express.Router();
const { createEntrada, getEntradas, getEntradaById, deleteEntrada } = require('../controllers/entradaController');
const authMiddleware = require('../middleware/auth');

// Todas as rotas precisam de autenticação
router.use(authMiddleware);

router.post('/', createEntrada);
router.get('/', getEntradas);
router.get('/:id', getEntradaById);
router.delete('/:id', deleteEntrada);

module.exports = router;
