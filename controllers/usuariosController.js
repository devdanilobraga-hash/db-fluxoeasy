const pool = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const registerUser = async (req, res) => {
  const { nome, login, senha, cargo, nivel_acesso, cliente_id } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(senha, 10);
    const result = await pool.query(
      'INSERT INTO usuario (nome, login, senha, cargo, nivel_acesso, cliente_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [nome, login, hashedPassword, cargo, nivel_acesso, cliente_id]
    );
    res.status(201).json({ usuario: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao cadastrar usuário' });
  }
};

const loginUser = async (req, res) => {
  const { login, senha } = req.body;
  try {
    const result = await pool.query('SELECT * FROM usuario WHERE login = $1', [login]);
    if (result.rows.length === 0) return res.status(400).json({ error: 'Usuário não encontrado' });

    const user = result.rows[0];
    const match = await bcrypt.compare(senha, user.senha);
    if (!match) return res.status(400).json({ error: 'Senha incorreta' });

    const token = jwt.sign({ id: user.id, nivel_acesso: user.nivel_acesso }, process.env.JWT_SECRET, { expiresIn: '8h' });
    res.json({ token, usuario: { id: user.id, nome: user.nome, nivel_acesso: user.nivel_acesso } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao fazer login' });
  }
};

const getUsers = async (req, res) => {
  try {
    const result = await pool.query('SELECT id, nome, login, cargo, nivel_acesso, cliente_id, ativo FROM usuario');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar usuários' });
  }
};

module.exports = { registerUser, loginUser, getUsers };
