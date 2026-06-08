const pool = require("../db");

const criarDespesa = async (req, res) => {
  const { cliente_id } = req.user;
  const { descricao, categoria, valor, data_vencimento, data_pagamento, status, recorrente, recorrencia_meses, observacoes } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO despesa (cliente_id, descricao, categoria, valor, data_vencimento, data_pagamento, status, recorrente, recorrencia_meses, observacoes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [cliente_id, descricao, categoria, valor, data_vencimento, data_pagamento, status || 'pendente', recorrente || false, recorrencia_meses, observacoes]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao criar despesa" });
  }
};

const listarDespesas = async (req, res) => {
  const { cliente_id } = req.user;
  const { dataInicio, dataFim, categoria, status } = req.query;
  let query = `SELECT * FROM despesa WHERE cliente_id = $1`;
  const params = [cliente_id];
  let idx = 2;
  if (dataInicio) {
    query += ` AND data_vencimento >= $${idx++}`;
    params.push(dataInicio);
  }
  if (dataFim) {
    query += ` AND data_vencimento <= $${idx++}`;
    params.push(dataFim);
  }
  if (categoria && categoria !== "") {
    query += ` AND categoria = $${idx++}`;
    params.push(categoria);
  }
  if (status && status !== "") {
    query += ` AND status = $${idx++}`;
    params.push(status);
  }
  query += ` ORDER BY data_vencimento DESC`;
  const result = await pool.query(query, params);
  res.json(result.rows);
};

const atualizarDespesa = async (req, res) => {
  const { id } = req.params;
  const { cliente_id } = req.user;
  const updates = req.body;
  const setClause = Object.keys(updates).map((k, i) => `${k}=$${i+2}`).join(',');
  const values = [id, cliente_id, ...Object.values(updates)];
  const query = `UPDATE despesa SET ${setClause}, updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND cliente_id=$2 RETURNING *`;
  const result = await pool.query(query, values);
  if (result.rows.length === 0) return res.status(404).json({ error: "Despesa não encontrada" });
  res.json(result.rows[0]);
};

const deletarDespesa = async (req, res) => {
  const { id } = req.params;
  const { cliente_id } = req.user;
  await pool.query(`DELETE FROM despesa WHERE id=$1 AND cliente_id=$2`, [id, cliente_id]);
  res.status(204).send();
};



module.exports = { criarDespesa, listarDespesas, atualizarDespesa, deletarDespesa };