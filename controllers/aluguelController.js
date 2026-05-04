const pool = require("../db");

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtBRL = (v) =>
  Number(v || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

const FORMAS_VALIDAS = ["Dinheiro", "Cartão Crédito", "Cartão Débito", "Pix"];

const TIPOS_PGTO = ["sinal", "parcela", "quitacao"];

// Calcula número de dias entre duas datas (mínimo 1)
const calcDias = (retirada, devolucao) => {
  const ms = new Date(devolucao) - new Date(retirada);
  const dias = Math.ceil(ms / (1000 * 60 * 60 * 24));
  return dias > 0 ? dias : 1;
};

// ─── 1. Criar aluguel ─────────────────────────────────────────────────────────
/**
 * POST /aluguel
 *
 * Body:
 * {
 *   locatario_nome, locatario_cpf, locatario_tel,
 *   locatario_email, locatario_end,          // todos opcionais
 *   data_retirada, data_devolucao,           // obrigatórios
 *   desconto,                                // opcional
 *   observacoes,                             // opcional
 *   itens: [{ produto_id, quantidade }],     // obrigatório
 *   pagamentos: [{ forma, valor, tipo }]     // opcional (pode pagar depois)
 * }
 */
const criarAluguel = async (req, res) => {
  const { cliente_id } = req.user;
  const usuario_id = req.user.id;

  const {
    locatario_nome,
    locatario_cpf,
    locatario_tel,
    locatario_email,
    locatario_end,
    data_retirada,
    data_devolucao,
    desconto,
    observacoes,
    itens,
    pagamentos,
  } = req.body;

  // ── Validações básicas ──
  if (!data_retirada || !data_devolucao) {
    return res.status(400).json({ error: "data_retirada e data_devolucao são obrigatórios." });
  }

  if (new Date(data_devolucao) <= new Date(data_retirada)) {
    return res.status(400).json({ error: "data_devolucao deve ser posterior a data_retirada." });
  }

  if (!itens || itens.length === 0) {
    return res.status(400).json({ error: "Nenhum item informado." });
  }

  const descontoVal = Number(desconto) || 0;
  const dias = calcDias(data_retirada, data_devolucao);

  // ── Validar pagamentos (se informados) ──
  const pgtos = Array.isArray(pagamentos) && pagamentos.length > 0 ? pagamentos : [];

  for (const p of pgtos) {
    if (!FORMAS_VALIDAS.includes(p.forma)) {
      return res.status(400).json({ error: `Forma inválida: ${p.forma}` });
    }
    if (!p.valor || Number(p.valor) <= 0) {
      return res.status(400).json({ error: `Valor inválido para ${p.forma}` });
    }
    if (p.tipo && !TIPOS_PGTO.includes(p.tipo)) {
      return res.status(400).json({ error: `Tipo de pagamento inválido: ${p.tipo}` });
    }
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // ── Processar itens ──
    let valor_total_itens = 0;
    const aluguelItens = [];

    for (const item of itens) {
      const { produto_id, quantidade } = item;
      const qtd = Number(quantidade);

      if (!qtd || qtd <= 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Quantidade inválida." });
      }

      // Busca produto alugável
      const prodRes = await client.query(
        `SELECT id, nome, valor_diaria, ativo, tipo
         FROM produto
         WHERE id = $1 AND cliente_id = $2 AND tipo = 'alugavel'
         LIMIT 1`,
        [produto_id, cliente_id]
      );

      if (prodRes.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: `Produto alugável ${produto_id} não encontrado.` });
      }

      const prod = prodRes.rows[0];

      if (!prod.ativo) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: `Item "${prod.nome}" está inativo.` });
      }

      const valor_unitario = Number(prod.valor_diaria || 0);

      if (valor_unitario <= 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: `Item "${prod.nome}" sem valor de diária cadastrado.` });
      }

      // Verificar conflito de disponibilidade no período
      const conflito = await client.query(
        `SELECT COALESCE(SUM(ai.quantidade), 0) AS qtd_ocupada
         FROM aluguel_item ai
         JOIN aluguel a ON a.id = ai.aluguel_id
         WHERE ai.produto_id = $1
           AND a.cliente_id  = $2
           AND a.status NOT IN ('devolvido', 'cancelado')
           AND a.data_retirada  < $4
           AND a.data_devolucao > $3`,
        [produto_id, cliente_id, data_retirada, data_devolucao]
      );

      // Estoque disponível para aluguel vem da tabela estoque
      const estoqueRes = await client.query(
        `SELECT COALESCE(SUM(quantidade), 0) AS total
         FROM estoque
         WHERE produto_id = $1 AND cliente_id = $2`,
        [produto_id, cliente_id]
      );

      const totalEstoque = Number(estoqueRes.rows[0].total);
      const qtdOcupada = Number(conflito.rows[0].qtd_ocupada);
      const disponivel = totalEstoque - qtdOcupada;

      if (qtd > disponivel) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: `"${prod.nome}": solicitado ${qtd}, disponível ${disponivel} no período.`,
        });
      }

      const valor_item = Number((valor_unitario * qtd * dias).toFixed(2));
      valor_total_itens += valor_item;

      aluguelItens.push({
        produto_id,
        quantidade: qtd,
        valor_unitario,
        dias,
        valor_total: valor_item,
      });
    }

    const valor_total = Number((valor_total_itens - descontoVal).toFixed(2));
    const valor_pago_inicial = Number(
      pgtos.reduce((acc, p) => acc + Number(p.valor), 0).toFixed(2)
    );

    if (valor_pago_inicial > valor_total) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: `Valor pago ${fmtBRL(valor_pago_inicial)} maior que total ${fmtBRL(valor_total)}.`,
      });
    }

    // ── Criar evento no calendário ──
    const tituloEvento = locatario_nome
      ? `Aluguel — ${locatario_nome}`
      : "Aluguel";

    const eventoRes = await client.query(
      `INSERT INTO calendario_evento
         (cliente_id, usuario_id, titulo, tipo, data_inicio, data_fim,
          dia_todo, status, cor, observacoes)
       VALUES ($1,$2,$3,'aluguel',$4,$5,false,'confirmado','#f59e0b',$6)
       RETURNING id`,
      [
        cliente_id,
        usuario_id,
        tituloEvento,
        data_retirada,
        data_devolucao,
        observacoes ?? null,
      ]
    );

    const evento_id = eventoRes.rows[0].id;

    // ── Inserir aluguel ──
    const aluguelRes = await client.query(
      `INSERT INTO aluguel
         (cliente_id, locatario_nome, locatario_cpf, locatario_tel,
          locatario_email, locatario_end, data_retirada, data_devolucao,
          valor_total, valor_pago, desconto, status, evento_id, observacoes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'reservado',$12,$13)
       RETURNING *`,
      [
        cliente_id,
        locatario_nome   || null,
        locatario_cpf    || null,
        locatario_tel    || null,
        locatario_email  || null,
        locatario_end    || null,
        data_retirada,
        data_devolucao,
        valor_total,
        valor_pago_inicial,
        descontoVal,
        evento_id,
        observacoes      || null,
      ]
    );

    const aluguelId = aluguelRes.rows[0].id;

    // ── Inserir itens ──
    for (const item of aluguelItens) {
      await client.query(
        `INSERT INTO aluguel_item
           (aluguel_id, produto_id, quantidade, valor_unitario, dias, valor_total)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [aluguelId, item.produto_id, item.quantidade, item.valor_unitario, item.dias, item.valor_total]
      );
    }

    // ── Inserir pagamentos iniciais ──
    for (const p of pgtos) {
      await client.query(
        `INSERT INTO aluguel_pagamento (aluguel_id, forma, valor, tipo, observacao)
         VALUES ($1,$2,$3,$4,$5)`,
        [aluguelId, p.forma, Number(p.valor), p.tipo || "sinal", p.observacao || null]
      );
    }

    await client.query("COMMIT");

    // ── Buscar registro completo para retornar ──
    const resultado = await _getAluguelCompleto(aluguelId, cliente_id);

    return res.status(201).json(resultado);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[criarAluguel]", err);
    return res.status(500).json({ error: err.message || "Erro ao criar aluguel." });
  } finally {
    client.release();
  }
};

// ─── 2. Listar aluguéis ───────────────────────────────────────────────────────
/**
 * GET /aluguel
 * Query params: status, inicio, fim, locatario
 */
const getAlugueis = async (req, res) => {
  const { cliente_id } = req.user;
  const { status, inicio, fim, locatario } = req.query;

  try {
    const conditions = ["a.cliente_id = $1"];
    const values = [cliente_id];
    let i = 2;

    if (status)    { conditions.push(`a.status = $${i++}`);                  values.push(status); }
    if (inicio)    { conditions.push(`a.data_retirada >= $${i++}`);           values.push(inicio); }
    if (fim)       { conditions.push(`a.data_devolucao <= $${i++}`);          values.push(fim); }
    if (locatario) { conditions.push(`a.locatario_nome ILIKE $${i++}`);       values.push(`%${locatario}%`); }

    const result = await pool.query(
      `SELECT
         a.*,
         (
           SELECT COALESCE(JSON_AGG(
             JSON_BUILD_OBJECT(
               'id', ai.id,
               'produto_id', ai.produto_id,
               'produto_nome', p.nome,
               'quantidade', ai.quantidade,
               'valor_unitario', ai.valor_unitario,
               'dias', ai.dias,
               'valor_total', ai.valor_total
             ) ORDER BY ai.id
           ), '[]')
           FROM aluguel_item ai
           JOIN produto p ON p.id = ai.produto_id
           WHERE ai.aluguel_id = a.id
         ) AS itens,
         (
           SELECT COALESCE(SUM(ap.valor), 0)
           FROM aluguel_pagamento ap
           WHERE ap.aluguel_id = a.id
         ) AS valor_pago_real
       FROM aluguel a
       WHERE ${conditions.join(" AND ")}
       ORDER BY a.data_retirada ASC`,
      values
    );

    return res.json(result.rows);
  } catch (err) {
    console.error("[getAlugueis]", err);
    return res.status(500).json({ error: "Erro ao buscar aluguéis." });
  }
};

// ─── 3. Buscar aluguel por ID ─────────────────────────────────────────────────
const getAluguelById = async (req, res) => {
  const { cliente_id } = req.user;
  const { id } = req.params;

  try {
    const result = await _getAluguelCompleto(id, cliente_id);
    if (!result) return res.status(404).json({ error: "Aluguel não encontrado." });
    return res.json(result);
  } catch (err) {
    console.error("[getAluguelById]", err);
    return res.status(500).json({ error: "Erro ao buscar aluguel." });
  }
};

// ─── 4. Atualizar dados do aluguel ────────────────────────────────────────────
/**
 * PUT /aluguel/:id
 * Permite editar dados do locatário, datas e observações
 * Não permite alterar valores diretamente (recalcula pelos itens)
 */
const updateAluguel = async (req, res) => {
  const { cliente_id } = req.user;
  const { id } = req.params;

  const {
    locatario_nome, locatario_cpf, locatario_tel,
    locatario_email, locatario_end,
    data_retirada, data_devolucao,
    desconto, observacoes,
  } = req.body;

  try {
    const { rows } = await pool.query(
      "SELECT * FROM aluguel WHERE id=$1 AND cliente_id=$2",
      [id, cliente_id]
    );

    if (rows.length === 0) return res.status(404).json({ error: "Aluguel não encontrado." });

    const atual = rows[0];

    if (["devolvido", "cancelado"].includes(atual.status)) {
      return res.status(400).json({ error: `Não é possível editar aluguel com status "${atual.status}".` });
    }

    const novaRetirada  = data_retirada  ?? atual.data_retirada;
    const novaDevolucao = data_devolucao ?? atual.data_devolucao;

    if (new Date(novaDevolucao) <= new Date(novaRetirada)) {
      return res.status(400).json({ error: "data_devolucao deve ser posterior a data_retirada." });
    }

    const novoDesconto = desconto !== undefined ? Number(desconto) : Number(atual.desconto);

    // Recalcular total se datas mudaram
    let novoTotal = Number(atual.valor_total);

    if (data_retirada || data_devolucao || desconto !== undefined) {
      const novosDias = calcDias(novaRetirada, novaDevolucao);

      const itensRes = await pool.query(
        "SELECT * FROM aluguel_item WHERE aluguel_id=$1",
        [id]
      );

      let soma = 0;
      for (const item of itensRes.rows) {
        const novoItemTotal = Number((item.valor_unitario * item.quantidade * novosDias).toFixed(2));
        await pool.query(
          "UPDATE aluguel_item SET dias=$1, valor_total=$2 WHERE id=$3",
          [novosDias, novoItemTotal, item.id]
        );
        soma += novoItemTotal;
      }

      novoTotal = Number((soma - novoDesconto).toFixed(2));
    }

    const result = await pool.query(
      `UPDATE aluguel
       SET locatario_nome=$1, locatario_cpf=$2, locatario_tel=$3,
           locatario_email=$4, locatario_end=$5,
           data_retirada=$6, data_devolucao=$7,
           desconto=$8, valor_total=$9, observacoes=$10
       WHERE id=$11 AND cliente_id=$12
       RETURNING *`,
      [
        locatario_nome  ?? atual.locatario_nome,
        locatario_cpf   ?? atual.locatario_cpf,
        locatario_tel   ?? atual.locatario_tel,
        locatario_email ?? atual.locatario_email,
        locatario_end   ?? atual.locatario_end,
        novaRetirada,
        novaDevolucao,
        novoDesconto,
        novoTotal,
        observacoes     ?? atual.observacoes,
        id,
        cliente_id,
      ]
    );

    // Atualizar evento no calendário se datas mudaram
    if (data_retirada || data_devolucao) {
      await pool.query(
        `UPDATE calendario_evento
         SET data_inicio=$1, data_fim=$2
         WHERE id=$3`,
        [novaRetirada, novaDevolucao, atual.evento_id]
      );
    }

    return res.json(result.rows[0]);
  } catch (err) {
    console.error("[updateAluguel]", err);
    return res.status(500).json({ error: "Erro ao atualizar aluguel." });
  }
};

// ─── 5. Atualizar status ──────────────────────────────────────────────────────
/**
 * PATCH /aluguel/:id/status
 * Body: { status }
 */
const updateStatusAluguel = async (req, res) => {
  const { cliente_id } = req.user;
  const { id } = req.params;
  const { status } = req.body;

  const STATUS_VALIDOS = ["reservado", "confirmado", "em_andamento", "devolvido", "cancelado"];

  if (!STATUS_VALIDOS.includes(status)) {
    return res.status(400).json({ error: `Status inválido: ${status}` });
  }

  try {
    const { rows } = await pool.query(
      "SELECT * FROM aluguel WHERE id=$1 AND cliente_id=$2",
      [id, cliente_id]
    );

    if (rows.length === 0) return res.status(404).json({ error: "Aluguel não encontrado." });

    const atual = rows[0];

    // Validar transições
    const TRANSICOES = {
      reservado:    ["confirmado", "cancelado"],
      confirmado:   ["em_andamento", "cancelado"],
      em_andamento: ["devolvido", "cancelado"],
      devolvido:    [],
      cancelado:    [],
    };

    if (!TRANSICOES[atual.status].includes(status)) {
      return res.status(400).json({
        error: `Não é possível ir de "${atual.status}" para "${status}".`,
      });
    }

    // Se devolvido, verificar se está quitado
    if (status === "devolvido") {
      const saldo = Number(atual.valor_total) - Number(atual.valor_pago);
      if (saldo > 0) {
        return res.status(400).json({
          error: `Aluguel possui saldo em aberto de ${fmtBRL(saldo)}. Quite o pagamento antes de devolver.`,
        });
      }
    }

    const result = await pool.query(
      "UPDATE aluguel SET status=$1 WHERE id=$2 AND cliente_id=$3 RETURNING *",
      [status, id, cliente_id]
    );

    // Atualizar status no calendário
    const mapStatus = {
      reservado:    "pendente",
      confirmado:   "confirmado",
      em_andamento: "confirmado",
      devolvido:    "concluido",
      cancelado:    "cancelado",
    };

    await pool.query(
      "UPDATE calendario_evento SET status=$1 WHERE id=$2",
      [mapStatus[status], atual.evento_id]
    );

    return res.json(result.rows[0]);
  } catch (err) {
    console.error("[updateStatusAluguel]", err);
    return res.status(500).json({ error: "Erro ao atualizar status." });
  }
};

// ─── 6. Registrar pagamento ───────────────────────────────────────────────────
/**
 * POST /aluguel/:id/pagamento
 * Body: { forma, valor, tipo, observacao }
 */
const registrarPagamento = async (req, res) => {
  const { cliente_id } = req.user;
  const { id } = req.params;
  const { forma, valor, tipo = "parcela", observacao } = req.body;

  if (!FORMAS_VALIDAS.includes(forma)) {
    return res.status(400).json({ error: `Forma inválida: ${forma}` });
  }

  if (!valor || Number(valor) <= 0) {
    return res.status(400).json({ error: "Valor inválido." });
  }

  if (!TIPOS_PGTO.includes(tipo)) {
    return res.status(400).json({ error: `Tipo inválido: ${tipo}` });
  }

  try {
    const { rows } = await pool.query(
      "SELECT * FROM aluguel WHERE id=$1 AND cliente_id=$2",
      [id, cliente_id]
    );

    if (rows.length === 0) return res.status(404).json({ error: "Aluguel não encontrado." });

    const aluguel = rows[0];

    if (["devolvido", "cancelado"].includes(aluguel.status)) {
      return res.status(400).json({ error: `Aluguel está "${aluguel.status}". Não aceita mais pagamentos.` });
    }

    const novoValorPago = Number((Number(aluguel.valor_pago) + Number(valor)).toFixed(2));

    if (novoValorPago > Number(aluguel.valor_total)) {
      return res.status(400).json({
        error: `Pagamento excede o total. Total: ${fmtBRL(aluguel.valor_total)}, já pago: ${fmtBRL(aluguel.valor_pago)}, tentando pagar: ${fmtBRL(valor)}.`,
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      await client.query(
        `INSERT INTO aluguel_pagamento (aluguel_id, forma, valor, tipo, observacao)
         VALUES ($1,$2,$3,$4,$5)`,
        [id, forma, Number(valor), tipo, observacao || null]
      );

      const updRes = await client.query(
        "UPDATE aluguel SET valor_pago=$1 WHERE id=$2 RETURNING *",
        [novoValorPago, id]
      );

      await client.query("COMMIT");

      const saldo = Number((Number(aluguel.valor_total) - novoValorPago).toFixed(2));

      return res.json({
        aluguel: updRes.rows[0],
        valor_pago:    novoValorPago,
        saldo_restante: saldo,
        quitado:        saldo <= 0,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("[registrarPagamento]", err);
    return res.status(500).json({ error: "Erro ao registrar pagamento." });
  }
};

// ─── 7. Verificar disponibilidade ────────────────────────────────────────────
/**
 * GET /aluguel/disponibilidade
 * Query: produto_id, data_retirada, data_devolucao
 */
const verificarDisponibilidade = async (req, res) => {
  const { cliente_id } = req.user;
  const { produto_id, data_retirada, data_devolucao } = req.query;

  if (!produto_id || !data_retirada || !data_devolucao) {
    return res.status(400).json({ error: "produto_id, data_retirada e data_devolucao são obrigatórios." });
  }

  try {
    const estoqueRes = await pool.query(
      `SELECT COALESCE(SUM(quantidade), 0) AS total
       FROM estoque
       WHERE produto_id=$1 AND cliente_id=$2`,
      [produto_id, cliente_id]
    );

    const conflito = await pool.query(
      `SELECT COALESCE(SUM(ai.quantidade), 0) AS qtd_ocupada
       FROM aluguel_item ai
       JOIN aluguel a ON a.id = ai.aluguel_id
       WHERE ai.produto_id  = $1
         AND a.cliente_id   = $2
         AND a.status NOT IN ('devolvido','cancelado')
         AND a.data_retirada  < $4
         AND a.data_devolucao > $3`,
      [produto_id, cliente_id, data_retirada, data_devolucao]
    );

    const total     = Number(estoqueRes.rows[0].total);
    const ocupado   = Number(conflito.rows[0].qtd_ocupada);
    const disponivel = total - ocupado;

    return res.json({
      produto_id: Number(produto_id),
      total_estoque: total,
      quantidade_ocupada: ocupado,
      quantidade_disponivel: disponivel,
      disponivel: disponivel > 0,
    });
  } catch (err) {
    console.error("[verificarDisponibilidade]", err);
    return res.status(500).json({ error: "Erro ao verificar disponibilidade." });
  }
};

// ─── 8. Listar pagamentos de um aluguel ──────────────────────────────────────
const getPagamentos = async (req, res) => {
  const { cliente_id } = req.user;
  const { id } = req.params;

  try {
    const check = await pool.query(
      "SELECT id FROM aluguel WHERE id=$1 AND cliente_id=$2",
      [id, cliente_id]
    );
    if (check.rows.length === 0) return res.status(404).json({ error: "Aluguel não encontrado." });

    const result = await pool.query(
      "SELECT * FROM aluguel_pagamento WHERE aluguel_id=$1 ORDER BY created_at ASC",
      [id]
    );

    return res.json(result.rows);
  } catch (err) {
    console.error("[getPagamentos]", err);
    return res.status(500).json({ error: "Erro ao buscar pagamentos." });
  }
};

// ─── 9. Gerar PDF contrato ────────────────────────────────────────────────────
/**
 * GET /aluguel/:id/contrato
 * Retorna JSON estruturado para o frontend renderizar/gerar PDF
 */
const getContrato = async (req, res) => {
  const { cliente_id } = req.user;
  const { id } = req.params;

  try {
    const aluguel = await _getAluguelCompleto(id, cliente_id);
    if (!aluguel) return res.status(404).json({ error: "Aluguel não encontrado." });

    // Busca dados do cliente (empresa locadora)
    const clienteRes = await pool.query(
      "SELECT * FROM cliente WHERE id=$1",
      [cliente_id]
    );

    const empresa = clienteRes.rows[0] || {};
    const dias = calcDias(aluguel.data_retirada, aluguel.data_devolucao);

    return res.json({
      contrato: {
        numero: String(aluguel.id).padStart(6, "0"),
        gerado_em: new Date().toISOString(),
        empresa: {
          nome:     empresa.nome     || "",
          cnpj:     empresa.cnpj     || "",
          endereco: empresa.endereco || "",
          telefone: empresa.telefone || "",
          email:    empresa.email    || "",
        },
        locatario: {
          nome:     aluguel.locatario_nome  || "",
          cpf:      aluguel.locatario_cpf   || "",
          telefone: aluguel.locatario_tel   || "",
          email:    aluguel.locatario_email || "",
          endereco: aluguel.locatario_end   || "",
        },
        periodo: {
          retirada:  aluguel.data_retirada,
          devolucao: aluguel.data_devolucao,
          dias,
        },
        itens: aluguel.itens,
        pagamentos: aluguel.pagamentos,
        financeiro: {
          valor_total:     aluguel.valor_total,
          desconto:        aluguel.desconto,
          valor_pago:      aluguel.valor_pago,
          saldo_restante:  Number((aluguel.valor_total - aluguel.valor_pago).toFixed(2)),
        },
        status:      aluguel.status,
        observacoes: aluguel.observacoes,
        clausulas: _clausulasPadrao(),
      },
    });
  } catch (err) {
    console.error("[getContrato]", err);
    return res.status(500).json({ error: "Erro ao gerar contrato." });
  }
};

// ─── 10. Gerar comprovante de pagamento ───────────────────────────────────────
/**
 * GET /aluguel/:id/comprovante
 */
const getComprovante = async (req, res) => {
  const { cliente_id } = req.user;
  const { id } = req.params;

  try {
    const aluguel = await _getAluguelCompleto(id, cliente_id);
    if (!aluguel) return res.status(404).json({ error: "Aluguel não encontrado." });

    const clienteRes = await pool.query("SELECT * FROM cliente WHERE id=$1", [cliente_id]);
    const empresa = clienteRes.rows[0] || {};

    const saldo = Number((aluguel.valor_total - aluguel.valor_pago).toFixed(2));

    return res.json({
      comprovante: {
        numero:    String(aluguel.id).padStart(6, "0"),
        gerado_em: new Date().toISOString(),
        empresa: {
          nome:     empresa.nome     || "",
          telefone: empresa.telefone || "",
        },
        locatario: {
          nome:     aluguel.locatario_nome || "Não informado",
          telefone: aluguel.locatario_tel  || "",
        },
        periodo: {
          retirada:  aluguel.data_retirada,
          devolucao: aluguel.data_devolucao,
        },
        financeiro: {
          valor_total:    aluguel.valor_total,
          desconto:       aluguel.desconto,
          valor_pago:     aluguel.valor_pago,
          saldo_restante: saldo,
          quitado:        saldo <= 0,
        },
        pagamentos: aluguel.pagamentos,
        status: aluguel.status,
      },
    });
  } catch (err) {
    console.error("[getComprovante]", err);
    return res.status(500).json({ error: "Erro ao gerar comprovante." });
  }
};

// ─── Helpers internos ─────────────────────────────────────────────────────────

const _getAluguelCompleto = async (id, cliente_id) => {
  const result = await pool.query(
    `SELECT
       a.*,
       (
         SELECT COALESCE(JSON_AGG(
           JSON_BUILD_OBJECT(
             'id', ai.id,
             'produto_id', ai.produto_id,
             'produto_nome', p.nome,
             'quantidade', ai.quantidade,
             'valor_unitario', ai.valor_unitario,
             'dias', ai.dias,
             'valor_total', ai.valor_total
           ) ORDER BY ai.id
         ), '[]')
         FROM aluguel_item ai
         JOIN produto p ON p.id = ai.produto_id
         WHERE ai.aluguel_id = a.id
       ) AS itens,
       (
         SELECT COALESCE(JSON_AGG(
           JSON_BUILD_OBJECT(
             'id', ap.id,
             'forma', ap.forma,
             'valor', ap.valor,
             'tipo', ap.tipo,
             'observacao', ap.observacao,
             'created_at', ap.created_at
           ) ORDER BY ap.created_at
         ), '[]')
         FROM aluguel_pagamento ap
         WHERE ap.aluguel_id = a.id
       ) AS pagamentos
     FROM aluguel a
     WHERE a.id=$1 AND a.cliente_id=$2`,
    [id, cliente_id]
  );

  return result.rows[0] || null;
};

const _clausulasPadrao = () => [
  "O locatário é responsável pela guarda e conservação dos itens durante o período de locação.",
  "Em caso de dano ou extravio, o locatário arcará com o custo de reposição ou reparo do item.",
  "A devolução deve ser feita no prazo acordado. Atrasos podem gerar cobrança adicional.",
  "O sinal pago não é reembolsável em caso de cancelamento pelo locatário.",
  "Os itens devem ser devolvidos limpos e em perfeito estado de conservação.",
];

// ─── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  criarAluguel,
  getAlugueis,
  getAluguelById,
  updateAluguel,
  updateStatusAluguel,
  registrarPagamento,
  verificarDisponibilidade,
  getPagamentos,
  getContrato,
  getComprovante,
};