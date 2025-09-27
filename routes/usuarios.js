const express = require('express');
const router = express.Router();
const { registerUser, loginUser, getUsers, desativarUser, ativarUser, updateUser } = require('../controllers/usuariosController');
const auth = require('../middleware/auth');

router.post('/register', auth, registerUser);   // cadastro
router.post('/login', loginUser);         // login
router.get('/', auth, getUsers);          // lista usuários (protegido)
router.put('/:id/desativar', auth, desativarUser); // ✅ desativar
router.put('/:id/ativar', auth, ativarUser);
router.put('/:id', auth, updateUser); 

module.exports = router;
