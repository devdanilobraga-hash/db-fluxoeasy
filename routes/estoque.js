const express = require('express');
const router = express.Router();
const { getEstoque } = require('../controllers/estoqueController');
const authMiddleware = require('../middleware/auth');

router.use(authMiddleware);

// apenas listagem direta
router.get('/', getEstoque);    

module.exports = router;
