const express = require('express');
const router = express.Router();
const {
  getPlanos,
  getPlanoById,
  createPlano,
  updatePlano,
  deletePlano
} = require('../controllers/planosController');

router.get('/', getPlanos);
router.get('/:id', getPlanoById);
router.post('/', createPlano);
router.put('/:id', updatePlano);
router.delete('/:id', deletePlano);

module.exports = router;
