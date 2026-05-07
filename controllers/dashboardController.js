const pool = require("../db");

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MODOS = ["todos", "vendas", "alugueis"];
const getModo = (query) => (MODOS.includes(query.modo) ? query.modo : "todos");

const getFiltroParams = (query) => {
  const { dataInicio, dataFim, forma_pagamento } = query;
  return { dataInicio, dataFim, forma_pagamento };
};

// ─── totalProdutos ────────────────────────────────────────────────────────────

const totalProdutos = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  try {
    const result = await pool.query(
      `SELECT COUNT(*) AS total_produtos FROM produto WHERE cliente_id=$1 AND ativo=true`,
      [cliente_id],
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar total de produtos" });
  }
};

// ─── totalVolumesEstoque ──────────────────────────────────────────────────────

const totalVolumesEstoque = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  try {
    const result = await pool.query(
      `SELECT COALESCE(SUM(quantidade),0) AS total_volumes FROM estoque WHERE cliente_id=$1`,
      [cliente_id],
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar total de volumes" });
  }
};

// ─── movimentacaoEntradaDiaria ────────────────────────────────────────────────

const movimentacaoEntradaDiaria = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  try {
    const result = await pool.query(
      `SELECT DATE(data_entrada) AS data, COUNT(*) AS total_entradas,
              COALESCE(SUM(quantidade),0) AS total_volumes
       FROM entrada
       WHERE cliente_id=$1 AND DATE(data_entrada) = CURRENT_DATE
       GROUP BY DATE(data_entrada)`,
      [cliente_id],
    );
    res.json(result.rows[0] || { data: null, total_entradas: 0, total_volumes: 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar movimentação de entradas" });
  }
};

// ─── movimentacaoVendaDiaria — aceita filtros ─────────────────────────────────

const movimentacaoVendaDiaria = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  const { dataInicio, dataFim, forma_pagamento } = getFiltroParams(req.query);

  try {
    let query = `
      SELECT COUNT(*) AS total_vendas,
             COALESCE(SUM(v.valor_total), 0) AS valor_total_vendas
      FROM venda v
      WHERE v.cliente_id = $1
    `;
    const params = [cliente_id];
    let idx = 2;

    if (dataInicio) { query += ` AND v.criado_em::date >= $${idx++}`; params.push(dataInicio); }
    if (dataFim)    { query += ` AND v.criado_em::date <= $${idx++}`; params.push(dataFim); }
    if (forma_pagamento && forma_pagamento !== "") {
      query += ` AND v.forma_pagamento ILIKE $${idx++}`;
      params.push(`%${forma_pagamento}%`);
    }
    if (!dataInicio && !dataFim) {
      query += ` AND v.criado_em::date = CURRENT_DATE`;
    }

    const result = await pool.query(query, params);
    res.json(result.rows[0] || { total_vendas: 0, valor_total_vendas: 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar movimentação de vendas" });
  }
};

// ─── faturamentoDiario — aceita filtros ──────────────────────────────────────

const faturamentoDiario = async (req, res) => {
  const { cliente_id } = req.user;
  const modo = getModo(req.query);
  const { dataInicio, dataFim, forma_pagamento } = getFiltroParams(req.query);
  const temFiltroData = !!(dataInicio || dataFim);

  try {
    let receita_vendas = 0;
    if (modo === "todos" || modo === "vendas") {
      let q = `SELECT COALESCE(SUM(valor_total), 0) AS total FROM venda WHERE cliente_id = $1`;
      const p = [cliente_id];
      let idx = 2;

      if (dataInicio) { q += ` AND criado_em::date >= $${idx++}`; p.push(dataInicio); }
      if (dataFim)    { q += ` AND criado_em::date <= $${idx++}`; p.push(dataFim); }
      if (!temFiltroData) {
        q += ` AND DATE(criado_em AT TIME ZONE 'America/Sao_Paulo') = CURRENT_DATE`;
      }
      if (forma_pagamento && forma_pagamento !== "") {
        q += ` AND forma_pagamento ILIKE $${idx++}`;
        p.push(`%${forma_pagamento}%`);
      }

      const vRes = await pool.query(q, p);
      receita_vendas = Number(vRes.rows[0].total);
    }

    let receita_alugueis = 0;
    if (modo === "todos" || modo === "alugueis") {
      let q = `
        SELECT COALESCE(SUM(ap.valor), 0) AS total
        FROM aluguel_pagamento ap
        JOIN aluguel a ON a.id = ap.aluguel_id
        WHERE a.cliente_id = $1
      `;
      const p = [cliente_id];
      let idx = 2;

      if (dataInicio) { q += ` AND ap.created_at::date >= $${idx++}`; p.push(dataInicio); }
      if (dataFim)    { q += ` AND ap.created_at::date <= $${idx++}`; p.push(dataFim); }
      if (!temFiltroData) {
        q += ` AND DATE(ap.created_at AT TIME ZONE 'America/Sao_Paulo') = CURRENT_DATE`;
      }

      const aRes = await pool.query(q, p);
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

// ─── aluguelDiario — aceita filtros ──────────────────────────────────────────

const aluguelDiario = async (req, res) => {
  const { cliente_id } = req.user;
  const { dataInicio, dataFim } = getFiltroParams(req.query);
  const temFiltroData = !!(dataInicio || dataFim);

  try {
    const params = [cliente_id];
    let idx = 2;
    let condicaoPagamento;

    if (temFiltroData) {
      const conds = [];
      if (dataInicio) { conds.push(`ap.created_at::date >= $${idx++}`); params.push(dataInicio); }
      if (dataFim)    { conds.push(`ap.created_at::date <= $${idx++}`); params.push(dataFim); }
      condicaoPagamento = conds.join(" AND ");
    } else {
      condicaoPagamento = `ap.created_at::date = CURRENT_DATE`;
    }

    const q = `
      SELECT
        COUNT(a.id) AS total_alugueis,
        COALESCE(SUM(pagamentos_periodo.total), 0) AS valor_recebido_hoje
      FROM aluguel a
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(ap.valor), 0) AS total
        FROM aluguel_pagamento ap
        WHERE ap.aluguel_id = a.id
          AND (${condicaoPagamento})
      ) pagamentos_periodo ON true
      WHERE a.cliente_id = $1
        AND a.status NOT IN ('cancelado', 'devolvido')
        AND a.data_retirada::date  <= CURRENT_DATE
        AND a.data_devolucao::date >= CURRENT_DATE
    `;

    const result = await pool.query(q, params);
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

// ─── receitaUltimosDias — aceita filtros ─────────────────────────────────────

const receitaUltimosDias = async (req, res) => {
  const { cliente_id } = req.user;
  const modo = getModo(req.query);
  const { dataInicio, dataFim } = getFiltroParams(req.query);
  const temFiltroData = !!(dataInicio || dataFim);

  try {
    let vendasRows = [];
    let alugueisRows = [];

    if (modo === "todos" || modo === "vendas") {
      let q = `
        SELECT DATE(criado_em AT TIME ZONE 'America/Sao_Paulo') AS data,
               COALESCE(SUM(valor_total), 0) AS valor
        FROM venda
        WHERE cliente_id = $1
      `;
      const p = [cliente_id];
      let idx = 2;

      if (dataInicio) { q += ` AND criado_em::date >= $${idx++}`; p.push(dataInicio); }
      if (dataFim)    { q += ` AND criado_em::date <= $${idx++}`; p.push(dataFim); }
      if (!temFiltroData) q += ` AND criado_em >= CURRENT_DATE - INTERVAL '9 days'`;

      q += ` GROUP BY DATE(criado_em AT TIME ZONE 'America/Sao_Paulo') ORDER BY data ASC`;
      vendasRows = (await pool.query(q, p)).rows;
    }

    if (modo === "todos" || modo === "alugueis") {
      let q = `
        SELECT DATE(ap.created_at AT TIME ZONE 'America/Sao_Paulo') AS data,
               COALESCE(SUM(ap.valor), 0) AS valor
        FROM aluguel_pagamento ap
        JOIN aluguel a ON a.id = ap.aluguel_id
        WHERE a.cliente_id = $1
      `;
      const p = [cliente_id];
      let idx = 2;

      if (dataInicio) { q += ` AND ap.created_at::date >= $${idx++}`; p.push(dataInicio); }
      if (dataFim)    { q += ` AND ap.created_at::date <= $${idx++}`; p.push(dataFim); }
      if (!temFiltroData) q += ` AND ap.created_at >= CURRENT_DATE - INTERVAL '9 days'`;

      q += ` GROUP BY DATE(ap.created_at AT TIME ZONE 'America/Sao_Paulo') ORDER BY data ASC`;
      alugueisRows = (await pool.query(q, p)).rows;
    }

    const mapaVendas = Object.fromEntries(
      vendasRows.map((r) => [r.data.toISOString().slice(0, 10), Number(r.valor)])
    );
    const mapaAlugueis = Object.fromEntries(
      alugueisRows.map((r) => [r.data.toISOString().slice(0, 10), Number(r.valor)])
    );

    const todasDatas = [
      ...new Set([...Object.keys(mapaVendas), ...Object.keys(mapaAlugueis)]),
    ].sort();

    const dados = todasDatas.map((data) => ({
      data,
      vendas:   mapaVendas[data]   ?? 0,
      alugueis: mapaAlugueis[data] ?? 0,
      total: Number(((mapaVendas[data] ?? 0) + (mapaAlugueis[data] ?? 0)).toFixed(2)),
    }));

    res.json(dados);
  } catch (err) {
    console.error("[receitaUltimosDias]", err);
    res.status(500).json({ error: "Erro ao buscar receita dos últimos dias." });
  }
};

// ─── entradasUltimosDias ──────────────────────────────────────────────────────

const entradasUltimosDias = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  try {
    const result = await pool.query(
      `SELECT DATE(data_entrada) AS data_entrada, SUM(quantidade) AS quantidade
       FROM entrada WHERE cliente_id = $1
       GROUP BY DATE(data_entrada)
       ORDER BY DATE(data_entrada) DESC LIMIT 10`,
      [cliente_id],
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar entradas" });
  }
};

// ─── vendasUltimosDias ────────────────────────────────────────────────────────

const vendasUltimosDias = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  try {
    const result = await pool.query(
      `SELECT DATE(criado_em) AS data_criacao, SUM(valor_total) AS valor_total
       FROM venda WHERE cliente_id = $1
       GROUP BY DATE(criado_em)
       ORDER BY DATE(criado_em) DESC LIMIT 10`,
      [cliente_id],
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar vendas" });
  }
};

// ─── relatorioVendas ──────────────────────────────────────────────────────────

const relatorioVendas = async (req, res) => {
  const { cliente_id } = req.user;
  const { dataInicio, dataFim, produto_id, forma_pagamento } = req.query;

  try {
    let query = `
      SELECT v.id as venda_id, v.criado_em AS data_criacao, v.forma_pagamento,
             v.valor_total, v.valor_pago, v.troco, v.desconto,
             vi.produto_id, p.nome as produto_nome, vi.quantidade,
             vi.valor_unitario as preco_custo, vi.valor_total as valor_item
      FROM venda v
      JOIN venda_item vi ON vi.venda_id = v.id
      JOIN produto p ON p.id = vi.produto_id
      WHERE v.cliente_id = $1
    `;
    const params = [cliente_id];
    let idx = 2;

    if (dataInicio) { query += ` AND v.criado_em::date >= $${idx++}`; params.push(dataInicio); }
    if (dataFim)    { query += ` AND v.criado_em::date <= $${idx++}`; params.push(dataFim); }
    if (produto_id && produto_id !== "") { query += ` AND vi.produto_id = $${idx++}`; params.push(produto_id); }
    if (forma_pagamento && forma_pagamento !== "") {
      query += ` AND v.forma_pagamento ILIKE $${idx++}`;
      params.push(`%${forma_pagamento}%`);
    }

    query += " ORDER BY v.criado_em DESC";

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao gerar relatório de vendas." });
  }
};

// ─── relatorioResumo ──────────────────────────────────────────────────────────

const relatorioResumo = async (req, res) => {
  const { cliente_id } = req.user;
  const { dataInicio, dataFim, forma_pagamento } = req.query;

  try {
    let query = `
      SELECT v.forma_pagamento,
             COUNT(DISTINCT v.id) AS total_vendas,
             COALESCE(SUM(vi.valor_total), 0) AS total_valor
      FROM venda v
      JOIN venda_item vi ON vi.venda_id = v.id
      WHERE v.cliente_id = $1
    `;
    const params = [cliente_id];
    let idx = 2;

    if (dataInicio) { query += ` AND v.criado_em::date >= $${idx++}`; params.push(dataInicio); }
    if (dataFim)    { query += ` AND v.criado_em::date <= $${idx++}`; params.push(dataFim); }
    if (forma_pagamento && forma_pagamento !== "") {
      query += ` AND v.forma_pagamento ILIKE $${idx++}`;
      params.push(`%${forma_pagamento}%`);
    }

    query += " GROUP BY v.forma_pagamento ORDER BY total_valor DESC";

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao gerar resumo." });
  }
};

// ─── Exports ──────────────────────────────────────────────────────────────────

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
  relatorioResumo,
};