const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth'); 
const { getClientes, getClienteById, updateCliente, uploadLogo, upload, getAllClientes, createCliente } = require('../controllers/clienteController');

router.use(auth);

router.get('/all', getAllClientes);   // 🔹 rota que seu frontend chama
router.get('/:id', getClienteById);  
router.put('/:id', updateCliente);   
router.post('/:id/upload-logo', upload.single('logo'), uploadLogo);
router.get('/', getClientes);        
router.post('/', createCliente); 

module.exports = router;
