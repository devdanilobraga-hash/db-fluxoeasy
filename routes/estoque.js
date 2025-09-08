const express = require('express');
const router = express.Router();
const { getEstoque, putEstoque } = require('../controllers/estoqueController');
const authMiddleware = require('../middleware/auth');

router.use(authMiddleware);

// apenas listagem direta
router.get('/', getEstoque);
router.put('/:id/valor-venda', putEstoque);

module.exports = router;
