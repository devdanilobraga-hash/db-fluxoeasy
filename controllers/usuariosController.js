const pool = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const registerUser = async (req, res) => {
  const { nome, login, senha, cargo, nivel_acesso, cliente_id: clienteSelecionado } = req.body;

  // Para superadmin, permitir cliente_id null
  let cliente_id = clienteSelecionado;
  if (nivel_acesso !== "superadmin" && !cliente_id) {
    return res.status(400).json({ error: "É necessário selecionar um cliente." });
  }

  try {
    const hashedPassword = await bcrypt.hash(senha, 10);
    const result = await pool.query(
      `INSERT INTO usuario (nome, login, senha, cargo, nivel_acesso, cliente_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, nome, login, cargo, nivel_acesso, cliente_id, ativo`,
      [nome, login, hashedPassword, cargo, nivel_acesso, cliente_id]
    );

    res.status(201).json({ usuario: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao cadastrar usuário' });
  }
};


// Desativar usuário (não exclui mais)
const desativarUser = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      'UPDATE usuario SET ativo = false WHERE id = $1 RETURNING id, nome, login, cargo, nivel_acesso, cliente_id, ativo',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }
    res.json({ message: "Usuário desativado com sucesso", usuario: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao desativar usuário" });
  }
};

// Ativar usuário
const ativarUser = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      'UPDATE usuario SET ativo = true WHERE id = $1 RETURNING id, nome, login, cargo, nivel_acesso, cliente_id, ativo',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }
    res.json({ message: "Usuário ativado com sucesso", usuario: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao ativar usuário" });
  }
};

const loginUser = async (req, res) => {
  const { login, senha } = req.body;

  try {
    const result = await pool.query(
      `SELECT u.*, c.nome AS cliente_nome
       FROM usuario u
       LEFT JOIN cliente c ON u.cliente_id = c.id
       WHERE u.login = $1`,
      [login]
    );

    if (result.rows.length === 0)
      return res.status(400).json({ error: 'Usuário não encontrado' });

    const user = result.rows[0];

    if (!user.ativo) {
      return res.status(403).json({ error: 'Usuário inativo. Contate o administrador.' });
    }

    const match = await bcrypt.compare(senha, user.senha);
    if (!match) return res.status(400).json({ error: 'Senha incorreta' });

    // 🔑 se for superadmin, não vincula cliente_id no token
    const tokenPayload = { id: user.id, nivel_acesso: user.nivel_acesso };
    if (user.nivel_acesso !== "superadmin") {
      tokenPayload.cliente_id = user.cliente_id;
    }

    const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, { expiresIn: '8h' });

    res.json({
      token,
      usuario: {
        id: user.id,
        nome: user.nome,
        nivel_acesso: user.nivel_acesso,
        cliente_id: user.cliente_id,
        cliente_nome: user.cliente_nome,
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao fazer login' });
  }
};


const getUsers = async (req, res) => {
  try {
    const { nivel_acesso, cliente_id } = req.user; // vem do token JWT
    let result;

    if (nivel_acesso === "superadmin") {
      // superadmin vê todos
      result = await pool.query('SELECT id, nome, login, cargo, nivel_acesso, cliente_id, ativo FROM usuario');
    } else {
      // outros usuários só veem usuários do mesmo cliente
      result = await pool.query(
        'SELECT id, nome, login, cargo, nivel_acesso, cliente_id, ativo FROM usuario WHERE cliente_id = $1',
        [cliente_id]
      );
    }

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar usuários' });
  }
};


const updateUser = async (req, res) => {
  const { id } = req.params;
  const { nome, login, senha, cargo, nivel_acesso, ativo } = req.body;
  const cliente_id = req.user.cliente_id;

  try {
    // opcional: atualizar senha somente se fornecida
    const hashedPassword = senha ? await bcrypt.hash(senha, 10) : undefined;

    const result = await pool.query(
      `UPDATE usuario
       SET nome = $1,
           login = $2,
           senha = COALESCE($3, senha),
           cargo = $4,
           nivel_acesso = $5,
           ativo = $6
       WHERE id = $7 AND cliente_id = $8
       RETURNING id, nome, login, cargo, nivel_acesso, cliente_id, ativo`,
      [nome, login, hashedPassword, cargo, nivel_acesso, ativo, id, cliente_id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado ou não pertence à sua filial' });

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar usuário' });
  }
};


module.exports = { registerUser, loginUser, getUsers, updateUser, ativarUser, desativarUser };
