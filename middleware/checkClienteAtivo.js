const pool = require('../db');

const checkClienteAtivo = async (req, res, next) => {
  try {
    const cliente_id = req.user?.cliente_id;

    if (!cliente_id) return res.status(401).json({ error: 'Cliente não encontrado no token.' });

    const result = await pool.query('SELECT ativo FROM cliente WHERE id = $1', [cliente_id]);

    if (result.rows.length === 0) return res.status(404).json({ error: 'Cliente não encontrado.' });
    if (!result.rows[0].ativo) return res.status(403).json({ error: 'Acesso bloqueado: cliente inativo.' });

    next();
  } catch (err) {
    console.error('Erro ao verificar cliente ativo:', err);
    res.status(500).json({ error: 'Erro interno ao verificar cliente' });
  }
};

module.exports = checkClienteAtivo;
