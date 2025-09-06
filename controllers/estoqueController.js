const pool = require('../db');

// Adiciona entrada no estoque (criação ou atualização de lote)
const addEstoque = async (entrada) => {
  const { id: entrada_id, produto_id, cliente_id, quantidade, data_validade } = entrada;

  try {
    // Verifica se já existe lote com mesmo produto e validade
    const existing = await pool.query(
      `SELECT * FROM estoque 
       WHERE produto_id=$1 AND cliente_id=$2 AND data_validade=$3`,
      [produto_id, cliente_id, data_validade]
    );

    if (existing.rows.length > 0) {
      // Atualiza quantidade do lote existente
      await pool.query(
        `UPDATE estoque 
         SET quantidade = quantidade + $1, data_atualizacao = NOW()
         WHERE id=$2`,
        [quantidade, existing.rows[0].id]
      );
    } else {
      // Cria novo lote
      await pool.query(
        `INSERT INTO estoque (produto_id, cliente_id, quantidade, data_validade, entrada_id, data_atualizacao)
         VALUES ($1,$2,$3,$4,$5,NOW())`,
        [produto_id, cliente_id, quantidade, data_validade, entrada_id]
      );
    }
  } catch (err) {
    console.error("Erro ao atualizar estoque:", err);
    throw err;
  }
};

// Remove quantidade do estoque (saída, venda, consumo)
const removeEstoque = async (cliente_id, produto_id, quantidade) => {
  try {
    let restante = quantidade;

    // Ordena por validade: FIFO
    const lotes = await pool.query(
      `SELECT * FROM estoque 
       WHERE produto_id=$1 AND cliente_id=$2 AND quantidade > 0
       ORDER BY data_validade ASC, id ASC`,
      [produto_id, cliente_id]
    );

    for (let lote of lotes.rows) {
      if (restante <= 0) break;

      if (lote.quantidade <= restante) {
        restante -= lote.quantidade;
        await pool.query(
          `UPDATE estoque SET quantidade=0, data_atualizacao=NOW() WHERE id=$1`,
          [lote.id]
        );
      } else {
        await pool.query(
          `UPDATE estoque SET quantidade = quantidade - $1, data_atualizacao=NOW() WHERE id=$2`,
          [restante, lote.id]
        );
        restante = 0;
      }
    }

    if (restante > 0) {
      throw new Error("Estoque insuficiente para a saída solicitada.");
    }

    return { success: true };
  } catch (err) {
    console.error("Erro ao remover estoque:", err);
    throw err;
  }
};

// Listar estoque por cliente
const getEstoque = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  try {
    const result = await pool.query(
      `SELECT e.id, e.produto_id, p.nome AS produto_nome, e.quantidade, e.data_validade, e.data_atualizacao
       FROM estoque e
       JOIN produto p ON e.produto_id = p.id
       WHERE e.cliente_id = $1
       ORDER BY p.nome ASC, e.data_validade ASC`,
      [cliente_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar estoque" });
  }
};

module.exports = { addEstoque, removeEstoque, getEstoque };
