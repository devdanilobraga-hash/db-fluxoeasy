const pool = require('../db');

// ✅ Cadastrar nova candidatura
const cadastrarCandidatura = async (req, res) => {
  const {
    email_id,
    data_candidatura,
    descricao_vaga,
    id_vaga,
    regiao,
    empresa,
    tipo,
    jornada,
    salario,
    mensagem,
    link
  } = req.body;

  if (!email_id || !data_candidatura || !descricao_vaga || !id_vaga) {
    return res.status(400).json({ erro: "Campos obrigatórios ausentes" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO candidaturas
      (email_id, data_candidatura, descricao_vaga, id_vaga, regiao, empresa, tipo, jornada, salario, mensagem, link)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *`,
      [email_id, data_candidatura, descricao_vaga, id_vaga, regiao, empresa, tipo, jornada, salario, mensagem, link]
    );

    res.status(201).json({ sucesso: true, candidatura: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao cadastrar candidatura" });
  }
};

// ✅ Listar todas as candidaturas
const listarCandidaturas = async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM candidaturas ORDER BY data_candidatura DESC");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao listar candidaturas" });
  }
};

// ✅ Listar candidaturas por email
const listarCandidaturasPorEmail = async (req, res) => {
  const { email_id } = req.params;

  try {
    const result = await pool.query(
      "SELECT * FROM candidaturas WHERE email_id = $1 ORDER BY data_candidatura DESC",
      [email_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao listar candidaturas" });
  }
};

// ✅ Deletar candidatura
const deletarCandidatura = async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("DELETE FROM candidaturas WHERE id = $1", [id]);
    res.status(200).json({ sucesso: true, mensagem: "Candidatura deletada com sucesso" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao deletar candidatura" });
  }
};

module.exports = {
  cadastrarCandidatura,
  listarCandidaturas,
  listarCandidaturasPorEmail,
  deletarCandidatura
};
