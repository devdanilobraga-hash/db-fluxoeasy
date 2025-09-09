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
  movimentacaoVendaDiaria
};
