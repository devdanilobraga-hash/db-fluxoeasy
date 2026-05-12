const pool = require("../db");
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("cloudinary").v2;

// ─── Cloudinary config ────────────────────────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ─── Multer storage → Cloudinary ─────────────────────────────────────────────
const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req) => ({
    folder: "fluxoeasy/logos",
    public_id: `logo_${req.user.cliente_id}`,
    overwrite: true,
    allowed_formats: ["jpg", "jpeg", "png", "webp", "svg"],
    transformation: [{ width: 400, height: 400, crop: "limit" }],
  }),
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// ─── Controllers ──────────────────────────────────────────────────────────────

const getClientes = async (req, res) => {
  try {
    let result;
    if (req.user.nivel_acesso === "superadmin") {
      await pool.query(
        `UPDATE cliente SET ativo = false WHERE data_vencimento < CURRENT_DATE`,
      );
      result = await pool.query("SELECT * FROM cliente ORDER BY nome");
      return res.json(result.rows);
    }

    const cliente_id = req.user.cliente_id;
    result = await pool.query("SELECT * FROM cliente WHERE id = $1", [
      cliente_id,
    ]);

    if (result.rows.length === 0)
      return res.status(404).json({ error: "Cliente não encontrado" });

    const cliente = result.rows[0];

    if (new Date(cliente.data_vencimento) < new Date() && cliente.ativo) {
      await pool.query("UPDATE cliente SET ativo=false WHERE id=$1", [
        cliente.id,
      ]);
      cliente.ativo = false;
    }

    return res.json(cliente);
  } catch (err) {
    console.error("[getClientes]", err);
    res.status(500).json({ error: "Erro ao buscar cliente" });
  }
};

const getClienteById = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  const { id } = req.params;

  if (parseInt(id) !== cliente_id)
    return res.status(403).json({ error: "Acesso negado a este cliente" });

  try {
    const result = await pool.query("SELECT * FROM cliente WHERE id=$1", [id]);
    if (result.rows.length === 0)
      return res.status(404).json({ error: "Cliente não encontrado" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("[getClienteById]", err);
    res.status(500).json({ error: "Erro ao buscar cliente" });
  }
};

const updateCliente = async (req, res) => {
  const { id } = req.params;
  const {
    nome,
    cnpj_cpf,
    email,
    telefone,
    endereco,
    ativo,
    logo_url,
    data_vencimento,
    tipo_impressao,
    largura_bobina,
    auto_imprimir,
  } = req.body;

  try {
    if (
      req.user.nivel_acesso !== "superadmin" &&
      parseInt(id) !== req.user.cliente_id
    )
      return res.status(403).json({ error: "Acesso negado" });

    const clienteId =
      req.user.nivel_acesso === "superadmin" ? id : req.user.cliente_id;

    const { rows } = await pool.query("SELECT * FROM cliente WHERE id=$1", [
      clienteId,
    ]);
    if (rows.length === 0)
      return res.status(404).json({ error: "Cliente não encontrado" });

    const atual = rows[0];

    const result = await pool.query(
      `UPDATE cliente
       SET nome=$1, cnpj_cpf=$2, email=$3, telefone=$4, endereco=$5,
           ativo=$6, logo_url=$7, data_vencimento=$8,
           tipo_impressao=$9, largura_bobina=$10, auto_imprimir=$11
       WHERE id=$12
       RETURNING *`,
      [
        nome ?? atual.nome,
        cnpj_cpf ?? atual.cnpj_cpf,
        email ?? atual.email,
        telefone ?? atual.telefone,
        endereco ?? atual.endereco,
        ativo ?? atual.ativo,
        logo_url !== undefined ? logo_url : atual.logo_url,
        data_vencimento ?? atual.data_vencimento,
        tipo_impressao ?? atual.tipo_impressao,
        largura_bobina ?? atual.largura_bobina,
        auto_imprimir ?? atual.auto_imprimir,
        clienteId,
      ],
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error("[updateCliente]", err);
    res.status(500).json({ error: "Erro ao atualizar cliente" });
  }
};

const updateDadosInternos = async (req, res) => {
  if (req.user.nivel_acesso !== "superadmin")
    return res.status(403).json({ error: "Acesso negado" });

  const { id } = req.params;
  const { nome_proprietario, contato_cliente } = req.body;

  try {
    const result = await pool.query(
      `UPDATE cliente
       SET nome_proprietario=$1, contato_cliente=$2
       WHERE id=$3
       RETURNING *`,
      [nome_proprietario ?? null, contato_cliente ?? null, id],
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "Cliente não encontrado" });

    res.json(result.rows[0]);
  } catch (err) {
    console.error("[updateDadosInternos]", err);
    res.status(500).json({ error: "Erro ao salvar dados internos" });
  }
};

const uploadLogo = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Nenhum arquivo recebido" });
  }

  const cliente_id = req.user.cliente_id;
  const logo_url = req.file.path;

  try {
    const result = await pool.query(
      `UPDATE cliente SET logo_url=$1 WHERE id=$2 RETURNING *`,
      [logo_url, cliente_id],
    );

    res.json({ logo_url, cliente: result.rows[0] });
  } catch (err) {
    console.error("[uploadLogo]", err);
    res.status(500).json({ error: "Erro ao salvar logo" });
  }
};

const removeLogo = async (req, res) => {
  const cliente_id =
    req.user.nivel_acesso === "superadmin"
      ? req.params.id
      : req.user.cliente_id;

  try {
    const { rows } = await pool.query(
      "SELECT logo_url FROM cliente WHERE id=$1",
      [cliente_id],
    );
    const logo_url = rows[0]?.logo_url;

    if (logo_url) {
      const publicId = logo_url
        .split("/upload/")[1]
        .replace(/^v\d+\//, "")
        .replace(/\.[^.]+$/, "");

      await cloudinary.uploader.destroy(publicId);
    }

    const result = await pool.query(
      `UPDATE cliente SET logo_url=NULL WHERE id=$1 RETURNING *`,
      [cliente_id],
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error("[removeLogo]", err);
    res.status(500).json({ error: "Erro ao remover logo" });
  }
};

const getAllClientes = async (req, res) => {
  if (req.user.nivel_acesso !== "superadmin")
    return res.status(403).json({ error: "Acesso negado" });

  try {
    const result = await pool.query(`
      SELECT
        c.*,
        EXISTS (
          SELECT 1 FROM usuario u
          WHERE u.cliente_id = c.id
            AND u.ativo = true
            AND u.ultimo_heartbeat > NOW() - INTERVAL '2 minutes'
        ) AS tem_usuario_online
      FROM cliente c
      ORDER BY c.nome
    `);
    res.json(result.rows);
  } catch (err) {
    console.error("[getAllClientes]", err);
    res.status(500).json({ error: "Erro ao listar clientes" });
  }
};

// ─── Criar cliente simplificado ───────────────────────────────────────────────
// Recebe apenas: nome (empresa), nome_proprietario e contato_cliente.
// Demais dados (CNPJ, email, telefone, endereço) ficam a cargo do próprio cliente.
const createCliente = async (req, res) => {
  if (req.user.nivel_acesso !== "superadmin")
    return res.status(403).json({ error: "Acesso negado" });

  const { nome, nome_proprietario, contato_cliente } = req.body;

  if (!nome?.trim())
    return res.status(400).json({ error: "Nome da empresa é obrigatório" });

  const dataVencimento = new Date();
  dataVencimento.setDate(dataVencimento.getDate() + 14);

  try {
    const result = await pool.query(
      `INSERT INTO cliente
         (nome, nome_proprietario, contato_cliente, ativo, data_pagamento, data_vencimento)
       VALUES ($1, $2, $3, true, NULL, $4)
       RETURNING *`,
      [
        nome.trim(),
        nome_proprietario?.trim() || null,
        contato_cliente?.trim() || null,
        dataVencimento,
      ],
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("[createCliente]", err);
    res.status(500).json({ error: "Erro ao criar cliente" });
  }
};

const getClienteByCpfCnpj = async (req, res) => {
  const { cpf_cnpj } = req.params;
  try {
    const result = await pool.query(
      `SELECT * FROM cliente
       WHERE REPLACE(REPLACE(REPLACE(cnpj_cpf, '.', ''), '/', ''), '-', '') = $1`,
      [cpf_cnpj],
    );
    if (result.rows.length === 0) return res.status(404).json(null);
    res.json(result.rows[0]);
  } catch (err) {
    console.error("[getClienteByCpfCnpj]", err);
    res.status(500).json({ error: "Erro ao buscar cliente por CPF/CNPJ" });
  }
};

module.exports = {
  getClientes,
  getClienteById,
  updateCliente,
  uploadLogo,
  removeLogo,
  upload,
  getAllClientes,
  createCliente,
  getClienteByCpfCnpj,
  updateDadosInternos,
};