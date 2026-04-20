const pool = require('../db');

// 🔹 Listar todos os planos ativos
// 🔹 Listar todos os planos, ativos e inativos
const getPlanos = async (req, res) => {
  try {
    const result = await pool.query(`
     SELECT * FROM planos WHERE ativo = true ORDER BY valor; 
      ORDER BY valor ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao listar planos' });
  }
};


// 🔹 Buscar plano por ID
const getPlanoById = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM planos WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Plano não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar plano' });
  }
};

// 🔹 Criar novo plano (somente admin)
const createPlano = async (req, res) => {
  if (req.user?.nivel_acesso !== 'superadmin') {
    return res.status(403).json({ error: 'Acesso negado' });
  }

  const {
    nome,
    valor,
    duracao_dias,
    limite_produtos,
    limite_usuarios,
    possui_relatorios,
    possui_nfe,
    possui_avaria
  } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO planos 
      (nome, valor, duracao_dias, limite_produtos, limite_usuarios, possui_relatorios, possui_nfe, possui_avaria)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *`,
      [
        nome,
        valor,
        duracao_dias,
        limite_produtos,
        limite_usuarios,
        possui_relatorios,
        possui_nfe,
        possui_avaria
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar plano' });
  }
};

// 🔹 Atualizar plano existente
const updatePlano = async (req, res) => {
  if (req.user?.nivel_acesso !== 'superadmin') {
    return res.status(403).json({ error: 'Acesso negado' });
  }

  const { id } = req.params;

  const {
    nome,
    valor,
    duracao_dias,
    limite_produtos,
    limite_usuarios,
    possui_relatorios,
    possui_nfe,
    possui_avaria,
    ativo
  } = req.body;

  try {
    const result = await pool.query(
      `UPDATE planos SET
        nome = $1,
        valor = $2,
        duracao_dias = $3,
        limite_produtos = $4,
        limite_usuarios = $5,
        possui_relatorios = $6,
        possui_nfe = $7,
        possui_avaria = $8,
        ativo = $9
       WHERE id = $10
       RETURNING *`,
      [
        nome,
        valor,
        duracao_dias,
        limite_produtos,
        limite_usuarios,
        possui_relatorios,
        possui_nfe,
        possui_avaria,
        ativo,
        id
      ]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar plano' });
  }
};

// 🔹 Desativar ou excluir (soft delete)
const deletePlano = async (req, res) => {
  if (req.user?.nivel_acesso !== 'superadmin') {
    return res.status(403).json({ error: 'Acesso negado' });
  }

  const { id } = req.params;
  try {
    await pool.query('UPDATE planos SET ativo = false WHERE id=$1', [id]);
    res.json({ message: 'Plano desativado com sucesso' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao desativar plano' });
  }
};

module.exports = {
  getPlanos,
  getPlanoById,
  createPlano,
  updatePlano,
  deletePlano
};
