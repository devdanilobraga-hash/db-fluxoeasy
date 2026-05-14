const pool = require("../db");

// ─── GET /vendas ──────────────────────────────────────────────────────────────
// Lista vendas do cliente com itens e pagamentos aninhados
const listarVendas = async (req, res) => {
  const { cliente_id, id: usuario_id, nivel_acesso } = req.user;
  const { limit = 50, offset = 0, data_inicio, data_fim } = req.query;

  // vendedor só vê as próprias vendas; admin/superadmin vê todas do cliente
  const isVendedor = nivel_acesso === "vendedor";

  try {
    const conditions = ["v.cliente_id = $1"];
    const values     = [cliente_id];
    let   idx        = 2;

    if (isVendedor) {
      conditions.push(`v.usuario_id = $${idx++}`);
      values.push(usuario_id);
    }

    if (data_inicio) {
      conditions.push(`v.criado_em >= $${idx++}`);
      values.push(data_inicio);
    }
    if (data_fim) {
      conditions.push(`v.criado_em <= $${idx++}`);
      values.push(data_fim);
    }

    values.push(Number(limit));
    values.push(Number(offset));

    const { rows } = await pool.query(
      `SELECT
         v.id,
         v.forma_pagamento,
         v.valor_total,
         v.valor_pago,
         v.troco,
         v.desconto,
         v.criado_em AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo' AS criado_em,
         v.orcamento_id,
         v.sub_cliente_id,
         sc.nome      AS sub_cliente_nome,
         sc.cpf_cnpj  AS sub_cliente_cpf_cnpj,
         sc.telefone  AS sub_cliente_telefone,
         sc.endereco  AS sub_cliente_endereco,
         v.usuario_id,
         u.nome       AS vendedor_nome,
         -- itens
         (
           SELECT json_agg(
             json_build_object(
               'produto_id',     vi.produto_id,
               'produto_nome',   p.nome,
               'quantidade',     vi.quantidade,
               'valor_unitario', vi.valor_unitario,
               'valor_total',    vi.valor_total
             ) ORDER BY vi.id
           )
           FROM venda_item vi
           LEFT JOIN produto p ON p.id = vi.produto_id
           WHERE vi.venda_id = v.id
         ) AS itens,
         -- pagamentos (se tabela existir, usa ela; senão usa forma_pagamento)
         (
           SELECT json_agg(
             json_build_object('forma', vp.forma, 'valor', vp.valor)
             ORDER BY vp.id
           )
           FROM venda_pagamento vp
           WHERE vp.venda_id = v.id
         ) AS pagamentos_detalhados
       FROM venda v
       LEFT JOIN sub_cliente sc ON sc.id = v.sub_cliente_id
       LEFT JOIN usuario u ON u.id = v.usuario_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY v.criado_em DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      values
    );

    // Total de registros para paginação
    // Usa apenas as conditions de filtro (sem limit/offset) e os valores correspondentes
    const countConditions = ["v.cliente_id = $1"];
    const countValues     = [cliente_id];
    let   countIdx        = 2;

    if (data_inicio) {
      countConditions.push(`v.criado_em >= $${countIdx++}`);
      countValues.push(data_inicio);
    }
    if (data_fim) {
      countConditions.push(`v.criado_em <= $${countIdx++}`);
      countValues.push(data_fim);
    }

    const countRes = await pool.query(
      `SELECT COUNT(*) AS total FROM venda v WHERE ${countConditions.join(" AND ")}`,
      countValues
    );

    return res.json({
      vendas: rows,
      total:  Number(countRes.rows[0].total),
    });
  } catch (err) {
    console.error("[listarVendas]", err);
    return res.status(500).json({ error: "Erro ao listar vendas." });
  }
};

// ─── GET /vendas/:id ──────────────────────────────────────────────────────────
const getVenda = async (req, res) => {
  const { cliente_id } = req.user;
  const { id }         = req.params;

  try {
    const { rows } = await pool.query(
      `SELECT
         v.*,
         sc.nome      AS sub_cliente_nome,
         sc.cpf_cnpj  AS sub_cliente_cpf_cnpj,
         sc.email     AS sub_cliente_email,
         sc.telefone  AS sub_cliente_telefone,
         sc.endereco  AS sub_cliente_endereco,
         (
           SELECT json_agg(
             json_build_object(
               'produto_id',     vi.produto_id,
               'produto_nome',   p.nome,
               'quantidade',     vi.quantidade,
               'valor_unitario', vi.valor_unitario,
               'valor_total',    vi.valor_total
             ) ORDER BY vi.id
           )
           FROM venda_item vi
           LEFT JOIN produto p ON p.id = vi.produto_id
           WHERE vi.venda_id = v.id
         ) AS itens,
         (
           SELECT json_agg(
             json_build_object('forma', vp.forma, 'valor', vp.valor)
             ORDER BY vp.id
           )
           FROM venda_pagamento vp
           WHERE vp.venda_id = v.id
         ) AS pagamentos_detalhados
       FROM venda v
       LEFT JOIN sub_cliente sc ON sc.id = v.sub_cliente_id
       WHERE v.id = $1 AND v.cliente_id = $2`,
      [id, cliente_id]
    );

    if (rows.length === 0)
      return res.status(404).json({ error: "Venda não encontrada." });

    return res.json(rows[0]);
  } catch (err) {
    console.error("[getVenda]", err);
    return res.status(500).json({ error: "Erro ao buscar venda." });
  }
};

module.exports = { listarVendas, getVenda };