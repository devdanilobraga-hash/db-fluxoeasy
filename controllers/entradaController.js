const pool = require('../db');
const { addEstoque, removeEstoque } = require('./estoqueController');

// ─── Criar entrada ────────────────────────────────────────────────────────────
const createEntrada = async (req, res) => {
  const { produto_id, quantidade, preco_custo, data_validade, observacao } = req.body;
  const cliente_id = req.user.cliente_id;
  const usuario_id = req.user.id;

  try {
    // ── Valida se o produto aceita entrada de estoque ──
    const produtoCheck = await pool.query(
      "SELECT tipo, nome FROM produto WHERE id=$1 AND cliente_id=$2",
      [produto_id, cliente_id]
    );

    if (produtoCheck.rows.length === 0) {
      return res.status(404).json({ error: "Produto não encontrado." });
    }

    const tipoProduto = produtoCheck.rows[0].tipo;

    if (tipoProduto === "servico") {
      return res.status(400).json({
        error: "Serviços não movimentam estoque. Use apenas produtos ou itens alugáveis.",
      });
    }
    // tipo 'produto' e 'alugavel' — ambos passam ✅

    // ── Verifica se já existe entrada igual (mesmo produto, cliente, validade, preço e observação) ──
    const existing = await pool.query(
      `SELECT * FROM entrada
       WHERE cliente_id=$1
         AND produto_id=$2
         AND preco_custo=$3
         AND data_validade IS NOT DISTINCT FROM $4
         AND observacao IS NOT DISTINCT FROM $5`,
      [cliente_id, produto_id, preco_custo, data_validade || null, observacao || null]
    );

    if (existing.rows.length > 0) {
      // ── Atualiza apenas a quantidade da entrada existente ──
      const id = existing.rows[0].id;

      const result = await pool.query(
        `UPDATE entrada
         SET quantidade = quantidade + $1,
             data_entrada = CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo'
         WHERE id=$2
         RETURNING *`,
        [quantidade, id]
      );

      const entrada = result.rows[0];

      // Atualiza estoque apenas com a quantidade nova
      if (quantidade > 0) {
        await addEstoque({
          entrada_id: entrada.id,
          cliente_id,
          produto_id,
          quantidade,
          preco_custo,
          data_validade: data_validade || null,
        });
      }

      return res.status(201).json(entrada); // ← return para não cair no próximo res

    } else {
      // ── Cria nova entrada ──
      const result = await pool.query(
        `INSERT INTO entrada
          (cliente_id, produto_id, usuario_id, quantidade, preco_custo, data_validade, data_entrada, observacao)
          VALUES ($1,$2,$3,$4,$5,$6,CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo',$7)
          RETURNING *`,
        [cliente_id, produto_id, usuario_id, quantidade, preco_custo, data_validade || null, observacao || null]
      );

      const entrada = result.rows[0];

      // Adiciona ao estoque
      await addEstoque(entrada);

      return res.status(201).json(entrada); // ← return para não cair no próximo res
    }

    // ⚠️ LINHA DUPLICADA REMOVIDA — não há mais res.status(201) solto aqui

  } catch (err) {
    console.error('[createEntrada]', err);
    res.status(500).json({ error: 'Erro ao registrar entrada' });
  }
};

// ─── Listar entradas ──────────────────────────────────────────────────────────
const getEntradas = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  try {
    const result = await pool.query(
      `SELECT e.*, p.nome AS produto_nome, p.ean, p.tipo AS produto_tipo, u.nome AS usuario_nome
       FROM entrada e
       JOIN produto p ON e.produto_id = p.id
       JOIN usuario u ON e.usuario_id = u.id
       WHERE e.cliente_id = $1
       ORDER BY e.data_entrada DESC`,
      [cliente_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[getEntradas]', err);
    res.status(500).json({ error: 'Erro ao buscar entradas' });
  }
};

// ─── Buscar entrada por ID ────────────────────────────────────────────────────
const getEntradaById = async (req, res) => {
  const { id } = req.params;
  const cliente_id = req.user.cliente_id;

  try {
    const result = await pool.query(
      `SELECT e.*, p.nome AS produto_nome, p.tipo AS produto_tipo, u.nome AS usuario_nome
       FROM entrada e
       JOIN produto p ON e.produto_id = p.id
       JOIN usuario u ON e.usuario_id = u.id
       WHERE e.id = $1 AND e.cliente_id = $2`,
      [id, cliente_id]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ error: 'Entrada não encontrada' });

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[getEntradaById]', err);
    res.status(500).json({ error: 'Erro ao buscar entrada' });
  }
};

// ─── Atualizar entrada ────────────────────────────────────────────────────────
const updateEntrada = async (req, res) => {
  const { id } = req.params;
  const { produto_id, quantidade, preco_custo, data_validade, observacao } = req.body;
  const cliente_id = req.user.cliente_id;

  try {
    // Recuperar entrada antiga
    const oldEntrada = await pool.query(
      'SELECT * FROM entrada WHERE id=$1 AND cliente_id=$2',
      [id, cliente_id]
    );

    if (oldEntrada.rows.length === 0)
      return res.status(404).json({ error: 'Entrada não encontrada' });

    const old = oldEntrada.rows[0];

    // Valida tipo do produto destino
    const produtoCheck = await pool.query(
      "SELECT tipo FROM produto WHERE id=$1 AND cliente_id=$2",
      [produto_id, cliente_id]
    );

    if (produtoCheck.rows.length === 0)
      return res.status(404).json({ error: "Produto não encontrado." });

    if (produtoCheck.rows[0].tipo === "servico") {
      return res.status(400).json({
        error: "Serviços não movimentam estoque.",
      });
    }

    // Atualizar entrada
    const result = await pool.query(
      `UPDATE entrada
       SET produto_id=$1, quantidade=$2, preco_custo=$3, data_validade=$4, observacao=$5
       WHERE id=$6 AND cliente_id=$7
       RETURNING *`,
      [produto_id, quantidade, preco_custo, data_validade || null, observacao || null, id, cliente_id]
    );

    // Ajustar estoque: remove a antiga e adiciona a nova
    await removeEstoque(cliente_id, old.produto_id, old.quantidade);
    await addEstoque(result.rows[0]);

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[updateEntrada]', err);
    res.status(500).json({ error: 'Erro ao atualizar entrada' });
  }
};

// ─── Deletar entrada ──────────────────────────────────────────────────────────
const deleteEntrada = async (req, res) => {
  const { id } = req.params;
  const cliente_id = req.user.cliente_id;

  try {
    const entrada = await pool.query(
      'SELECT * FROM entrada WHERE id=$1 AND cliente_id=$2',
      [id, cliente_id]
    );

    if (entrada.rows.length === 0)
      return res.status(404).json({ error: 'Entrada não encontrada' });

    const e = entrada.rows[0];

    await removeEstoque(cliente_id, e.produto_id, e.quantidade);
    await pool.query('DELETE FROM entrada WHERE id=$1 AND cliente_id=$2', [id, cliente_id]);

    res.json({ message: 'Entrada deletada com sucesso e estoque ajustado' });
  } catch (err) {
    console.error('[deleteEntrada]', err);
    res.status(500).json({ error: 'Erro ao deletar entrada' });
  }
};

module.exports = { createEntrada, getEntradas, getEntradaById, deleteEntrada, updateEntrada };