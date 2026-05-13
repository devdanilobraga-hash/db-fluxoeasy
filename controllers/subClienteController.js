const pool = require("../db");

// Helpers
const pertenceAoCliente = (req, id) =>
  req.user.nivel_acesso === "superadmin" ||
  parseInt(id) === req.user.cliente_id;

// GET /sub-clientes  → lista os sub-clientes do cliente logado
const getSubClientes = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  try {
    const { rows } = await pool.query(
      `SELECT * FROM sub_cliente WHERE cliente_id=$1 AND ativo=true ORDER BY nome`,
      [cliente_id]
    );
    res.json(rows);
  } catch (err) {
    console.error("[getSubClientes]", err);
    res.status(500).json({ error: "Erro ao listar sub-clientes" });
  }
};

// POST /sub-clientes
const createSubCliente = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  const { nome, cpf_cnpj, email, telefone, endereco, observacoes } = req.body;

  if (!nome?.trim())
    return res.status(400).json({ error: "Nome é obrigatório" });

  try {
    const { rows } = await pool.query(
      `INSERT INTO sub_cliente (cliente_id, nome, cpf_cnpj, email, telefone, endereco, observacoes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [cliente_id, nome.trim(), cpf_cnpj || null, email || null,
       telefone || null, endereco || null, observacoes || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("[createSubCliente]", err);
    res.status(500).json({ error: "Erro ao criar sub-cliente" });
  }
};

// PUT /sub-clientes/:id
const updateSubCliente = async (req, res) => {
  const { id } = req.params;
  const cliente_id = req.user.cliente_id;
  const { nome, cpf_cnpj, email, telefone, endereco, observacoes } = req.body;

  try {
    // garante que o sub-cliente pertence ao cliente pai
    const { rows: check } = await pool.query(
      `SELECT id FROM sub_cliente WHERE id=$1 AND cliente_id=$2`,
      [id, cliente_id]
    );
    if (check.length === 0)
      return res.status(403).json({ error: "Acesso negado" });

    const { rows } = await pool.query(
      `UPDATE sub_cliente
       SET nome=$1, cpf_cnpj=$2, email=$3, telefone=$4, endereco=$5, observacoes=$6
       WHERE id=$7 RETURNING *`,
      [nome, cpf_cnpj || null, email || null,
       telefone || null, endereco || null, observacoes || null, id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error("[updateSubCliente]", err);
    res.status(500).json({ error: "Erro ao atualizar sub-cliente" });
  }
};

// DELETE /sub-clientes/:id  → soft delete
const removeSubCliente = async (req, res) => {
  const { id } = req.params;
  const cliente_id = req.user.cliente_id;

  try {
    const { rows: check } = await pool.query(
      `SELECT id FROM sub_cliente WHERE id=$1 AND cliente_id=$2`,
      [id, cliente_id]
    );
    if (check.length === 0)
      return res.status(403).json({ error: "Acesso negado" });

    await pool.query(`UPDATE sub_cliente SET ativo=false WHERE id=$1`, [id]);
    res.json({ message: "Sub-cliente removido" });
  } catch (err) {
    console.error("[removeSubCliente]", err);
    res.status(500).json({ error: "Erro ao remover sub-cliente" });
  }
};

module.exports = { getSubClientes, createSubCliente, updateSubCliente, removeSubCliente };