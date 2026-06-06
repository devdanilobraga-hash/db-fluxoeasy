const express = require('express');
const router = express.Router();
const { 
  createProduto, 
  getProdutos, 
  getProdutoById, 
  updateProduto, 
  desativarProduto,
  ativarProduto,
  removerImagemProduto,
  uploadImagemProduto,
  uploadProduto,
} = require('../controllers/produtosController');
const auth = require('../middleware/auth');

router.post('/', auth, createProduto);          // criar produto
router.get('/', auth, getProdutos);            // listar todos
router.get('/:id', auth, getProdutoById);      // buscar por id
router.put('/:id', auth, updateProduto);       // atualizar
router.put('/:id/desativar', auth, desativarProduto); // ✅ desativar
router.put('/:id/ativar', auth, ativarProduto);
router.post("/:id/imagem", auth, uploadProduto.single("imagem"),uploadImagemProduto);
router.delete("/:id/imagem", auth,removerImagemProduto);

module.exports = router;
