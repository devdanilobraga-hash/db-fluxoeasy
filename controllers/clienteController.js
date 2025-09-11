const pool = require('../db');

// Listar apenas o cliente vinculado ao usuário logado
const getClientes = async (req, res) => {
  const cliente_id = req.user.cliente_id; // pega do token JWT
  try {
    const result = await pool.query(
      'SELECT * FROM cliente WHERE id = $1',
      [cliente_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Cliente não encontrado' });
    res.json(result.rows[0]); // retorna apenas o cliente vinculado
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar cliente' });
  }
};

// Buscar cliente por ID (opcional, mas só permite acessar se for o mesmo vinculado)
const getClienteById = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  const { id } = req.params;

  if (parseInt(id) !== cliente_id) {
    return res.status(403).json({ error: 'Acesso negado a este cliente' });
  }

  try {
    const result = await pool.query(
      'SELECT * FROM cliente WHERE id=$1',
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Cliente não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar cliente' });
  }
};

// Atualizar cliente (somente o cliente vinculado)
const updateCliente = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  const { nome, cnpj_cpf, email, telefone, endereco, ativo } = req.body;

  try {
    const result = await pool.query(
      `UPDATE cliente
       SET nome=$1, cnpj_cpf=$2, email=$3, telefone=$4, endereco=$5, ativo=$6
       WHERE id=$7
       RETURNING *`,
      [nome, cnpj_cpf, email, telefone, endereco, ativo, cliente_id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Cliente não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar cliente' });
  }
};

module.exports = { getClientes, getClienteById, updateCliente };
