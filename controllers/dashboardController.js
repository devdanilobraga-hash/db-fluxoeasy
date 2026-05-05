const pool = require("../db");

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MODOS = ["todos", "vendas", "alugueis"];
const getModo = (query) => MODOS.includes(query.modo) ? query.modo : "todos";

// ─── Existentes ───────────────────────────────────────────────────────────────

const totalProdutos = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  try {
    const result = await pool.query(
      `SELECT COUNT(*) AS total_produtos FROM produto WHERE cliente_id=$1 AND ativo=true`,
      [cliente_id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar total de produtos" });
  }
};

const totalVolumesEstoque = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  try {
    const result = await pool.query(
      `SELECT COALESCE(SUM(quantidade),0) AS total_volumes FROM estoque WHERE cliente_id=$1`,
      [cliente_id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar total de volumes" });
  }
};

const movimentacaoEntradaDiaria = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  try {
    const result = await pool.query(
      `SELECT DATE(data_entrada) AS data, COUNT(*) AS total_entradas,
              COALESCE(SUM(quantidade),0) AS total_volumes
       FROM entrada
       WHERE cliente_id=$1 AND DATE(data_entrada) = CURRENT_DATE
       GROUP BY DATE(data_entrada)`,
      [cliente_id]
    );
    res.json(result.rows[0] || { data: null, total_entradas: 0, total_volumes: 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar movimentação de entradas" });
  }
};

const movimentacaoVendaDiaria = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  try {
    const result = await pool.query(
      `SELECT DATE(v.criado_em) AS data, COUNT(*) AS total_vendas,
              COALESCE(SUM(v.valor_total),0) AS valor_total_vendas
       FROM venda v
       WHERE v.cliente_id=$1 AND DATE(v.criado_em) = CURRENT_DATE
       GROUP BY DATE(v.criado_em)`,
      [cliente_id]
    );
    res.json(result.rows[0] || { data: null, total_vendas: 0, valor_total_vendas: 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar movimentação de vendas" });
  }
};

const entradasUltimosDias = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  try {
    const result = await pool.query(
      `SELECT DATE(data_entrada) AS data_entrada, SUM(quantidade) AS quantidade
       FROM entrada WHERE cliente_id = $1
       GROUP BY DATE(data_entrada)
       ORDER BY DATE(data_entrada) DESC LIMIT 10`,
      [cliente_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar entradas" });
  }
};

const vendasUltimosDias = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  try {
    const result = await pool.query(
      `SELECT DATE(criado_em) AS data_criacao, SUM(valor_total) AS valor_total
       FROM venda WHERE cliente_id = $1
       GROUP BY DATE(criado_em)
       ORDER BY DATE(criado_em) DESC LIMIT 10`,
      [cliente_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar vendas" });
  }
};

const relatorioVendas = async (req, res) => {
  const { cliente_id } = req.user;
  const { dataInicio, dataFim, produto_id, forma_pagamento } = req.query;

  try {
    let query = `
      SELECT v.id as venda_id, v.criado_em AS data_criacao, v.forma_pagamento,
             v.valor_total, v.valor_pago, v.troco, v.desconto,
             vi.produto_id, p.nome as produto_nome, vi.quantidade,
             vi.valor_unitario, vi.valor_total as valor_item
      FROM venda v
      JOIN venda_item vi ON vi.venda_id = v.id
      JOIN produto p ON p.id = vi.produto_id
      WHERE v.cliente_id = $1
    `;
    const params = [cliente_id];
    let idx = 2;

    if (dataInicio) { query += ` AND v.criado_em::date >= $${idx++}`; params.push(dataInicio); }
    if (dataFim)    { query += ` AND v.criado_em::date <= $${idx++}`; params.push(dataFim); }
    if (produto_id) { query += ` AND vi.produto_id = $${idx++}`;      params.push(produto_id); }
    if (forma_pagamento) { query += ` AND v.forma_pagamento = $${idx++}`; params.push(forma_pagamento); }

    query += " ORDER BY v.criado_em DESC";

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao gerar relatório de vendas." });
  }
};

// ─── Faturamento diário — aceita ?modo=todos|vendas|alugueis ──────────────────

const faturamentoDiario = async (req, res) => {
  const { cliente_id } = req.user;
  const modo = getModo(req.query);

  try {
    // Receita de vendas do dia
    let receita_vendas = 0;
    if (modo === "todos" || modo === "vendas") {
      const vRes = await pool.query(
        `SELECT COALESCE(SUM(valor_total), 0) AS total
         FROM venda
         WHERE cliente_id = $1
           AND DATE(criado_em AT TIME ZONE 'America/Sao_Paulo') = CURRENT_DATE`,
        [cliente_id]
      );
      receita_vendas = Number(vRes.rows[0].total);
    }

    // Receita de aluguéis pagos hoje
    let receita_alugueis = 0;
    if (modo === "todos" || modo === "alugueis") {
      const aRes = await pool.query(
        `SELECT COALESCE(SUM(ap.valor), 0) AS total
         FROM aluguel_pagamento ap
         JOIN aluguel a ON a.id = ap.aluguel_id
         WHERE a.cliente_id = $1
           AND DATE(ap.created_at AT TIME ZONE 'America/Sao_Paulo') = CURRENT_DATE`,
        [cliente_id]
      );
      receita_alugueis = Number(aRes.rows[0].total);
    }

    res.json({
      receita_vendas,
      receita_alugueis,
      total: Number((receita_vendas + receita_alugueis).toFixed(2)),
      modo,
    });
  } catch (err) {
    console.error("[faturamentoDiario]", err);
    res.status(500).json({ error: "Erro ao calcular faturamento diário." });
  }
};

// ─── Aluguéis ativos hoje — BUG FIX: alias LATERAL renomeado ─────────────────

const aluguelDiario = async (req, res) => {
  const { cliente_id } = req.user;
  try {
    const result = await pool.query(
      `SELECT
         COUNT(a.id)                              AS total_alugueis,
         COALESCE(SUM(pagamentos_hoje.total), 0)  AS valor_recebido_hoje
       FROM aluguel a
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(ap.valor), 0) AS total
         FROM aluguel_pagamento ap
         WHERE ap.aluguel_id = a.id
           AND ap.created_at::date = CURRENT_DATE
       ) pagamentos_hoje ON true
       WHERE a.cliente_id = $1
         AND a.status NOT IN ('cancelado', 'devolvido')
         AND a.data_retirada::date  <= CURRENT_DATE
         AND a.data_devolucao::date >= CURRENT_DATE`,
      [cliente_id]
    );

    const row = result.rows[0];
    res.json({
      total_alugueis:      Number(row.total_alugueis),
      valor_recebido_hoje: Number(row.valor_recebido_hoje),
    });
  } catch (err) {
    console.error("[aluguelDiario]", err);
    res.status(500).json({ error: "Erro ao buscar dados de aluguel diário." });
  }
};

// ─── Gráfico receita — aceita ?modo=todos|vendas|alugueis ────────────────────

const receitaUltimosDias = async (req, res) => {
  const { cliente_id } = req.user;
  const modo = getModo(req.query);

  try {
    let vendasRows   = [];
    let alugueisRows = [];

    if (modo === "todos" || modo === "vendas") {
      const r = await pool.query(
        `SELECT DATE(criado_em AT TIME ZONE 'America/Sao_Paulo') AS data,
                COALESCE(SUM(valor_total), 0) AS valor
         FROM venda
         WHERE cliente_id = $1
           AND criado_em >= CURRENT_DATE - INTERVAL '9 days'
         GROUP BY DATE(criado_em AT TIME ZONE 'America/Sao_Paulo')
         ORDER BY data ASC`,
        [cliente_id]
      );
      vendasRows = r.rows;
    }

    if (modo === "todos" || modo === "alugueis") {
      const r = await pool.query(
        `SELECT DATE(ap.created_at AT TIME ZONE 'America/Sao_Paulo') AS data,
                COALESCE(SUM(ap.valor), 0) AS valor
         FROM aluguel_pagamento ap
         JOIN aluguel a ON a.id = ap.aluguel_id
         WHERE a.cliente_id = $1
           AND ap.created_at >= CURRENT_DATE - INTERVAL '9 days'
         GROUP BY DATE(ap.created_at AT TIME ZONE 'America/Sao_Paulo')
         ORDER BY data ASC`,
        [cliente_id]
      );
      alugueisRows = r.rows;
    }

    const mapaVendas   = Object.fromEntries(vendasRows.map(r   => [r.data.toISOString().slice(0,10), Number(r.valor)]));
    const mapaAlugueis = Object.fromEntries(alugueisRows.map(r => [r.data.toISOString().slice(0,10), Number(r.valor)]));

    const todasDatas = [...new Set([...Object.keys(mapaVendas), ...Object.keys(mapaAlugueis)])].sort();

    const dados = todasDatas.map(data => ({
      data,
      vendas:   mapaVendas[data]   ?? 0,
      alugueis: mapaAlugueis[data] ?? 0,
      total:    Number(((mapaVendas[data] ?? 0) + (mapaAlugueis[data] ?? 0)).toFixed(2)),
    }));

    res.json(dados);
  } catch (err) {
    console.error("[receitaUltimosDias]", err);
    res.status(500).json({ error: "Erro ao buscar receita dos últimos dias." });
  }
};

module.exports = {
  totalProdutos,
  totalVolumesEstoque,
  movimentacaoEntradaDiaria,
  movimentacaoVendaDiaria,
  relatorioVendas,
  entradasUltimosDias,
  vendasUltimosDias,
  faturamentoDiario,
  aluguelDiario,
  receitaUltimosDias,
};