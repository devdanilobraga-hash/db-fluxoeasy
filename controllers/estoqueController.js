const pool = require("../db");

// Adiciona entrada no estoque (criação ou atualização de lote)
const addEstoque = async (entrada) => {
  const {
    id: entrada_id,
    produto_id,
    cliente_id,
    quantidade,
    data_validade,
    preco_custo,
  } = entrada;

  try {
    // Verifica se essa entrada já foi adicionada ao estoque
    const checkDuplicate = await pool.query(
      `SELECT * FROM estoque WHERE entrada_id=$1`,
      [entrada_id],
    );
    if (checkDuplicate.rows.length > 0) {
      console.log("Entrada já adicionada ao estoque. Pulando.");
      return;
    }

    // Busca lote existente (mesmo produto, cliente, preço e validade)
    let existing;
    if (data_validade) {
      existing = await pool.query(
        `SELECT * FROM estoque 
         WHERE produto_id=$1 AND cliente_id=$2 AND preco_custo=$3
           AND data_validade = $4
         LIMIT 1`,
        [produto_id, cliente_id, preco_custo, data_validade],
      );
    } else {
      existing = await pool.query(
        `SELECT * FROM estoque 
         WHERE produto_id=$1 AND cliente_id=$2 AND preco_custo=$3
           AND data_validade IS NULL
         LIMIT 1`,
        [produto_id, cliente_id, preco_custo],
      );
    }

    if (existing.rows.length > 0) {
      // Atualiza quantidade do lote existente
      await pool.query(
        `UPDATE estoque 
         SET quantidade = quantidade + $1, data_atualizacao =CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo'
         WHERE id=$2`,
        [quantidade, existing.rows[0].id],
      );
    } else {
      // Cria novo lote
      await pool.query(
        `INSERT INTO estoque 
         (produto_id, cliente_id, quantidade, data_validade, preco_custo, valor_venda, entrada_id, data_atualizacao)
         VALUES ($1,$2,$3,$4,$5,NULL,$6,CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')`,
        [
          produto_id,
          cliente_id,
          quantidade,
          data_validade || null,
          preco_custo,
          entrada_id,
        ],
      );
    }
  } catch (err) {
    console.error("Erro ao atualizar estoque:", err);
    throw err;
  }
};

const putEstoque = async (req, res) => {
  const { id } = req.params;
  const { valor_venda } = req.body;
  const cliente_id = req.user.cliente_id; // assume JWT middleware

  try {
    // Atualiza o valor de venda
    const result = await pool.query(
      `UPDATE estoque 
       SET valor_venda=$1, data_atualizacao=CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo'
       WHERE id=$2 AND cliente_id=$3
       RETURNING *`,
      [valor_venda, id, cliente_id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Lote não encontrado" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Erro ao atualizar valor de venda:", err);
    res.status(500).json({ error: "Erro ao atualizar valor de venda" });
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
      [produto_id, cliente_id],
    );

    for (let lote of lotes.rows) {
      if (restante <= 0) break;

      if (lote.quantidade <= restante) {
        restante -= lote.quantidade;
        await pool.query(
          `UPDATE estoque SET quantidade=0, data_atualizacao=CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo' WHERE id=$1`,
          [lote.id],
        );
      } else {
        await pool.query(
          `UPDATE estoque SET quantidade = quantidade - $1, data_atualizacao=CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo' WHERE id=$2`,
          [restante, lote.id],
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

// Listar estoque por cliente (somente lotes com quantidade > 0)
const getEstoque = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  try {
    const result = await pool.query(
      `SELECT es.id, 
          es.produto_id,
          p.nome       AS produto_nome, 
          p.ean,
          p.imagem_url,
          p.marca,
          es.quantidade, 
          es.preco_custo, 
          es.valor_venda, 
          es.data_validade, 
          es.data_atualizacao
   FROM estoque es
   JOIN produto p ON es.produto_id = p.id
   JOIN entrada e ON es.entrada_id = e.id
   WHERE es.cliente_id = $1
     AND es.quantidade > 0
   ORDER BY p.nome ASC, es.data_validade ASC`,
      [cliente_id],
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar estoque" });
  }
};

// Atualiza estoque quando uma entrada é editada
// Recalcula a diferença entre quantidade antiga e nova no lote vinculado
const updateEstoqueByEntrada = async (
  entradaId,
  clienteId,
  produtoIdAntigo,
  produtoIdNovo,
  qtdAntiga,
  qtdNova,
  preco_custo,
  data_validade,
) => {
  try {
    const produtoMudou = String(produtoIdAntigo) !== String(produtoIdNovo);

    if (produtoMudou) {
      // Remove do produto antigo (FIFO normal)
      await removeEstoque(clienteId, produtoIdAntigo, Number(qtdAntiga));

      // Adiciona no novo produto — mas precisa forçar a inserção
      // ignorando a checagem de entrada_id duplicada
      const existing = await pool.query(
        data_validade
          ? `SELECT * FROM estoque WHERE produto_id=$1 AND cliente_id=$2 AND preco_custo=$3 AND data_validade=$4 LIMIT 1`
          : `SELECT * FROM estoque WHERE produto_id=$1 AND cliente_id=$2 AND preco_custo=$3 AND data_validade IS NULL LIMIT 1`,
        data_validade
          ? [produtoIdNovo, clienteId, preco_custo, data_validade]
          : [produtoIdNovo, clienteId, preco_custo],
      );

      if (existing.rows.length > 0) {
        await pool.query(
          `UPDATE estoque SET quantidade = quantidade + $1, data_atualizacao = CURRENT_TIMESTAMP WHERE id=$2`,
          [qtdNova, existing.rows[0].id],
        );
      } else {
        await pool.query(
          `INSERT INTO estoque (produto_id, cliente_id, quantidade, data_validade, preco_custo, valor_venda, entrada_id, data_atualizacao)
           VALUES ($1,$2,$3,$4,$5,NULL,$6,CURRENT_TIMESTAMP)`,
          [
            produtoIdNovo,
            clienteId,
            qtdNova,
            data_validade || null,
            preco_custo,
            entradaId,
          ],
        );
      }
    } else {
      // Mesmo produto — ajusta apenas a diferença no lote vinculado à entrada
      const delta = Number(qtdNova) - Number(qtdAntiga);
      if (delta === 0) return; // nada mudou

      // Busca o lote vinculado a esta entrada
      const loteResult = await pool.query(
        `SELECT * FROM estoque WHERE entrada_id=$1 LIMIT 1`,
        [entradaId],
      );

      if (loteResult.rows.length > 0) {
        const lote = loteResult.rows[0];
        const novaQtd = Number(lote.quantidade) + delta;

        if (novaQtd < 0) {
          throw new Error(
            `Estoque insuficiente. Disponível no lote: ${lote.quantidade}, tentando reduzir: ${Math.abs(delta)}.`,
          );
        }

        await pool.query(
          `UPDATE estoque SET quantidade=$1, data_atualizacao=CURRENT_TIMESTAMP WHERE id=$2`,
          [novaQtd, lote.id],
        );
      } else {
        // Lote sem entrada_id vinculada — fallback: busca por produto/preço/validade
        const fallback = await pool.query(
          data_validade
            ? `SELECT * FROM estoque WHERE produto_id=$1 AND cliente_id=$2 AND preco_custo=$3 AND data_validade=$4 ORDER BY id ASC LIMIT 1`
            : `SELECT * FROM estoque WHERE produto_id=$1 AND cliente_id=$2 AND preco_custo=$3 AND data_validade IS NULL ORDER BY id ASC LIMIT 1`,
          data_validade
            ? [produtoIdNovo, clienteId, preco_custo, data_validade]
            : [produtoIdNovo, clienteId, preco_custo],
        );

        if (fallback.rows.length > 0) {
          const novaQtd = Number(fallback.rows[0].quantidade) + delta;
          if (novaQtd < 0) throw new Error("Estoque insuficiente.");
          await pool.query(
            `UPDATE estoque SET quantidade=$1, data_atualizacao=CURRENT_TIMESTAMP WHERE id=$2`,
            [novaQtd, fallback.rows[0].id],
          );
        }
      }
    }
  } catch (err) {
    console.error("[updateEstoqueByEntrada]", err);
    throw err;
  }
};

// Adicione no module.exports:
module.exports = {
  addEstoque,
  removeEstoque,
  getEstoque,
  putEstoque,
  updateEstoqueByEntrada,
};
