const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth'); // seu middleware que decodifica o JWT
const { getClientes, getClienteById, updateCliente } = require('../controllers/clienteController');

// Todas as rotas usam autenticação
router.use(auth);

router.get('/', getClientes);        // retorna apenas o cliente vinculado
router.get('/:id', getClienteById);  // só permite acessar se for o mesmo cliente
router.put('/:id', updateCliente);   // só permite atualizar o cliente vinculado

module.exports = router;
