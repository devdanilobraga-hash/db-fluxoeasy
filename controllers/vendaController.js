const pool = require("../db");

/**
 * criarVenda
 * Suporta: produto, servico, sub_cliente_id
 */
const criarVenda = async (req, res) => {
  const { cliente_id, id: usuario_id } = req.user;
  const { itens, pagamentos, forma_pagamento, valor_pago, desconto, sub_cliente_id } = req.body;

  if (!itens || itens.length === 0)
    return res.status(400).json({ error: "Nenhum item para venda." });

  let pgtos = Array.isArray(pagamentos) && pagamentos.length > 0 ? pagamentos : null;
  if (!pgtos) {
    if (forma_pagamento && valor_pago) {
      pgtos = [{ forma: forma_pagamento, valor: Number(valor_pago) }];
    } else {
      return res.status(400).json({ error: "Nenhum pagamento informado." });
    }
  }

  const FORMAS_VALIDAS = ["Dinheiro", "Cartão Crédito", "Cartão Débito", "Pix"];
  for (const p of pgtos) {
    if (!FORMAS_VALIDAS.includes(p.forma))
      return res.status(400).json({ error: `Forma inválida: ${p.forma}` });
    if (!p.valor || Number(p.valor) <= 0)
      return res.status(400).json({ error: `Valor inválido para ${p.forma}` });
  }

  const descontoVal = Number(desconto) || 0;
  const totalPago = Number(pgtos.reduce((acc, p) => acc + Number(p.valor), 0).toFixed(2));
  const formaPrincipal = [...new Set(pgtos.map((p) => p.forma))].join(" + ");
  const subClienteId = sub_cliente_id || null;

  let tabelaPgtoExiste = false;
  try {
    const chk = await pool.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema='public' AND table_name='venda_pagamento'
      ) AS existe`);
    tabelaPgtoExiste = chk.rows[0].existe === true;
  } catch (_) {}

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let valor_total = 0;
    const vendaItens = [];

    for (const item of itens) {
      const { produto_id, quantidade, tipo = "produto" } = item;
      const qtd = Number(quantidade);
      if (!qtd || qtd <= 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Quantidade inválida." });
      }

      // ── Serviço ────────────────────────────────────────────────────────────
      if (tipo === "servico") {
        const srv = await client.query(
          `SELECT id, nome, preco_custo, ativo FROM produto
           WHERE id=$1 AND cliente_id=$2 AND tipo='servico' LIMIT 1`,
          [produto_id, cliente_id]
        );
        if (!srv.rows.length) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: `Serviço ${produto_id} não encontrado.` });
        }
        const s = srv.rows[0];
        if (!s.ativo) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: `Serviço ${s.nome} está inativo.` });
        }
        const vu = Number(s.preco_custo || 0);
        if (vu <= 0) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: `Serviço ${s.nome} sem preço.` });
        }
        const vi = Number((vu * qtd).toFixed(2));
        valor_total += vi;
        const custoUnitario = Number(s.preco_custo);
        vendaItens.push({
          tipo: "servico",
          estoque_id: null,
          produto_id,
          quantidade: qtd,
          valor_unitario: vu,
          valor_total: vi,
          custo_unitario: custoUnitario,
        });
        continue;
      }

      // ── Produto físico ─────────────────────────────────────────────────────
      const estoqueRes = await client.query(
        `SELECT id, quantidade, valor_venda, preco_custo FROM estoque
         WHERE produto_id=$1 AND cliente_id=$2 AND quantidade>0
         ORDER BY data_validade ASC LIMIT 1`,
        [produto_id, cliente_id]
      );
      if (!estoqueRes.rows.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: `Produto ${produto_id} sem estoque.` });
      }
      const lote = estoqueRes.rows[0];
      if (qtd > Number(lote.quantidade)) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: `Produto ${produto_id}: solicitado ${qtd}, disponível ${lote.quantidade}.`,
        });
      }
      const vu = Number(lote.valor_venda || 0);
      if (vu <= 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: `Produto ${produto_id} sem preço.` });
      }
      const vi = Number((vu * qtd).toFixed(2));
      valor_total += vi;
      const custoUnitario = Number(lote.preco_custo); // ✅ agora lote está definido
      vendaItens.push({
        tipo: "produto",
        estoque_id: lote.id,
        produto_id,
        quantidade: qtd,
        valor_unitario: vu,
        valor_total: vi,
        custo_unitario: custoUnitario,
      });
    }

    valor_total = Number((valor_total - descontoVal).toFixed(2));
    if (totalPago < valor_total) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: `Pago ${fmtBRL(totalPago)} menor que total ${fmtBRL(valor_total)}.`,
      });
    }

    const troco = Number((totalPago - valor_total).toFixed(2));

    if (subClienteId) {
      const scCheck = await client.query(
        `SELECT id FROM sub_cliente WHERE id=$1 AND cliente_id=$2 AND ativo=true`,
        [subClienteId, cliente_id]
      );
      if (!scCheck.rows.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Sub-cliente inválido." });
      }
    }

    const vendaResult = await client.query(
      `INSERT INTO venda (cliente_id, sub_cliente_id, usuario_id, forma_pagamento, valor_total, valor_pago, troco, desconto)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [cliente_id, subClienteId, usuario_id, formaPrincipal, valor_total, totalPago, troco, descontoVal]
    );
    const vendaId = vendaResult.rows[0].id;

    for (const item of vendaItens) {
      await client.query(
        `INSERT INTO venda_item (venda_id, produto_id, quantidade, valor_unitario, valor_total, custo_unitario)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [vendaId, item.produto_id, item.quantidade, item.valor_unitario, item.valor_total, item.custo_unitario]
      );
      if (item.tipo === "produto") {
        await client.query(
          `UPDATE estoque SET quantidade = quantidade - $1, data_atualizacao = CURRENT_TIMESTAMP WHERE id=$2`,
          [item.quantidade, item.estoque_id]
        );
      }
    }

    if (tabelaPgtoExiste) {
      for (const p of pgtos) {
        await client.query(
          `INSERT INTO venda_pagamento (venda_id, forma, valor) VALUES ($1,$2,$3)`,
          [vendaId, p.forma, Number(p.valor)]
        );
      }
    }

    await client.query("COMMIT");
    return res.json({
      venda: vendaResult.rows[0],
      itens: vendaItens,
      pagamentos: pgtos,
      troco,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[criarVenda]", err);
    return res.status(500).json({ error: err.message || "Erro ao processar venda." });
  } finally {
    client.release();
  }
};

const fmtBRL = (v) =>
  Number(v || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

module.exports = { criarVenda };
