const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth'); 
const {
  getPlanos,
  getPlanoById,
  createPlano,
  updatePlano,
  deletePlano
} = require('../controllers/planosController');

router.use(auth);

router.get('/', getPlanos);
router.get('/:id', getPlanoById);
router.post('/', createPlano);      
router.put('/:id', updatePlano);    
router.delete('/:id', deletePlano); 

module.exports = router;
