const pool = require('../db');
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TIPOS_VALIDOS = ['produto', 'servico', 'alugavel'];

const isServico  = (tipo) => tipo === 'servico';
const isAlugavel = (tipo) => tipo === 'alugavel';

// ─── Criar produto, serviço ou item alugável ──────────────────────────────────
const createProduto = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  const usuario_id = req.user.id;

  const {
    nome, descricao, ean,
    preco_custo,
    valor_diaria,
    estoque,
    marca,
    imagem_url,
    tipo = 'produto',
  } = req.body;

  if (!TIPOS_VALIDOS.includes(tipo)) {
    return res.status(400).json({ error: `Tipo inválido: ${tipo}. Use: ${TIPOS_VALIDOS.join(', ')}` });
  }

  // Serviço nunca tem estoque
  const estoqueInicial = isServico(tipo) ? 0 : (Number(estoque) || 0);

  const valorDiaria = isAlugavel(tipo) ? (Number(valor_diaria) || null) : null;

  if (isAlugavel(tipo) && !valorDiaria) {
    return res.status(400).json({ error: 'valor_diaria é obrigatório para itens alugáveis.' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ── 1. Cria o produto ──────────────────────────────────────────────────
    const produtoResult = await client.query(
  `INSERT INTO produto
     (
       nome,
       descricao,
       ean,
       preco_custo,
       estoque,
       cliente_id,
       ativo,
       tipo,
       valor_diaria,
       marca,
       imagem_url
     )
   VALUES (
     $1,$2,$3,$4,$5,$6,true,$7,$8,$9,$10
   )
   RETURNING *`,
  [
    nome,
    descricao,
    ean || null,
    preco_custo || 0,
    estoqueInicial,
    cliente_id,
    tipo,
    valorDiaria,
    marca || null,
    imagem_url || null,
  ]
);

    const produto = produtoResult.rows[0];

    // ── 2. Se tem estoque inicial, cria entrada + lote automaticamente ─────
    // Aplica para 'produto' e 'alugavel'. Serviço já tem estoqueInicial = 0.
    if (estoqueInicial > 0) {

      // Registro em entrada (garante rastreabilidade e aparece na tela de Entradas)
      const entradaResult = await client.query(
        `INSERT INTO entrada
           (cliente_id, produto_id, usuario_id, quantidade, preco_custo,
            data_validade, data_entrada, observacao)
         VALUES ($1,$2,$3,$4,$5,NULL,
                 CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo',
                 $6)
         RETURNING *`,
        [
          cliente_id,
          produto.id,
          usuario_id,
          estoqueInicial,
          preco_custo || 0,
          'Estoque inicial no cadastro do produto',
        ]
      );

      const entrada = entradaResult.rows[0];

      // Lote no estoque (aparece na tela de Estoque)
      // Feito direto na transação para não abrir conexão paralela
      await client.query(
        `INSERT INTO estoque
           (produto_id, cliente_id, quantidade, data_validade, preco_custo,
            valor_venda, entrada_id, data_atualizacao)
         VALUES ($1,$2,$3,NULL,$4,NULL,$5,
                 CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')`,
        [produto.id, cliente_id, estoqueInicial, preco_custo || 0, entrada.id]
      );
    }

    await client.query('COMMIT');

    return res.status(201).json(produto);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[createProduto]', err);

    if (err.code === '23505' && err.constraint === 'ux_produto_cliente_ean') {
      return res.status(400).json({ error: 'EAN duplicado' });
    }

    res.status(500).json({ error: 'Erro ao criar produto' });
  } finally {
    client.release();
  }
};

const removerImagemProduto = async (req, res) => {
  const { id } = req.params;
  const cliente_id = req.user.cliente_id;

  try {
    const { rows } = await pool.query(
      `SELECT imagem_url
       FROM produto
       WHERE id = $1
         AND cliente_id = $2`,
      [id, cliente_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        error: "Produto não encontrado",
      });
    }

    const imagem_url = rows[0].imagem_url;

    if (imagem_url) {
      const publicId = imagem_url
        .split("/upload/")[1]
        .replace(/^v\d+\//, "")
        .replace(/\.[^.]+$/, "");

      await cloudinary.uploader.destroy(publicId);
    }

    const result = await pool.query(
      `UPDATE produto
       SET imagem_url = NULL
       WHERE id = $1
         AND cliente_id = $2
       RETURNING *`,
      [id, cliente_id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error("[removerImagemProduto]", err);
    res.status(500).json({
      error: "Erro ao remover imagem",
    });
  }
};

// ─── Listar ───────────────────────────────────────────────────────────────────
const getProdutos = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  const { tipo } = req.query;

  try {
    const conditions = ['cliente_id = $1'];
    const values     = [cliente_id];

    if (tipo && TIPOS_VALIDOS.includes(tipo)) {
      conditions.push(`tipo = $2`);
      values.push(tipo);
    }

    const result = await pool.query(
      `SELECT * FROM produto
       WHERE ${conditions.join(' AND ')}
       ORDER BY tipo, nome`,
      values
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[getProdutos]', err);
    res.status(500).json({ error: 'Erro ao buscar produtos' });
  }
};

// ─── Buscar por ID ────────────────────────────────────────────────────────────
const getProdutoById = async (req, res) => {
  const { id } = req.params;
  const cliente_id = req.user.cliente_id;

  try {
    const result = await pool.query(
      'SELECT * FROM produto WHERE id = $1 AND cliente_id = $2',
      [id, cliente_id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: 'Produto não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[getProdutoById]', err);
    res.status(500).json({ error: 'Erro ao buscar produto' });
  }
};

// ─── Atualizar ────────────────────────────────────────────────────────────────
const updateProduto = async (req, res) => {
  const { id } = req.params;
  const cliente_id = req.user.cliente_id;
  const { nome, descricao, ean, preco_custo, ativo, tipo, valor_diaria, marca, imagem_url } = req.body;

  try {
    const { rows } = await pool.query(
      'SELECT * FROM produto WHERE id = $1 AND cliente_id = $2',
      [id, cliente_id]
    );
    if (rows.length === 0)
      return res.status(404).json({ error: 'Produto não encontrado' });

    const atual    = rows[0];
    const novoTipo = tipo ?? atual.tipo;

    if (!TIPOS_VALIDOS.includes(novoTipo)) {
      return res.status(400).json({ error: `Tipo inválido: ${novoTipo}` });
    }

    const novoValorDiaria = isAlugavel(novoTipo)
      ? (valor_diaria !== undefined ? Number(valor_diaria) : atual.valor_diaria)
      : null;

    if (isAlugavel(novoTipo) && !novoValorDiaria) {
      return res.status(400).json({ error: 'valor_diaria é obrigatório para itens alugáveis.' });
    }

    const result = await pool.query(
  `UPDATE produto
   SET nome=$1,
       descricao=$2,
       ean=$3,
       preco_custo=$4,
       ativo=$5,
       tipo=$6,
       valor_diaria=$7,
       marca=$8,
       imagem_url=$9
   WHERE id=$10
     AND cliente_id=$11
   RETURNING *`,
  [
    nome ?? atual.nome,
    descricao ?? atual.descricao,
    ean !== undefined ? ean : atual.ean,
    preco_custo ?? atual.preco_custo,
    ativo ?? atual.ativo,
    novoTipo,
    novoValorDiaria,
    marca ?? atual.marca,
    imagem_url !== undefined ? imagem_url : atual.imagem_url,
    id,
    cliente_id,
  ]
);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[updateProduto]', err);
    res.status(500).json({ error: 'Erro ao atualizar produto' });
  }
};

const uploadImagemProduto = async (req, res) => {
  const { id } = req.params;
  const cliente_id = req.user.cliente_id;

  if (!req.file) {
    return res.status(400).json({
      error: "Nenhuma imagem enviada",
    });
  }

  try {
    const result = await pool.query(
      `UPDATE produto
       SET imagem_url = $1
       WHERE id = $2
         AND cliente_id = $3
       RETURNING *`,
      [req.file.path, id, cliente_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Produto não encontrado",
      });
    }

    res.json({
      imagem_url: req.file.path,
      produto: result.rows[0],
    });
  } catch (err) {
    console.error("[uploadImagemProduto]", err);
    res.status(500).json({
      error: "Erro ao salvar imagem",
    });
  }
};

const storageProduto = new CloudinaryStorage({
  cloudinary,
  params: async (req) => ({
    folder: "fluxoeasy/produtos",
    public_id: `produto_${req.params.id}`,
    overwrite: true,
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    transformation: [
      {
        width: 1000,
        height: 1000,
        crop: "limit",
      },
    ],
  }),
});

const uploadProduto = multer({
  storage: storageProduto,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

// ─── Ativar / Desativar ───────────────────────────────────────────────────────
const ativarProduto = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      'UPDATE produto SET ativo = true WHERE id = $1 RETURNING *',
      [id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: 'Produto não encontrado' });
    res.json({ message: 'Ativado com sucesso', produto: result.rows[0] });
  } catch (err) {
    console.error('[ativarProduto]', err);
    res.status(500).json({ error: 'Erro ao ativar produto' });
  }
};

const desativarProduto = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      'UPDATE produto SET ativo = false WHERE id = $1 RETURNING *',
      [id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: 'Produto não encontrado' });
    res.json({ message: 'Desativado com sucesso', produto: result.rows[0] });
  } catch (err) {
    console.error('[desativarProduto]', err);
    res.status(500).json({ error: 'Erro ao desativar produto' });
  }
};

module.exports = {
  createProduto,
  getProdutos,
  getProdutoById,
  updateProduto,
  ativarProduto,
  desativarProduto,
  uploadImagemProduto,
  removerImagemProduto,
  uploadProduto,
};