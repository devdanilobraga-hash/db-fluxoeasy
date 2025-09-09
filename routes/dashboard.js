const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const {
  totalProdutos,
  totalVolumesEstoque,
  movimentacaoEntradaDiaria,
  movimentacaoVendaDiaria
} = require('../controllers/dashboardController');

router.use(auth);

router.get('/total-produtos', auth, totalProdutos);
router.get('/total-volumes', auth, totalVolumesEstoque);
router.get('/entrada-diaria', auth, movimentacaoEntradaDiaria);
router.get('/venda-diaria', auth, movimentacaoVendaDiaria);

module.exports = router;
