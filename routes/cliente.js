const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth'); 
const { getClientes, getClienteById, updateCliente, uploadLogo, upload } = require('../controllers/clienteController');

router.use(auth);

router.get('/', getClientes);        
router.get('/:id', getClienteById);  
router.put('/:id', updateCliente);   
router.post('/:id/upload-logo', upload.single('logo'), uploadLogo);

module.exports = router;
