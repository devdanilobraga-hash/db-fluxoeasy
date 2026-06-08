const pool = require("../db");

// Helper: formata datas para intervalo
const buildDateFilter = (query, alias = "data") => {
  const { dataInicio, dataFim } = query;
  let sql = "";
  const params = [];
  if (dataInicio) {
    sql += ` AND ${alias}::date >= $${params.length + 1}`;
    params.push(dataInicio);
  }
  if (dataFim) {
    sql += ` AND ${alias}::date <= $${params.length + 1}`;
    params.push(dataFim);
  }
  return { sql, params };
};

/**
 * GET /api/faturamento/resumo
 * Query: dataInicio, dataFim, forma_pagamento (opcional, só vendas)
 */
const resumoFaturamento = async (req, res) => {
  const { cliente_id } = req.user;
  const { dataInicio, dataFim, forma_pagamento } = req.query;

  // 1. Receita de vendas + custo das vendas (usando custo_unitario se existir, senão preco_custo atual)
  let vendasQuery = `
    SELECT 
      COALESCE(SUM(v.valor_total), 0) AS receita_vendas,
      COALESCE(SUM(vi.quantidade * COALESCE(vi.custo_unitario, p.preco_custo)), 0) AS custo_vendas
    FROM venda v
    JOIN venda_item vi ON v.id = vi.venda_id
    JOIN produto p ON vi.produto_id = p.id
    WHERE v.cliente_id = $1
  `;
  const params = [cliente_id];
  let idx = 2;

  if (dataInicio) {
    vendasQuery += ` AND v.criado_em::date >= $${idx++}`;
    params.push(dataInicio);
  }
  if (dataFim) {
    vendasQuery += ` AND v.criado_em::date <= $${idx++}`;
    params.push(dataFim);
  }
  if (forma_pagamento) {
    vendasQuery += ` AND v.forma_pagamento ILIKE $${idx++}`;
    params.push(`%${forma_pagamento}%`);
  }

  const vendasRes = await pool.query(vendasQuery, params);
  const receitaVendas = Number(vendasRes.rows[0].receita_vendas);
  const custoVendas = Number(vendasRes.rows[0].custo_vendas);

  // 2. Receita de aluguéis (pagamentos efetivamente recebidos)
  let alugueisQuery = `
    SELECT COALESCE(SUM(ap.valor), 0) AS receita_alugueis
    FROM aluguel_pagamento ap
    JOIN aluguel a ON a.id = ap.aluguel_id
    WHERE a.cliente_id = $1
  `;
  const alugParams = [cliente_id];
  let aidx = 2;
  if (dataInicio) {
    alugueisQuery += ` AND ap.created_at::date >= $${aidx++}`;
    alugParams.push(dataInicio);
  }
  if (dataFim) {
    alugueisQuery += ` AND ap.created_at::date <= $${aidx++}`;
    alugParams.push(dataFim);
  }
  const alugueisRes = await pool.query(alugueisQuery, alugParams);
  const receitaAlugueis = Number(alugueisRes.rows[0].receita_alugueis);

  const receitaTotal = receitaVendas + receitaAlugueis;
  const custoTotal = custoVendas;  // aluguéis não têm custo de produto (apenas mão de obra, se houver)
  const lucroBruto = receitaTotal - custoTotal;
  const margem = receitaTotal === 0 ? 0 : (lucroBruto / receitaTotal) * 100;

  res.json({
    receita_vendas: receitaVendas,
    receita_alugueis: receitaAlugueis,
    receita_total: receitaTotal,
    custo_total: custoTotal,
    lucro_bruto: lucroBruto,
    margem: margem,
  });
};

/**
 * GET /api/faturamento/evolucao
 * Retorna série temporal (dia) com receita, custo, lucro e margem
 */
const evolucaoFaturamento = async (req, res) => {
  const { cliente_id } = req.user;
  const { dataInicio, dataFim, agrupamento = "day" } = req.query; // day | month

  // Define o formato de agrupamento
  const groupFormat = agrupamento === "month" 
    ? "DATE_TRUNC('month', data_ref)" 
    : "data_ref::date";
  const labelFormat = agrupamento === "month"
    ? "TO_CHAR(data_ref, 'YYYY-MM')"
    : "TO_CHAR(data_ref, 'YYYY-MM-DD')";

  // Subconsulta unificando vendas e aluguéis por dia
  const query = `
    WITH dias AS (
      SELECT generate_series(
        COALESCE($1::date, CURRENT_DATE - INTERVAL '30 days'),
        COALESCE($2::date, CURRENT_DATE),
        '1 day'::interval
      )::date AS dia
    ),
    vendas_dia AS (
      SELECT 
        v.criado_em::date AS data,
        SUM(v.valor_total) AS receita,
        SUM(vi.quantidade * COALESCE(vi.custo_unitario, p.preco_custo)) AS custo
      FROM venda v
      JOIN venda_item vi ON v.id = vi.venda_id
      JOIN produto p ON vi.produto_id = p.id
      WHERE v.cliente_id = $3
      GROUP BY v.criado_em::date
    ),
    alugueis_dia AS (
      SELECT 
        ap.created_at::date AS data,
        SUM(ap.valor) AS receita
      FROM aluguel_pagamento ap
      JOIN aluguel a ON a.id = ap.aluguel_id
      WHERE a.cliente_id = $3
      GROUP BY ap.created_at::date
    )
    SELECT 
      dias.dia,
      COALESCE(v.receita, 0) + COALESCE(a.receita, 0) AS receita_total,
      COALESCE(v.custo, 0) AS custo_total,
      (COALESCE(v.receita, 0) + COALESCE(a.receita, 0)) - COALESCE(v.custo, 0) AS lucro_bruto
    FROM dias
    LEFT JOIN vendas_dia v ON v.data = dias.dia
    LEFT JOIN alugueis_dia a ON a.data = dias.dia
    ORDER BY dias.dia
  `;

  const params = [
    dataInicio || null,
    dataFim || null,
    cliente_id
  ];
  const result = await pool.query(query, params);
  
  // Agrupa se for mensal
  const dados = result.rows.map(row => ({
    periodo: agrupamento === "month" 
      ? row.dia.toISOString().slice(0, 7) 
      : row.dia.toISOString().slice(0, 10),
    receita: Number(row.receita_total),
    custo: Number(row.custo_total),
    lucro: Number(row.lucro_bruto),
    margem: row.receita_total === 0 ? 0 : (row.lucro_bruto / row.receita_total) * 100
  }));

  // Se agrupamento mensal, agregar
  if (agrupamento === "month") {
    const meses = {};
    for (const d of dados) {
      if (!meses[d.periodo]) meses[d.periodo] = { receita: 0, custo: 0, lucro: 0 };
      meses[d.periodo].receita += d.receita;
      meses[d.periodo].custo += d.custo;
      meses[d.periodo].lucro += d.lucro;
    }
    const resultado = Object.entries(meses).map(([periodo, vals]) => ({
      periodo,
      receita: vals.receita,
      custo: vals.custo,
      lucro: vals.lucro,
      margem: vals.receita === 0 ? 0 : (vals.lucro / vals.receita) * 100
    }));
    return res.json(resultado);
  }

  res.json(dados);
};

/**
 * GET /api/faturamento/detalhes
 * Lista transações (vendas e pagamentos de aluguel) com suas respectivas receitas e custos
 * Query: dataInicio, dataFim, tipo (venda|aluguel|todos), limite, pagina
 */
const detalhesFaturamento = async (req, res) => {
  const { cliente_id } = req.user;
  const { dataInicio, dataFim, tipo = "todos", limite = 100, pagina = 1 } = req.query;
  const offset = (pagina - 1) * limite;

  const vendasSQL = `
    SELECT 
      v.id AS referencia_id,
      'venda' AS tipo,
      v.criado_em AS data,
      v.valor_total AS receita,
      SUM(vi.quantidade * COALESCE(vi.custo_unitario, p.preco_custo)) AS custo,
      v.forma_pagamento AS pagamento,
      (SELECT STRING_AGG(DISTINCT p2.nome, ', ') FROM venda_item vi2 JOIN produto p2 ON vi2.produto_id = p2.id WHERE vi2.venda_id = v.id) AS descricao
    FROM venda v
    JOIN venda_item vi ON v.id = vi.venda_id
    JOIN produto p ON vi.produto_id = p.id
    WHERE v.cliente_id = $1
    ${dataInicio ? "AND v.criado_em::date >= $2" : ""}
    ${dataFim ? `AND v.criado_em::date <= $${dataInicio ? 3 : 2}` : ""}
    GROUP BY v.id, v.criado_em, v.valor_total, v.forma_pagamento
  `;

  const alugueisSQL = `
    SELECT 
      a.id AS referencia_id,
      'aluguel' AS tipo,
      ap.created_at AS data,
      ap.valor AS receita,
      0 AS custo,
      'Aluguel' AS pagamento,
      CONCAT('Aluguel #', a.id, ' - ', COALESCE(a.locatario_nome, 'sem locatário')) AS descricao
    FROM aluguel_pagamento ap
    JOIN aluguel a ON a.id = ap.aluguel_id
    WHERE a.cliente_id = $1
    ${dataInicio ? "AND ap.created_at::date >= $2" : ""}
    ${dataFim ? `AND ap.created_at::date <= $${dataInicio ? 3 : 2}` : ""}
  `;

  let finalSQL = "";
  const params = [cliente_id];
  let idx = 2;

  if (dataInicio) params.push(dataInicio);
  if (dataFim) params.push(dataFim);

  if (tipo === "venda") {
    finalSQL = vendasSQL;
  } else if (tipo === "aluguel") {
    finalSQL = alugueisSQL;
  } else {
    finalSQL = `(${vendasSQL}) UNION ALL (${alugueisSQL})`;
  }

  finalSQL += ` ORDER BY data DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limite, offset);

  const result = await pool.query(finalSQL, params);
  const rows = result.rows.map(r => ({
    ...r,
    receita: Number(r.receita),
    custo: Number(r.custo),
    lucro: Number(r.receita) - Number(r.custo),
    data: r.data
  }));

  res.json(rows);
};

// dentro do mesmo arquivo, adicione:

const faturamentoCompleto = async (req, res) => {
  const { cliente_id } = req.user;
  const { dataInicio, dataFim } = req.query;

  // 1. Receita de vendas e custo direto
  const vendasQuery = `
    SELECT 
      COALESCE(SUM(v.valor_total), 0) AS receita_vendas,
      COALESCE(SUM(vi.quantidade * vi.custo_unitario), 0) AS custo_vendas
    FROM venda v
    JOIN venda_item vi ON v.id = vi.venda_id
    WHERE v.cliente_id = $1
    ${dataInicio ? "AND v.criado_em::date >= $2" : ""}
    ${dataFim ? `AND v.criado_em::date <= $${dataInicio ? 3 : 2}` : ""}
  `;
  const params = [cliente_id];
  if (dataInicio) params.push(dataInicio);
  if (dataFim) params.push(dataFim);
  const vendasRes = await pool.query(vendasQuery, params);

  // 2. Receita de aluguéis
  const alugueisQuery = `
    SELECT COALESCE(SUM(ap.valor), 0) AS receita_alugueis
    FROM aluguel_pagamento ap
    JOIN aluguel a ON a.id = ap.aluguel_id
    WHERE a.cliente_id = $1
    ${dataInicio ? "AND ap.created_at::date >= $2" : ""}
    ${dataFim ? `AND ap.created_at::date <= $${dataInicio ? 3 : 2}` : ""}
  `;
  const alugRes = await pool.query(alugueisQuery, params);
  const receitaAlugueis = Number(alugRes.rows[0].receita_alugueis);

  // 3. Despesas operacionais (considera despesas pagas ou vencidas no período)
  let despesasQuery = `
    SELECT COALESCE(SUM(valor), 0) AS total_despesas
    FROM despesa
    WHERE cliente_id = $1 AND status = 'pago'
    ${dataInicio ? "AND data_pagamento::date >= $2" : ""}
    ${dataFim ? `AND data_pagamento::date <= $${dataInicio ? 3 : 2}` : ""}
  `;
  const despesasRes = await pool.query(despesasQuery, params);
  const totalDespesas = Number(despesasRes.rows[0].total_despesas);

  const receitaVendas = Number(vendasRes.rows[0].receita_vendas);
  const custoVendas = Number(vendasRes.rows[0].custo_vendas);
  const receitaTotal = receitaVendas + receitaAlugueis;
  const lucroBruto = receitaTotal - custoVendas;
  const lucroLiquido = lucroBruto - totalDespesas;
  const margemBruta = receitaTotal === 0 ? 0 : (lucroBruto / receitaTotal) * 100;
  const margemLiquida = receitaTotal === 0 ? 0 : (lucroLiquido / receitaTotal) * 100;

  res.json({
    periodo: { dataInicio: dataInicio || null, dataFim: dataFim || null },
    receita_vendas: receitaVendas,
    receita_alugueis: receitaAlugueis,
    receita_total: receitaTotal,
    custo_produtos: custoVendas,
    despesas_operacionais: totalDespesas,
    lucro_bruto: lucroBruto,
    lucro_liquido: lucroLiquido,
    margem_bruta: margemBruta,
    margem_liquida: margemLiquida,
  });
};

const despesasPorCategoria = async (req, res) => {
  const { cliente_id } = req.user;
  const { dataInicio, dataFim } = req.query;
  let query = `
    SELECT categoria, COALESCE(SUM(valor), 0) AS total
    FROM despesa
    WHERE cliente_id = $1 AND status = 'pago'
  `;
  const params = [cliente_id];
  let idx = 2;
  if (dataInicio) {
    query += ` AND data_pagamento::date >= $${idx++}`;
    params.push(dataInicio);
  }
  if (dataFim) {
    query += ` AND data_pagamento::date <= $${idx++}`;
    params.push(dataFim);
  }
  query += ` GROUP BY categoria ORDER BY total DESC`;
  const result = await pool.query(query, params);
  res.json(result.rows);
};

module.exports = {despesasPorCategoria, faturamentoCompleto, resumoFaturamento, evolucaoFaturamento, detalhesFaturamento };