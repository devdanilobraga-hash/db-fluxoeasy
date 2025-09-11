const express = require('express');
const router = express.Router();
const { criarVenda} = require('../controllers/vendaController');
const authMiddleware = require('../middleware/auth');

router.use(authMiddleware);

router.post('/', criarVenda);

module.exports = router;
