const express = require('express');
const router = express.Router();
const { 
  createProduto, 
  getProdutos, 
  getProdutoById, 
  updateProduto, 
  deleteProduto 
} = require('../controllers/produtosController');
const auth = require('../middlewares/auth');

router.post('/', auth, createProduto);          // criar produto
router.get('/', auth, getProdutos);            // listar todos
router.get('/:id', auth, getProdutoById);      // buscar por id
router.put('/:id', auth, updateProduto);       // atualizar
router.delete('/:id', auth, deleteProduto);    // deletar

module.exports = router;
