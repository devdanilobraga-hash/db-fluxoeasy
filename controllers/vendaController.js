const pool = require("../db");

/**
 * criarVenda
 *
 * Agora suporta:
 * produto  -> valida estoque / desconta estoque
 * servico  -> busca na tabela produto / NÃO usa estoque
 *
 * Front precisa enviar:
 * itens: [
 *   { produto_id, quantidade, tipo }
 * ]
 */

const criarVenda = async (req, res) => {
  const { cliente_id } = req.user;
  const { itens, pagamentos, forma_pagamento, valor_pago, desconto } = req.body;

  if (!itens || itens.length === 0) {
    return res.status(400).json({ error: "Nenhum item para venda." });
  }

  /* =========================================================
     PAGAMENTOS
  ========================================================= */

  let pgtos =
    Array.isArray(pagamentos) && pagamentos.length > 0
      ? pagamentos
      : null;

  if (!pgtos) {
    if (forma_pagamento && valor_pago) {
      pgtos = [
        {
          forma: forma_pagamento,
          valor: Number(valor_pago),
        },
      ];
    } else {
      return res.status(400).json({
        error: "Nenhum pagamento informado.",
      });
    }
  }

  const FORMAS_VALIDAS = [
    "Dinheiro",
    "Cartão Crédito",
    "Cartão Débito",
    "Pix",
  ];

  for (const p of pgtos) {
    if (!FORMAS_VALIDAS.includes(p.forma)) {
      return res.status(400).json({
        error: `Forma inválida: ${p.forma}`,
      });
    }

    if (!p.valor || Number(p.valor) <= 0) {
      return res.status(400).json({
        error: `Valor inválido para ${p.forma}`,
      });
    }
  }

  const descontoVal = Number(desconto) || 0;

  const totalPago = Number(
    pgtos.reduce((acc, p) => acc + Number(p.valor), 0).toFixed(2)
  );

  const formaPrincipal = [
    ...new Set(pgtos.map((p) => p.forma)),
  ].join(" + ");

  /* =========================================================
     TABELA venda_pagamento EXISTE?
  ========================================================= */

  let tabelaPgtoExiste = false;

  try {
    const chk = await pool.query(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema='public'
        AND table_name='venda_pagamento'
      ) AS existe
    `);

    tabelaPgtoExiste = chk.rows[0].existe === true;
  } catch (_) {}

  /* =========================================================
     TRANSAÇÃO
  ========================================================= */

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    let valor_total = 0;
    const vendaItens = [];

    for (const item of itens) {
      const {
        produto_id,
        quantidade,
        tipo = "produto",
      } = item;

      const qtd = Number(quantidade);

      if (!qtd || qtd <= 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: "Quantidade inválida.",
        });
      }

      /* =====================================================
         SERVIÇO
      ===================================================== */
      if (tipo === "servico") {
        const servicoRes = await client.query(
          `
          SELECT id, nome, preco_custo, ativo
          FROM produto
          WHERE id = $1
            AND cliente_id = $2
            AND tipo = 'servico'
          LIMIT 1
          `,
          [produto_id, cliente_id]
        );

        if (servicoRes.rows.length === 0) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            error: `Serviço ${produto_id} não encontrado.`,
          });
        }

        const srv = servicoRes.rows[0];

        if (!srv.ativo) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            error: `Serviço ${srv.nome} está inativo.`,
          });
        }

        const valor_unitario = Number(srv.preco_custo || 0);

        if (valor_unitario <= 0) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            error: `Serviço ${srv.nome} sem preço.`,
          });
        }

        const valor_item = Number(
          (valor_unitario * qtd).toFixed(2)
        );

        valor_total += valor_item;

        vendaItens.push({
          tipo: "servico",
          estoque_id: null,
          produto_id,
          quantidade: qtd,
          valor_unitario,
          valor_total: valor_item,
        });

        continue;
      }

      /* =====================================================
         PRODUTO NORMAL
      ===================================================== */

      const estoqueRes = await client.query(
        `
        SELECT id, quantidade, valor_venda
        FROM estoque
        WHERE produto_id = $1
          AND cliente_id = $2
          AND quantidade > 0
        ORDER BY data_validade ASC
        LIMIT 1
        `,
        [produto_id, cliente_id]
      );

      if (estoqueRes.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: `Produto ${produto_id} sem estoque.`,
        });
      }

      const lote = estoqueRes.rows[0];

      if (qtd > Number(lote.quantidade)) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: `Produto ${produto_id}: solicitado ${qtd}, disponível ${lote.quantidade}.`,
        });
      }

      const valor_unitario = Number(lote.valor_venda || 0);

      if (valor_unitario <= 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: `Produto ${produto_id} sem preço.`,
        });
      }

      const valor_item = Number(
        (valor_unitario * qtd).toFixed(2)
      );

      valor_total += valor_item;

      vendaItens.push({
        tipo: "produto",
        estoque_id: lote.id,
        produto_id,
        quantidade: qtd,
        valor_unitario,
        valor_total: valor_item,
      });
    }

    /* =========================================================
       TOTAL
    ========================================================= */

    valor_total = Number(
      (valor_total - descontoVal).toFixed(2)
    );

    if (totalPago < valor_total) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        error: `Pago ${fmtBRL(totalPago)} menor que total ${fmtBRL(valor_total)}.`,
      });
    }

    const troco = Number(
      (totalPago - valor_total).toFixed(2)
    );

    /* =========================================================
       VENDA
    ========================================================= */

    const vendaResult = await client.query(
      `
      INSERT INTO venda
      (
        cliente_id,
        forma_pagamento,
        valor_total,
        valor_pago,
        troco,
        desconto
      )
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING *
      `,
      [
        cliente_id,
        formaPrincipal,
        valor_total,
        totalPago,
        troco,
        descontoVal,
      ]
    );

    const vendaId = vendaResult.rows[0].id;

    /* =========================================================
       ITENS
    ========================================================= */

    for (const item of vendaItens) {
      await client.query(
        `
        INSERT INTO venda_item
        (
          venda_id,
          produto_id,
          quantidade,
          valor_unitario,
          valor_total
        )
        VALUES ($1,$2,$3,$4,$5)
        `,
        [
          vendaId,
          item.produto_id,
          item.quantidade,
          item.valor_unitario,
          item.valor_total,
        ]
      );

      /* só produto baixa estoque */
      if (item.tipo === "produto") {
        await client.query(
          `
          UPDATE estoque
          SET quantidade = quantidade - $1,
              data_atualizacao = CURRENT_TIMESTAMP
          WHERE id = $2
          `,
          [item.quantidade, item.estoque_id]
        );
      }
    }

    /* =========================================================
       PAGAMENTOS
    ========================================================= */

    if (tabelaPgtoExiste) {
      for (const p of pgtos) {
        await client.query(
          `
          INSERT INTO venda_pagamento
          (venda_id, forma, valor)
          VALUES ($1,$2,$3)
          `,
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

    return res.status(500).json({
      error: err.message || "Erro ao processar venda.",
    });
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