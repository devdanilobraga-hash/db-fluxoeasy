const  pool  = require('../db');

const criarVenda = async (req, res) => {
  const { cliente_id } = req.user;
  const { itens, forma_pagamento, valor_pago, desconto } = req.body;

  if (!itens || itens.length === 0) {
    return res.status(400).json({ error: "Nenhum item para venda." });
  }

  try {
    let valor_total = 0;
    const vendaItens = [];

    for (let item of itens) {
      const { produto_id, quantidade } = item;

      // Verifica se existe no estoque
      const estoque = await pool.query(
        `SELECT id, quantidade, valor_venda FROM estoque WHERE produto_id=$1 AND cliente_id=$2 AND quantidade > 0 ORDER BY data_validade ASC LIMIT 1`,
        [produto_id, cliente_id]
      );

      if (estoque.rows.length === 0) {
        return res.status(400).json({ error: `Produto ${produto_id} não consta no estoque.` });
      }

      const lote = estoque.rows[0];

      if (!lote.valor_venda) {
        return res.status(400).json({ error: `Produto ${produto_id} ainda não possui preço de venda.` });
      }

      if (quantidade > lote.quantidade) {
        return res.status(400).json({ error: `Quantidade solicitada do produto ${produto_id} excede estoque disponível.` });
      }

      const valor_item = lote.valor_venda * quantidade;
      valor_total += valor_item;

      vendaItens.push({
        estoque_id: lote.id,
        produto_id,
        quantidade,
        valor_unitario: lote.valor_venda,
        valor_total: valor_item
      });
    }

    valor_total = valor_total - (desconto || 0);
    const troco = (valor_pago || 0) - valor_total;

    // Cria a venda
    const vendaResult = await pool.query(
      `INSERT INTO venda (cliente_id, forma_pagamento, valor_total, valor_pago, troco, desconto)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [cliente_id, forma_pagamento, valor_total, valor_pago || 0, troco, desconto || 0]
    );

    const vendaId = vendaResult.rows[0].id;

    // Cria os itens da venda e atualiza estoque
    for (let item of vendaItens) {
      await pool.query(
        `INSERT INTO venda_item (venda_id, produto_id, quantidade, valor_unitario, valor_total)
         VALUES ($1,$2,$3,$4,$5)`,
        [vendaId, item.produto_id, item.quantidade, item.valor_unitario, item.valor_total]
      );

      // Remove do estoque
      await pool.query(
        `UPDATE estoque SET quantidade = quantidade - $1, data_atualizacao =CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo' WHERE id = $2`,
        [item.quantidade, item.estoque_id]
      );
    }

    res.json({ venda: vendaResult.rows[0], itens: vendaItens });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao processar venda." });
  }
};

module.exports = { criarVenda };
