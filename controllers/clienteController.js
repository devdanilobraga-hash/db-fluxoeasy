const pool = require('../db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir = path.join(__dirname, '..', 'uploads', 'logos');

// garante que a pasta existe
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `logo_${req.user.cliente_id}${ext}`);
  }
});

const upload = multer({ storage });


// Listar apenas o cliente vinculado ao usuário logado
const getClientes = async (req, res) => {
  try {
    let result;
    if (req.user.nivel_acesso === "superadmin") {
      // Atualiza clientes vencidos antes de buscar
      await pool.query(
        `UPDATE cliente 
         SET ativo = false 
         WHERE data_vencimento < CURRENT_DATE`
      );

      result = await pool.query('SELECT * FROM cliente ORDER BY nome');
      return res.json(result.rows);
    } else {
      const cliente_id = req.user.cliente_id;
      result = await pool.query('SELECT * FROM cliente WHERE id = $1', [cliente_id]);
      if (result.rows.length === 0) return res.status(404).json({ error: 'Cliente não encontrado' });

      // verifica vencimento
      const cliente = result.rows[0];
      if (new Date(cliente.data_vencimento) < new Date() && cliente.ativo) {
        await pool.query('UPDATE cliente SET ativo=false WHERE id=$1', [cliente.id]);
        cliente.ativo = false;
      }

      return res.json(cliente);
    }
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
  const { id } = req.params;
  const { nome, cnpj_cpf, email, telefone, endereco, ativo, logo_url, data_vencimento } = req.body;

  try {
    const clienteId = req.user.nivel_acesso === "superadmin" ? id : req.user.cliente_id;

    if (req.user.nivel_acesso !== "superadmin" && parseInt(id) !== req.user.cliente_id) {
      return res.status(403).json({ error: "Acesso negado" });
    }

    // Primeiro busca o cliente atual
    const clienteAtual = await pool.query('SELECT * FROM cliente WHERE id=$1', [clienteId]);
    if (clienteAtual.rows.length === 0) return res.status(404).json({ error: "Cliente não encontrado" });
    const atual = clienteAtual.rows[0];

    const result = await pool.query(
      `UPDATE cliente
       SET nome=$1,
           cnpj_cpf=$2,
           email=$3,
           telefone=$4,
           endereco=$5,
           ativo=$6,
           logo_url=$7,
           data_vencimento=$8
       WHERE id=$9
       RETURNING *`,
      [
        nome ?? atual.nome,
        cnpj_cpf ?? atual.cnpj_cpf,
        email ?? atual.email,
        telefone ?? atual.telefone,
        endereco ?? atual.endereco,
        ativo ?? atual.ativo,
        logo_url ?? atual.logo_url,
        data_vencimento ?? atual.data_vencimento,
        clienteId,
      ]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao atualizar cliente" });
  }
};



// rota para upload de logo
const uploadLogo = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  const filePath = `/uploads/logos/${req.file.filename}`;

  try {
    const result = await pool.query(
      `UPDATE cliente SET logo_url=$1 WHERE id=$2 RETURNING *`,
      [filePath, cliente_id]
    );
    res.json({ logo_url: filePath, cliente: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao salvar logo' });
  }
};

const getAllClientes = async (req, res) => {
  if (req.user.nivel_acesso !== "superadmin") {
    return res.status(403).json({ error: "Acesso negado" });
  }

  try {
    const result = await pool.query(`
      SELECT id, nome, ativo, data_pagamento, data_vencimento
      FROM cliente
      ORDER BY nome
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao listar clientes' });
  }
};



const createCliente = async (req, res) => {
  if (req.user.nivel_acesso !== "superadmin") {
    return res.status(403).json({ error: "Acesso negado" });
  }

  const { nome, cnpj_cpf, email, telefone, endereco } = req.body;

  // data de vencimento = hoje + 14 dias
  const dataVencimento = new Date();
  dataVencimento.setDate(dataVencimento.getDate() + 14);

  try {
    const result = await pool.query(
      `INSERT INTO cliente 
        (nome, cnpj_cpf, email, telefone, endereco, ativo, data_pagamento, data_vencimento)
       VALUES ($1, $2, $3, $4, $5, true, NULL, $6)
       RETURNING *`,
      [nome, cnpj_cpf, email, telefone, endereco, dataVencimento]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao criar cliente" });
  }
};



module.exports = { 
  getClientes, getClienteById, updateCliente, uploadLogo, upload, 
  getAllClientes, createCliente
};
