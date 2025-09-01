const express = require('express');
const router = express.Router();
const { registerUser, loginUser, getUsers } = require('../controllers/usuariosController');
const auth = require('../middleware/auth');

router.post('/register', registerUser);   // cadastro
router.post('/login', loginUser);         // login
router.get('/', auth, getUsers);          // lista usuários (protegido)

module.exports = router;
