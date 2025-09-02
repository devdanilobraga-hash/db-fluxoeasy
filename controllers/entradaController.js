const pool = require('../db');

// Criar entrada
const createEntrada = async (req, res) => {
  const { produto_id, quantidade, preco_custo, data_validade, observacao } = req.body;
  const cliente_id = req.user.cliente_id; // do JWT
  const usuario_id = req.user.id; // usuário logado

  try {
    const result = await pool.query(
      `INSERT INTO entrada (cliente_id, produto_id, usuario_id, quantidade, preco_custo, data_validade, data_entrada, observacao)
       VALUES ($1,$2,$3,$4,$5,$6,NOW(),$7) RETURNING *`,
      [cliente_id, produto_id, usuario_id, quantidade, preco_custo, data_validade, observacao]
    );

    // Atualizar estoque do produto
    await pool.query(
      `UPDATE produto SET estoque = estoque + $1 WHERE id = $2 AND cliente_id = $3`,
      [quantidade, produto_id, cliente_id]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao registrar entrada' });
  }
};

// Listar entradas
const getEntradas = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  try {
    const result = await pool.query(
      `SELECT e.*, p.nome AS produto_nome, u.nome AS usuario_nome
       FROM entrada e
       JOIN produto p ON e.produto_id = p.id
       JOIN usuario u ON e.usuario_id = u.id
       WHERE e.cliente_id = $1
       ORDER BY e.data_entrada DESC`,
      [cliente_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar entradas' });
  }
};

// Buscar entrada por ID
const getEntradaById = async (req, res) => {
  const { id } = req.params;
  const cliente_id = req.user.cliente_id;

  try {
    const result = await pool.query(
      `SELECT e.*, p.nome AS produto_nome, u.nome AS usuario_nome
       FROM entrada e
       JOIN produto p ON e.produto_id = p.id
       JOIN usuario u ON e.usuario_id = u.id
       WHERE e.id = $1 AND e.cliente_id = $2`,
      [id, cliente_id]
    );

    if (result.rows.length === 0) 
      return res.status(404).json({ error: 'Entrada não encontrada' });

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar entrada' });
  }
};

// Deletar entrada (opcional - só se quiser permitir corrigir lançamentos)
const deleteEntrada = async (req, res) => {
  const { id } = req.params;
  const cliente_id = req.user.cliente_id;

  try {
    // Recuperar entrada antes de deletar (para ajustar estoque)
    const entrada = await pool.query(
      'SELECT * FROM entrada WHERE id=$1 AND cliente_id=$2',
      [id, cliente_id]
    );

    if (entrada.rows.length === 0) 
      return res.status(404).json({ error: 'Entrada não encontrada' });

    const { produto_id, quantidade } = entrada.rows[0];

    // Deletar entrada
    await pool.query('DELETE FROM entrada WHERE id=$1 AND cliente_id=$2', [id, cliente_id]);

    // Ajustar estoque
    await pool.query(
      'UPDATE produto SET estoque = estoque - $1 WHERE id = $2 AND cliente_id=$3',
      [quantidade, produto_id, cliente_id]
    );

    res.json({ message: 'Entrada deletada com sucesso e estoque ajustado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao deletar entrada' });
  }
};

module.exports = { createEntrada, getEntradas, getEntradaById, deleteEntrada };
