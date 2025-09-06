const pool = require('../db');

// Criar produto
const createProduto = async (req, res) => {
  const { nome, descricao, ean, preco, estoque } = req.body;
  const cliente_id = req.user.cliente_id; // pega do token JWT
  try {
    const result = await pool.query(
      `INSERT INTO produto (nome, descricao, ean, preco, estoque, cliente_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [nome, descricao, ean, preco, estoque || 0, cliente_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar produto' });
  }
};


// Listar produtos
const getProdutos = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  try {
    const result = await pool.query('SELECT * FROM produto WHERE cliente_id = $1 ORDER BY nome', [cliente_id]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar produtos' });
  }
};


// Buscar produto por ID
const getProdutoById = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM produto WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Produto não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar produto' });
  }
};

// Atualizar produto
const updateProduto = async (req, res) => {
  const { id } = req.params;
  const { nome, descricao, ean, preco, ativo } = req.body; // sem estoque
  try {
    const result = await pool.query(
      `UPDATE produto 
       SET nome=$1, descricao=$2, ean=$3, preco=$4, ativo=$5
       WHERE id=$6
       RETURNING *`,
      [nome, descricao, ean, preco, ativo, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Produto não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar produto' });
  }
};

// Deletar produto
const deleteProduto = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM produto WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Produto não encontrado' });
    res.json({ message: 'Produto deletado com sucesso' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao deletar produto' });
  }
};

module.exports = { createProduto, getProdutos, getProdutoById, updateProduto, deleteProduto };
