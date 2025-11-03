const pool = require('../db');

// ✅ Verifica se o e-mail está autorizado
const verificarEmail = async (req, res) => {
  const { email } = req.body;

  if (!email) return res.status(400).json({ erro: "E-mail é obrigatório." });

  try {
    const result = await pool.query(
      "SELECT * FROM emails_autorizados WHERE email = $1 AND ativo = true",
      [email]
    );

    if (result.rows.length > 0) {
      return res.json({ autorizado: true });
    } else {
      return res.json({
        autorizado: false,
        mensagem: "E-mail não autorizado",
        telefone: "📞 (21) 971536909" // 🔹 seu contato aqui
      });
    }
  } catch (err) {
    console.error("Erro ao verificar e-mail:", err);
    res.status(500).json({ erro: "Erro interno no servidor" });
  }
};

// ✅ Listar todos os e-mails (apenas admin)
const listarEmails = async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM emails_autorizados ORDER BY id");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao listar e-mails" });
  }
};

// ✅ Cadastrar novo e-mail
const cadastrarEmail = async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ erro: "E-mail é obrigatório." });

  try {
    await pool.query(
      "INSERT INTO emails_autorizados (email, ativo) VALUES ($1, true)",
      [email]
    );
    res.status(201).json({ sucesso: true });
  } catch (err) {
    console.error(err);
    if (err.code === "23505") {
      return res.status(400).json({ erro: "E-mail já cadastrado" });
    }
    res.status(500).json({ erro: "Erro ao cadastrar e-mail" });
  }
};

// Desativar e-mail
const desativarEmail = async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("UPDATE emails_autorizados SET ativo = false WHERE id = $1", [id]);
    res.status(200).json({ sucesso: true, mensagem: "E-mail desativado com sucesso" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao desativar e-mail" });
  }
};

// Ativar e-mail
const ativarEmail = async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("UPDATE emails_autorizados SET ativo = true WHERE id = $1", [id]);
    res.status(200).json({ sucesso: true, mensagem: "E-mail reativado com sucesso" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao reativar e-mail" });
  }
};

// Deletar e-mail
const deletarEmail = async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("DELETE FROM emails_autorizados WHERE id = $1", [id]);
    res.status(200).json({ sucesso: true, mensagem: "E-mail deletado com sucesso" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao deletar e-mail" });
  }
};

module.exports = {
  verificarEmail,
  listarEmails,
  cadastrarEmail,
  desativarEmail,
  ativarEmail,
  deletarEmail 
};
