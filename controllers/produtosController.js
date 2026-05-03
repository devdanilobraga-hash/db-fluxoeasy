const pool = require('../db');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const isServico = (tipo) => tipo === 'servico';

// ─── Criar produto ou serviço ─────────────────────────────────────────────────
const createProduto = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  const {
    nome, descricao, ean,
    preco_custo, estoque,
    tipo = 'produto', // 'produto' | 'servico'
  } = req.body;

  // Serviço nunca tem estoque — força 0 independente do que vier no body
  const estoqueInicial = isServico(tipo) ? 0 : (estoque || 0);

  try {
    const result = await pool.query(
      `INSERT INTO produto
         (nome, descricao, ean, preco_custo, estoque, cliente_id, ativo, tipo)
       VALUES ($1,$2,$3,$4,$5,$6,true,$7)
       RETURNING *`,
      [nome, descricao, ean || null, preco_custo, estoqueInicial, cliente_id, tipo]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[createProduto]', err);
    if (err.code === '23505' && err.constraint === 'ux_produto_cliente_ean') {
      return res.status(400).json({ error: 'EAN duplicado' });
    }
    res.status(500).json({ error: 'Erro ao criar produto' });
  }
};

// ─── Listar (pode filtrar por tipo via query ?tipo=produto ou ?tipo=servico) ──
const getProdutos = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  const { tipo } = req.query; // opcional

  try {
    const conditions = ['cliente_id = $1'];
    const values     = [cliente_id];

    if (tipo && ['produto', 'servico'].includes(tipo)) {
      conditions.push(`tipo = $2`);
      values.push(tipo);
    }

    const result = await pool.query(
      `SELECT * FROM produto
       WHERE ${conditions.join(' AND ')}
       ORDER BY tipo, nome`, // agrupa produtos antes de serviços
      values
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[getProdutos]', err);
    res.status(500).json({ error: 'Erro ao buscar produtos' });
  }
};

// ─── Buscar por ID ────────────────────────────────────────────────────────────
const getProdutoById = async (req, res) => {
  const { id } = req.params;
  const cliente_id = req.user.cliente_id;

  try {
    const result = await pool.query(
      'SELECT * FROM produto WHERE id = $1 AND cliente_id = $2',
      [id, cliente_id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: 'Produto não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[getProdutoById]', err);
    res.status(500).json({ error: 'Erro ao buscar produto' });
  }
};

// ─── Atualizar ────────────────────────────────────────────────────────────────
const updateProduto = async (req, res) => {
  const { id } = req.params;
  const cliente_id = req.user.cliente_id;
  const { nome, descricao, ean, preco_custo, ativo, tipo } = req.body;

  try {
    // Busca o atual para não perder campos não enviados
    const { rows } = await pool.query(
      'SELECT * FROM produto WHERE id = $1 AND cliente_id = $2',
      [id, cliente_id]
    );
    if (rows.length === 0)
      return res.status(404).json({ error: 'Produto não encontrado' });

    const atual = rows[0];
    const novoTipo = tipo ?? atual.tipo;

    const result = await pool.query(
      `UPDATE produto
       SET nome=$1, descricao=$2, ean=$3, preco_custo=$4, ativo=$5, tipo=$6
       WHERE id=$7 AND cliente_id=$8
       RETURNING *`,
      [
        nome        ?? atual.nome,
        descricao   ?? atual.descricao,
        ean         !== undefined ? ean : atual.ean,
        preco_custo ?? atual.preco_custo,
        ativo       ?? atual.ativo,
        novoTipo,
        id,
        cliente_id,
      ]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[updateProduto]', err);
    res.status(500).json({ error: 'Erro ao atualizar produto' });
  }
};

// ─── Ativar / Desativar ───────────────────────────────────────────────────────
const ativarProduto = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      'UPDATE produto SET ativo = true WHERE id = $1 RETURNING *',
      [id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: 'Produto não encontrado' });
    res.json({ message: 'Ativado com sucesso', produto: result.rows[0] });
  } catch (err) {
    console.error('[ativarProduto]', err);
    res.status(500).json({ error: 'Erro ao ativar produto' });
  }
};

const desativarProduto = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      'UPDATE produto SET ativo = false WHERE id = $1 RETURNING *',
      [id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: 'Produto não encontrado' });
    res.json({ message: 'Desativado com sucesso', produto: result.rows[0] });
  } catch (err) {
    console.error('[desativarProduto]', err);
    res.status(500).json({ error: 'Erro ao desativar produto' });
  }
};

module.exports = {
  createProduto,
  getProdutos,
  getProdutoById,
  updateProduto,
  ativarProduto,
  desativarProduto,
};