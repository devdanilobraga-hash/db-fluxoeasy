const pool = require("../db");

/**
 * criarVenda
 *
 * Body esperado:
 *   itens:      [{ produto_id, quantidade }]
 *   pagamentos: [{ forma, valor }]   ← array (suporta múltiplos)
 *   desconto:   number (opcional, padrão 0)
 *
 * Pagamento misto (ex: R$50 Dinheiro + R$30 Cartão Crédito):
 *   - forma_pagamento na tabela venda = "Dinheiro + Cartão Crédito"
 *   - tabela venda_pagamento = uma linha por forma (se tabela existir)
 *   - valor_pago = soma total
 *   - troco = valor_pago - valor_total
 *
 * Tudo dentro de uma transação: se qualquer passo falhar, faz ROLLBACK.
 */
const criarVenda = async (req, res) => {
  const { cliente_id } = req.user;
  const { itens, pagamentos, forma_pagamento, valor_pago, desconto } = req.body;

  if (!itens || itens.length === 0) {
    return res.status(400).json({ error: "Nenhum item para venda." });
  }

  // ── Normaliza pagamentos ──────────────────────────────────────────────────
  let pgtos = Array.isArray(pagamentos) && pagamentos.length > 0
    ? pagamentos
    : null;

  // Retrocompatibilidade com formato antigo (campo único)
  if (!pgtos) {
    if (forma_pagamento && valor_pago) {
      pgtos = [{ forma: forma_pagamento, valor: Number(valor_pago) }];
    } else {
      return res.status(400).json({ error: "Nenhum pagamento informado." });
    }
  }

  // Formas aceitas — devem coincidir com o CHECK CONSTRAINT do banco
  const FORMAS_VALIDAS = ["Dinheiro", "Cartão Crédito", "Cartão Débito", "Pix"];

  for (const p of pgtos) {
    if (!p.forma || typeof p.forma !== "string" || p.forma.trim() === "") {
      return res.status(400).json({ error: "Forma de pagamento inválida ou ausente." });
    }
    if (!FORMAS_VALIDAS.includes(p.forma)) {
      return res.status(400).json({
        error: `Forma de pagamento inválida: '${p.forma}'. Aceitas: ${FORMAS_VALIDAS.join(", ")}.`,
      });
    }
    if (!p.valor || isNaN(p.valor) || Number(p.valor) <= 0) {
      return res.status(400).json({
        error: `Valor inválido para '${p.forma}'.`,
      });
    }
  }

  const descontoVal = Number(desconto) || 0;
  const totalPago   = Number(
    pgtos.reduce((acc, p) => acc + Number(p.valor), 0).toFixed(2)
  );

  // Resumo para coluna forma_pagamento (formas únicas, sem repetição)
  const formasUnicas   = [...new Set(pgtos.map((p) => p.forma))];
  const formaPrincipal = formasUnicas.join(" + ");

  // ── Verifica se a tabela venda_pagamento existe ───────────────────────────
  let tabelaPgtoExiste = false;
  try {
    const res2 = await pool.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name   = 'venda_pagamento'
      ) AS existe
    `);
    tabelaPgtoExiste = res2.rows[0].existe === true;
  } catch (_) {}

  // ── Transação ─────────────────────────────────────────────────────────────
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // ── Valida estoque e monta itens ─────────────────────────────────────────
    let valor_total = 0;
    const vendaItens = [];

    for (const item of itens) {
      const { produto_id, quantidade } = item;

      const estoqueRes = await client.query(
        `SELECT id, quantidade, valor_venda
         FROM estoque
         WHERE produto_id = $1
           AND cliente_id = $2
           AND quantidade > 0
         ORDER BY data_validade ASC
         LIMIT 1`,
        [produto_id, cliente_id]
      );

      if (estoqueRes.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: `Produto ${produto_id} não consta no estoque.`,
        });
      }

      const lote = estoqueRes.rows[0];

      if (!lote.valor_venda) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: `Produto ${produto_id} ainda não possui preço de venda.`,
        });
      }

      if (Number(quantidade) > Number(lote.quantidade)) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: `Produto ${produto_id}: solicitado ${quantidade} un, disponível ${lote.quantidade} un.`,
        });
      }

      const valor_item = Number(
        (Number(lote.valor_venda) * Number(quantidade)).toFixed(2)
      );
      valor_total += valor_item;

      vendaItens.push({
        estoque_id:     lote.id,
        produto_id,
        quantidade:     Number(quantidade),
        valor_unitario: Number(lote.valor_venda),
        valor_total:    valor_item,
      });
    }

    valor_total = Number((valor_total - descontoVal).toFixed(2));

    if (totalPago < valor_total) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: `Valor pago (${fmtBRL(totalPago)}) menor que o total da venda (${fmtBRL(valor_total)}).`,
      });
    }

    const troco = Number((totalPago - valor_total).toFixed(2));

    // ── Insere a venda ────────────────────────────────────────────────────
    const vendaResult = await client.query(
      `INSERT INTO venda
         (cliente_id, forma_pagamento, valor_total, valor_pago, troco, desconto)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [cliente_id, formaPrincipal, valor_total, totalPago, troco, descontoVal]
    );

    const vendaId = vendaResult.rows[0].id;

    // ── Insere itens e desconta estoque ───────────────────────────────────
    for (const item of vendaItens) {
      await client.query(
        `INSERT INTO venda_item
           (venda_id, produto_id, quantidade, valor_unitario, valor_total)
         VALUES ($1, $2, $3, $4, $5)`,
        [vendaId, item.produto_id, item.quantidade, item.valor_unitario, item.valor_total]
      );

      await client.query(
        `UPDATE estoque
         SET quantidade       = quantidade - $1,
             data_atualizacao = CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo'
         WHERE id = $2`,
        [item.quantidade, item.estoque_id]
      );
    }

    // ── Insere detalhes dos pagamentos (se tabela existir) ────────────────
    if (tabelaPgtoExiste) {
      for (const p of pgtos) {
        await client.query(
          `INSERT INTO venda_pagamento (venda_id, forma, valor)
           VALUES ($1, $2, $3)`,
          [vendaId, p.forma, Number(p.valor)]
        );
      }
    }

    await client.query("COMMIT");

    return res.json({
      venda:      vendaResult.rows[0],
      itens:      vendaItens,
      pagamentos: pgtos,
      troco,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[criarVenda] Erro:", err);
    return res.status(500).json({ error: err.message ?? "Erro ao processar venda." });
  } finally {
    client.release();
  }
};

const fmtBRL = (v) =>
  Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

module.exports = { criarVenda };