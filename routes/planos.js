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

// 🔹 Rotas públicas (sem token)
router.get('/', getPlanos);       // listar todos os planos (ativos/inativos)
router.get('/:id', getPlanoById); // buscar um plano específico

// 🔹 Rotas privadas (somente admin)
router.post('/', auth, createPlano);      
router.put('/:id', auth, updatePlano);    
router.delete('/:id', auth, deletePlano); 

module.exports = router;
