const pool = require("../db");

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtBRL = (v) =>
  Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Resolve produto_id → { nome, valor_unitario, tipo, em_estoque } */
const resolverItem = async (client, cliente_id, produto_id, quantidade) => {
  // 1. Tenta como produto/serviço/alugavel
  const prodRes = await client.query(
    `SELECT p.id, p.nome, p.preco_custo, p.tipo, p.ativo
     FROM produto p
     WHERE p.id = $1 AND p.cliente_id = $2`,
    [produto_id, cliente_id]
  );

  if (prodRes.rows.length === 0) {
    return {
      encontrado: false,
      aviso: `Produto ID ${produto_id} não encontrado ou não pertence a este cliente.`,
    };
  }

  const prod = prodRes.rows[0];

  if (!prod.ativo) {
    return {
      encontrado: false,
      aviso: `Produto "${prod.nome}" está inativo.`,
    };
  }

  // Serviço: sem estoque, apenas verifica existência
  if (prod.tipo === "servico") {
    return {
      encontrado: true,
      nome: prod.nome,
      valor_unitario: Number(prod.preco_custo || 0),
      tipo: "servico",
      em_estoque: true, // serviço sempre "disponível"
      aviso: null,
    };
  }

  // Produto / alugavel: verifica estoque
  const estoqueRes = await client.query(
    `SELECT COALESCE(SUM(quantidade), 0) AS total,
            MAX(valor_venda) AS valor_venda
     FROM estoque
     WHERE produto_id = $1 AND cliente_id = $2 AND quantidade > 0`,
    [produto_id, cliente_id]
  );

  const totalEstoque = Number(estoqueRes.rows[0]?.total || 0);
  const valorVenda   = Number(estoqueRes.rows[0]?.valor_venda || prod.preco_custo || 0);
  const temEstoque   = totalEstoque >= Number(quantidade);

  return {
    encontrado: true,
    nome: prod.nome,
    valor_unitario: valorVenda,
    tipo: prod.tipo,
    em_estoque: temEstoque,
    aviso: !temEstoque
      ? `Produto "${prod.nome}": solicitado ${quantidade}, disponível ${totalEstoque}.`
      : null,
  };
};

// ─── POST /orcamentos ─────────────────────────────────────────────────────────
// Cria orçamento com itens. Itens podem ter produto_id (resolve automaticamente)
// ou nome + valor_unitario livre (tipo "manual").
const criarOrcamento = async (req, res) => {
  const { cliente_id } = req.user;
  const {
    sub_cliente_id,
    itens,
    observacoes,
    footer_message,
    primary_color,
    desconto,
  } = req.body;

  if (!itens || itens.length === 0)
    return res.status(400).json({ error: "Informe ao menos um item." });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Valida sub_cliente (se informado)
    if (sub_cliente_id) {
      const scCheck = await client.query(
        `SELECT id FROM sub_cliente WHERE id=$1 AND cliente_id=$2 AND ativo=true`,
        [sub_cliente_id, cliente_id]
      );
      if (scCheck.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Sub-cliente inválido." });
      }
    }

    const descontoVal = Number(desconto) || 0;
    let valorTotal    = 0;
    const avisos      = [];
    const itensSalvar = [];

    for (const item of itens) {
      const qtd = Number(item.quantidade) || 1;

      // Item manual: sem produto_id, nome e preco informados diretamente
      if (!item.produto_id) {
        if (!item.nome?.trim())
          return res.status(400).json({ error: "Item manual precisa de nome." });

        const vu     = Number(item.valor_unitario) || 0;
        const vTotal = Number((vu * qtd).toFixed(2));
        valorTotal  += vTotal;

        itensSalvar.push({
          produto_id:     null,
          nome:           item.nome.trim(),
          quantidade:     qtd,
          valor_unitario: vu,
          valor_total:    vTotal,
          tipo:           "manual",
          em_estoque:     true,
        });
        continue;
      }

      // Item com produto_id
      const resolvido = await resolverItem(client, cliente_id, item.produto_id, qtd);

      if (!resolvido.encontrado) {
        avisos.push(resolvido.aviso);
        // Ainda inclui o item com valor 0 e flag de aviso para o frontend exibir
        itensSalvar.push({
          produto_id:     item.produto_id,
          nome:           item.nome || `ID ${item.produto_id}`,
          quantidade:     qtd,
          valor_unitario: 0,
          valor_total:    0,
          tipo:           item.tipo || "produto",
          em_estoque:     false,
        });
        continue;
      }

      if (resolvido.aviso) avisos.push(resolvido.aviso); // estoque insuficiente mas produto existe

      const vu     = Number(item.valor_unitario ?? resolvido.valor_unitario);
      const vTotal = Number((vu * qtd).toFixed(2));
      valorTotal  += vTotal;

      itensSalvar.push({
        produto_id:     item.produto_id,
        nome:           resolvido.nome,
        quantidade:     qtd,
        valor_unitario: vu,
        valor_total:    vTotal,
        tipo:           resolvido.tipo,
        em_estoque:     resolvido.em_estoque,
      });
    }

    valorTotal = Number((valorTotal - descontoVal).toFixed(2));

    // Insere orçamento
    const orcRes = await client.query(
      `INSERT INTO orcamento
         (cliente_id, sub_cliente_id, status, observacoes, footer_message,
          primary_color, desconto, valor_total)
       VALUES ($1,$2,'aberto',$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        cliente_id,
        sub_cliente_id || null,
        observacoes    || null,
        footer_message || null,
        primary_color  || "#1A56DB",
        descontoVal,
        valorTotal,
      ]
    );

    const orcamento = orcRes.rows[0];

    // Insere itens
    for (const it of itensSalvar) {
      await client.query(
        `INSERT INTO orcamento_item
           (orcamento_id, produto_id, nome, quantidade, valor_unitario, valor_total, tipo, em_estoque)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          orcamento.id,
          it.produto_id,
          it.nome,
          it.quantidade,
          it.valor_unitario,
          it.valor_total,
          it.tipo,
          it.em_estoque,
        ]
      );
    }

    await client.query("COMMIT");

    return res.status(201).json({
      orcamento: { ...orcamento, itens: itensSalvar },
      avisos, // lista de avisos de estoque/produto não encontrado
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[criarOrcamento]", err);
    return res.status(500).json({ error: "Erro ao criar orçamento." });
  } finally {
    client.release();
  }
};

// ─── GET /orcamentos ──────────────────────────────────────────────────────────
const listarOrcamentos = async (req, res) => {
  const { cliente_id } = req.user;
  const { status, sub_cliente_id } = req.query;

  try {
    const conditions = ["o.cliente_id = $1"];
    const values     = [cliente_id];
    let   idx        = 2;

    if (status) {
      conditions.push(`o.status = $${idx++}`);
      values.push(status);
    }

    if (sub_cliente_id) {
      conditions.push(`o.sub_cliente_id = $${idx++}`);
      values.push(sub_cliente_id);
    }

    const { rows } = await pool.query(
      `SELECT
         o.*,
         sc.nome AS sub_cliente_nome,
         (
           SELECT json_agg(
             json_build_object(
               'id',             oi.id,
               'produto_id',     oi.produto_id,
               'nome',           oi.nome,
               'quantidade',     oi.quantidade,
               'valor_unitario', oi.valor_unitario,
               'valor_total',    oi.valor_total,
               'tipo',           oi.tipo,
               'em_estoque',     oi.em_estoque
             )
           )
           FROM orcamento_item oi
           WHERE oi.orcamento_id = o.id
         ) AS itens
       FROM orcamento o
       LEFT JOIN sub_cliente sc ON sc.id = o.sub_cliente_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY o.criado_em DESC`,
      values
    );

    return res.json(rows);
  } catch (err) {
    console.error("[listarOrcamentos]", err);
    return res.status(500).json({ error: "Erro ao listar orçamentos." });
  }
};

// ─── GET /orcamentos/:id ──────────────────────────────────────────────────────
const getOrcamento = async (req, res) => {
  const { cliente_id } = req.user;
  const { id }         = req.params;

  try {
    const { rows } = await pool.query(
      `SELECT
         o.*,
         sc.nome  AS sub_cliente_nome,
         sc.email AS sub_cliente_email,
         sc.telefone AS sub_cliente_telefone,
         sc.cpf_cnpj AS sub_cliente_cpf_cnpj,
         sc.endereco AS sub_cliente_endereco,
         (
           SELECT json_agg(
             json_build_object(
               'id',             oi.id,
               'produto_id',     oi.produto_id,
               'nome',           oi.nome,
               'quantidade',     oi.quantidade,
               'valor_unitario', oi.valor_unitario,
               'valor_total',    oi.valor_total,
               'tipo',           oi.tipo,
               'em_estoque',     oi.em_estoque
             ) ORDER BY oi.id
           )
           FROM orcamento_item oi
           WHERE oi.orcamento_id = o.id
         ) AS itens
       FROM orcamento o
       LEFT JOIN sub_cliente sc ON sc.id = o.sub_cliente_id
       WHERE o.id = $1 AND o.cliente_id = $2`,
      [id, cliente_id]
    );

    if (rows.length === 0)
      return res.status(404).json({ error: "Orçamento não encontrado." });

    return res.json(rows[0]);
  } catch (err) {
    console.error("[getOrcamento]", err);
    return res.status(500).json({ error: "Erro ao buscar orçamento." });
  }
};

// ─── PUT /orcamentos/:id/status ───────────────────────────────────────────────
const atualizarStatus = async (req, res) => {
  const { cliente_id } = req.user;
  const { id }         = req.params;
  const { status }     = req.body;

  const VALIDOS = ["aberto", "aprovado", "recusado", "convertido"];
  if (!VALIDOS.includes(status))
    return res.status(400).json({ error: `Status inválido: ${status}` });

  try {
    const { rows } = await pool.query(
      `UPDATE orcamento
       SET status=$1, atualizado_em=NOW()
       WHERE id=$2 AND cliente_id=$3
       RETURNING *`,
      [status, id, cliente_id]
    );
    if (rows.length === 0)
      return res.status(404).json({ error: "Orçamento não encontrado." });

    return res.json(rows[0]);
  } catch (err) {
    console.error("[atualizarStatus]", err);
    return res.status(500).json({ error: "Erro ao atualizar status." });
  }
};

// ─── POST /orcamentos/:id/converter-venda ─────────────────────────────────────
// Converte orçamento em venda. Reutiliza a lógica de criarVenda.
// Recebe pagamentos no body, os itens vêm do próprio orçamento.
const converterEmVenda = async (req, res) => {
  const { cliente_id } = req.user;
  const { id }         = req.params;
  const { pagamentos } = req.body;

  if (!pagamentos || pagamentos.length === 0)
    return res.status(400).json({ error: "Informe ao menos um pagamento." });

  const FORMAS_VALIDAS = ["Dinheiro", "Cartão Crédito", "Cartão Débito", "Pix"];
  for (const p of pagamentos) {
    if (!FORMAS_VALIDAS.includes(p.forma))
      return res.status(400).json({ error: `Forma inválida: ${p.forma}` });
    if (!p.valor || Number(p.valor) <= 0)
      return res.status(400).json({ error: `Valor inválido para ${p.forma}` });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Busca orçamento + itens
    const orcRes = await client.query(
      `SELECT o.*, json_agg(
         json_build_object(
           'produto_id',     oi.produto_id,
           'nome',           oi.nome,
           'quantidade',     oi.quantidade,
           'valor_unitario', oi.valor_unitario,
           'valor_total',    oi.valor_total,
           'tipo',           oi.tipo,
           'em_estoque',     oi.em_estoque
         )
       ) AS itens
       FROM orcamento o
       JOIN orcamento_item oi ON oi.orcamento_id = o.id
       WHERE o.id=$1 AND o.cliente_id=$2
       GROUP BY o.id`,
      [id, cliente_id]
    );

    if (orcRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Orçamento não encontrado." });
    }

    const orc = orcRes.rows[0];

    if (orc.status === "convertido") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Orçamento já foi convertido em venda." });
    }

    // Verifica estoque de cada item antes de processar
    const avisos = [];
    const vendaItens = [];

    for (const item of orc.itens) {
      const qtd = Number(item.quantidade);

      // Itens manuais ou serviços: incluir direto, sem baixar estoque
      if (item.tipo === "manual" || item.tipo === "servico") {
        vendaItens.push({ ...item, estoque_id: null });
        continue;
      }

      // Produto com produto_id: valida estoque
      if (!item.produto_id) {
        avisos.push(`Item "${item.nome}" sem produto vinculado — ignorado na venda.`);
        continue;
      }

      const estoqueRes = await client.query(
        `SELECT id, quantidade, valor_venda
         FROM estoque
         WHERE produto_id=$1 AND cliente_id=$2 AND quantidade > 0
         ORDER BY data_validade ASC
         LIMIT 1`,
        [item.produto_id, cliente_id]
      );

      if (estoqueRes.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: `Produto "${item.nome}" sem estoque disponível. Não é possível converter.`,
        });
      }

      const lote = estoqueRes.rows[0];

      if (qtd > Number(lote.quantidade)) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: `Produto "${item.nome}": solicitado ${qtd}, disponível ${lote.quantidade}.`,
        });
      }

      vendaItens.push({ ...item, estoque_id: lote.id });
    }

    // Totais
    const totalPago = Number(
      pagamentos.reduce((acc, p) => acc + Number(p.valor), 0).toFixed(2)
    );
    const valorTotal = Number(orc.valor_total);

    if (totalPago < valorTotal) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: `Pago ${fmtBRL(totalPago)} menor que total ${fmtBRL(valorTotal)}.`,
      });
    }

    const troco         = Number((totalPago - valorTotal).toFixed(2));
    const formaPrincipal = [...new Set(pagamentos.map((p) => p.forma))].join(" + ");

    // Cria venda
    const vendaRes = await client.query(
      `INSERT INTO venda
         (cliente_id, sub_cliente_id, orcamento_id, forma_pagamento,
          valor_total, valor_pago, troco, desconto)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        cliente_id,
        orc.sub_cliente_id || null,
        orc.id,
        formaPrincipal,
        valorTotal,
        totalPago,
        troco,
        Number(orc.desconto) || 0,
      ]
    );

    const vendaId = vendaRes.rows[0].id;

    // Insere itens da venda e baixa estoque
    for (const item of vendaItens) {
      await client.query(
        `INSERT INTO venda_item
           (venda_id, produto_id, quantidade, valor_unitario, valor_total)
         VALUES ($1,$2,$3,$4,$5)`,
        [
          vendaId,
          item.produto_id || null,
          item.quantidade,
          item.valor_unitario,
          item.valor_total,
        ]
      );

      // Só baixa estoque para produtos físicos
      if (item.tipo === "produto" && item.estoque_id) {
        await client.query(
          `UPDATE estoque
           SET quantidade = quantidade - $1,
               data_atualizacao = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [item.quantidade, item.estoque_id]
        );
      }
    }

    // Pagamentos (se tabela existir)
    const tabelaPgtoExiste = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema='public' AND table_name='venda_pagamento'
      ) AS existe
    `);

    if (tabelaPgtoExiste.rows[0].existe) {
      for (const p of pagamentos) {
        await client.query(
          `INSERT INTO venda_pagamento (venda_id, forma, valor) VALUES ($1,$2,$3)`,
          [vendaId, p.forma, Number(p.valor)]
        );
      }
    }

    // Marca orçamento como convertido
    await client.query(
      `UPDATE orcamento SET status='convertido', atualizado_em=NOW() WHERE id=$1`,
      [id]
    );

    await client.query("COMMIT");

    return res.json({
      venda: vendaRes.rows[0],
      troco,
      avisos,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[converterEmVenda]", err);
    return res.status(500).json({ error: err.message || "Erro ao converter orçamento." });
  } finally {
    client.release();
  }
};

// ─── PUT /orcamentos/:id ──────────────────────────────────────────────────────
// Edita um orçamento existente (não convertido).
// Substitui os itens completamente.
const editarOrcamento = async (req, res) => {
  const { cliente_id } = req.user;
  const { id }         = req.params;
  const {
    sub_cliente_id,
    itens,
    observacoes,
    footer_message,
    primary_color,
    desconto,
  } = req.body;

  if (!itens || itens.length === 0)
    return res.status(400).json({ error: "Informe ao menos um item." });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Verifica se orçamento existe, pertence ao cliente e não está convertido
    const orcCheck = await client.query(
      `SELECT id, status FROM orcamento WHERE id=$1 AND cliente_id=$2`,
      [id, cliente_id]
    );
    if (orcCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Orçamento não encontrado." });
    }
    if (orcCheck.rows[0].status === "convertido") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Orçamento convertido não pode ser editado." });
    }

    // Valida sub_cliente (se informado)
    if (sub_cliente_id) {
      const scCheck = await client.query(
        `SELECT id FROM sub_cliente WHERE id=$1 AND cliente_id=$2 AND ativo=true`,
        [sub_cliente_id, cliente_id]
      );
      if (scCheck.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Sub-cliente inválido." });
      }
    }

    const descontoVal = Number(desconto) || 0;
    let valorTotal    = 0;
    const avisos      = [];
    const itensSalvar = [];

    for (const item of itens) {
      const qtd = Number(item.quantidade) || 1;

      if (!item.produto_id) {
        if (!item.nome?.trim())
          return res.status(400).json({ error: "Item manual precisa de nome." });
        const vu     = Number(item.valor_unitario) || 0;
        const vTotal = Number((vu * qtd).toFixed(2));
        valorTotal  += vTotal;
        itensSalvar.push({
          produto_id: null, nome: item.nome.trim(), quantidade: qtd,
          valor_unitario: vu, valor_total: vTotal, tipo: "manual", em_estoque: true,
        });
        continue;
      }

      const resolvido = await resolverItem(client, cliente_id, item.produto_id, qtd);

      if (!resolvido.encontrado) {
        avisos.push(resolvido.aviso);
        itensSalvar.push({
          produto_id: item.produto_id, nome: item.nome || `ID ${item.produto_id}`,
          quantidade: qtd, valor_unitario: 0, valor_total: 0,
          tipo: item.tipo || "produto", em_estoque: false,
        });
        continue;
      }

      if (resolvido.aviso) avisos.push(resolvido.aviso);

      const vu     = Number(item.valor_unitario ?? resolvido.valor_unitario);
      const vTotal = Number((vu * qtd).toFixed(2));
      valorTotal  += vTotal;
      itensSalvar.push({
        produto_id: item.produto_id, nome: resolvido.nome, quantidade: qtd,
        valor_unitario: vu, valor_total: vTotal, tipo: resolvido.tipo,
        em_estoque: resolvido.em_estoque,
      });
    }

    valorTotal = Number((valorTotal - descontoVal).toFixed(2));

    // Atualiza orçamento
    const orcRes = await client.query(
      `UPDATE orcamento
       SET sub_cliente_id=$1, observacoes=$2, footer_message=$3,
           primary_color=$4, desconto=$5, valor_total=$6,
           status='aberto', atualizado_em=NOW()
       WHERE id=$7 AND cliente_id=$8
       RETURNING *`,
      [
        sub_cliente_id || null,
        observacoes    || null,
        footer_message || null,
        primary_color  || "#1A56DB",
        descontoVal,
        valorTotal,
        id,
        cliente_id,
      ]
    );

    // Apaga itens antigos e insere novos
    await client.query(`DELETE FROM orcamento_item WHERE orcamento_id=$1`, [id]);

    for (const it of itensSalvar) {
      await client.query(
        `INSERT INTO orcamento_item
           (orcamento_id, produto_id, nome, quantidade, valor_unitario, valor_total, tipo, em_estoque)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, it.produto_id, it.nome, it.quantidade, it.valor_unitario, it.valor_total, it.tipo, it.em_estoque]
      );
    }

    await client.query("COMMIT");

    return res.json({
      orcamento: { ...orcRes.rows[0], itens: itensSalvar },
      avisos,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[editarOrcamento]", err);
    return res.status(500).json({ error: "Erro ao editar orçamento." });
  } finally {
    client.release();
  }
};

// ─── DELETE /orcamentos/:id ───────────────────────────────────────────────────
const deletarOrcamento = async (req, res) => {
  const { cliente_id } = req.user;
  const { id }         = req.params;

  try {
    const { rows } = await pool.query(
      `DELETE FROM orcamento WHERE id=$1 AND cliente_id=$2 AND status != 'convertido' RETURNING id`,
      [id, cliente_id]
    );
    if (rows.length === 0)
      return res.status(404).json({
        error: "Orçamento não encontrado ou já convertido (não pode ser excluído).",
      });

    return res.json({ message: "Orçamento excluído." });
  } catch (err) {
    console.error("[deletarOrcamento]", err);
    return res.status(500).json({ error: "Erro ao excluir orçamento." });
  }
};

module.exports = {
  criarOrcamento,
  listarOrcamentos,
  getOrcamento,
  atualizarStatus,
  converterEmVenda,
  editarOrcamento,
  deletarOrcamento,
};