const pool = require('../db');

// Quantidade total de produtos ativos
const totalProdutos = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  try {
    const result = await pool.query(
      `SELECT COUNT(*) AS total_produtos 
       FROM produto 
       WHERE cliente_id=$1 AND ativo=true`,
      [cliente_id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar total de produtos" });
  }
};

// Relatório de vendas com filtro
const relatorioVendas = async (req, res) => {
  const { cliente_id } = req.user;
  const { dataInicio, dataFim, produto_id, forma_pagamento } = req.query;

  try {
    let query = `
      SELECT v.id as venda_id, v.data_criacao, v.forma_pagamento, v.valor_total, v.valor_pago, v.troco, v.desconto,
             vi.produto_id, p.nome as produto_nome, vi.quantidade, vi.valor_unitario, vi.valor_total as valor_item
      FROM venda v
      JOIN venda_item vi ON vi.venda_id = v.id
      JOIN produto p ON p.id = vi.produto_id
      WHERE v.cliente_id = $1
    `;

    const params = [cliente_id];
    let idx = 2;

    if (dataInicio) {
      query += ` AND v.data_criacao::date >= $${idx++}`;
      params.push(dataInicio);
    }
    if (dataFim) {
      query += ` AND v.data_criacao::date <= $${idx++}`;
      params.push(dataFim);
    }
    if (produto_id) {
      query += ` AND vi.produto_id = $${idx++}`;
      params.push(produto_id);
    }
    if (forma_pagamento) {
      query += ` AND v.forma_pagamento = $${idx++}`;
      params.push(forma_pagamento);
    }

    query += " ORDER BY v.data_criacao DESC";

    const result = await pool.query(query, params);
    res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao gerar relatório de vendas." });
  }
};

// Quantidade total de volumes no estoque
const totalVolumesEstoque = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  try {
    const result = await pool.query(
      `SELECT COALESCE(SUM(quantidade),0) AS total_volumes
       FROM estoque
       WHERE cliente_id=$1`,
      [cliente_id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar total de volumes" });
  }
};

// Movimentação diária de entradas
const movimentacaoEntradaDiaria = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  try {
    const result = await pool.query(
      `SELECT 
         DATE(data_entrada) AS data,
         COUNT(*) AS total_entradas,
         COALESCE(SUM(quantidade),0) AS total_volumes
       FROM entrada
       WHERE cliente_id=$1
         AND DATE(data_entrada) = CURRENT_DATE
       GROUP BY DATE(data_entrada)`,
      [cliente_id]
    );
    res.json(result.rows[0] || { data: null, total_entradas: 0, total_volumes: 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar movimentação de entradas" });
  }
};

// Movimentação diária de vendas
const movimentacaoVendaDiaria = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  try {
    const result = await pool.query(
      `SELECT 
         DATE(v.data_criacao) AS data,
         COUNT(*) AS total_vendas,
         COALESCE(SUM(v.valor_total),0) AS valor_total_vendas
       FROM venda v
       WHERE v.cliente_id=$1
         AND DATE(v.data_criacao) = CURRENT_DATE
       GROUP BY DATE(v.data_criacao)`,
      [cliente_id]
    );
    res.json(result.rows[0] || { data: null, total_vendas: 0, valor_total_vendas: 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar movimentação de vendas" });
  }
};

module.exports = {
  totalProdutos,
  totalVolumesEstoque,
  movimentacaoEntradaDiaria,
  movimentacaoVendaDiaria,
  relatorioVendas
};
