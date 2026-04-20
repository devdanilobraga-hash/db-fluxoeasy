// middleware/plano.js
const pool = require('../db');

const getPlano = async (req, res, next) => {
  try {
    if (!req.user?.cliente_id) return next();

    const result = await pool.query(
      `SELECT p.*
       FROM cliente c
       JOIN planos p ON c.plano_id = p.id
       WHERE c.id = $1`,
      [req.user.cliente_id]
    );

    req.plano = result.rows[0] || null;

    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao carregar plano' });
  }
};

module.exports = getPlano;