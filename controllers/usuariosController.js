const pool = require('../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const registerUser = async (req, res) => {
  const { nome, login, senha, cargo, nivel_acesso, cliente_id } = req.body;

  try {
    const hashedPassword = await bcrypt.hash(senha, 10);

    // Se for admin, procura admin existente do cliente
    if (nivel_acesso === "admin") {
      const existe = await pool.query(
        `SELECT id FROM usuario
         WHERE cliente_id = $1
         AND nivel_acesso = 'admin'
         LIMIT 1`,
        [cliente_id]
      );

      if (existe.rows.length > 0) {
        const userId = existe.rows[0].id;

        const update = await pool.query(
          `UPDATE usuario
           SET nome = $1,
               login = $2,
               senha = $3,
               cargo = $4,
               ativo = true
           WHERE id = $5
           RETURNING id,nome,login,cargo,nivel_acesso,cliente_id,ativo`,
          [nome, login, hashedPassword, cargo, userId]
        );

        return res.status(200).json({
          tipo: "atualizado",
          usuario: update.rows[0]
        });
      }
    }

    // cria novo
    const result = await pool.query(
      `INSERT INTO usuario
      (nome, login, senha, cargo, nivel_acesso, cliente_id)
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING id,nome,login,cargo,nivel_acesso,cliente_id,ativo`,
      [nome, login, hashedPassword, cargo, nivel_acesso, cliente_id]
    );

    res.status(201).json({
      tipo: "criado",
      usuario: result.rows[0]
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao cadastrar usuário" });
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
    const result = await pool.query(`
      SELECT u.*, c.nome AS cliente_nome, c.ativo AS cliente_ativo, c.data_vencimento
      FROM usuario u
      LEFT JOIN cliente c ON u.cliente_id = c.id
      WHERE u.login = $1
    `, [login]);

    if (result.rows.length === 0)
      return res.status(400).json({ error: 'Usuário não encontrado' });

    const user = result.rows[0];

    // Bloqueia usuário inativo
    if (!user.ativo) {
      return res.status(403).json({ error: 'Usuário inativo. Contate o administrador.' });
    }

    // Verifica se o cliente existe e se está vencido
    if (user.cliente_id && user.cliente_ativo) {
      const dataVencimento = new Date(user.data_vencimento);
      const hoje = new Date();

      // Se a data de vencimento for anterior à data atual
      if (dataVencimento < hoje) {
        // Atualiza o cliente para inativo no banco
        await pool.query('UPDATE cliente SET ativo = false WHERE id = $1', [user.cliente_id]);
        return res.status(403).json({ error: 'Cliente vencido. Contate o suporte.' });
      }
    }

    // Bloqueia acesso se o cliente estiver inativo
    let clienteAtivo = true;
    if (user.cliente_id) {
      // Garante boolean correto
      if (typeof user.cliente_ativo === 'boolean') {
        clienteAtivo = user.cliente_ativo;
      } else {
        clienteAtivo = user.cliente_ativo === 't' || user.cliente_ativo === 'true';
      }
    }

    if (!clienteAtivo) {
      return res.status(403).json({ error: 'Cliente inativo. Contate o suporte.' });
    }

    // Verifica senha
    const match = await bcrypt.compare(senha, user.senha);
    if (!match) return res.status(400).json({ error: 'Senha incorreta' });

    // Cria token JWT
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

// controllers/usuarioController.js
const heartbeat = async (req, res) => {
  const { id } = req.user; // vem do JWT
  try {
    await pool.query(
      'UPDATE usuario SET ultimo_heartbeat = NOW() WHERE id = $1',
      [id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao registrar heartbeat' });
  }
};


module.exports = { registerUser, loginUser, getUsers, updateUser, ativarUser, desativarUser, heartbeat };
