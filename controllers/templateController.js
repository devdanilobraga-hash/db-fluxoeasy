const pool = require("../db");

const TIPOS_VALIDOS = ["recibo", "etiqueta_produto"];

const VARIAVEIS_DISPONIVEIS = {
  recibo: [
    "{{cliente.nome}}","{{cliente.endereco}}","{{cliente.cnpj_cpf}}",
    "{{venda.id}}","{{venda.total}}","{{venda.subtotal}}","{{venda.desconto}}",
    "{{venda.forma_pagamento}}","{{venda.valor_pago}}","{{venda.troco}}",
    "{{item.nome}}","{{item.quantidade}}","{{item.valor_unitario}}","{{item.valor_total}}",
    "{{data_hora}}","{{vendedor.nome}}","{{sub_cliente.nome}}","{{sub_cliente.cpf_cnpj}}",
  ],
  etiqueta_produto: [
    "{{produto.nome}}","{{produto.descricao}}","{{produto.ean}}",
    "{{produto.preco_venda}}","{{produto.preco_custo}}",
    "{{cliente.nome}}","{{cliente.cnpj_cpf}}",
    "{{venda.forma_pagamento}}","{{vendedor.nome}}","{{data_hora}}",
  ],
};

const fmt = (v) =>
  Number(v || 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });

const ownsTemplate = async (templateId, clienteId) => {
  const { rows } = await pool.query(
    `SELECT id FROM cliente_templates
     WHERE id = $1 AND cliente_id = $2 AND is_system = false`,
    [templateId, clienteId],
  );
  return rows.length > 0;
};

// ─── GET /clientes/:id/templates ─────────────────────────────────────────────

const getTemplates = async (req, res) => {
  const cliente_id = req.user.cliente_id;

  try {
    for (const tipo of TIPOS_VALIDOS) {
      const { rows: existentes } = await pool.query(
        `SELECT id FROM cliente_templates
         WHERE cliente_id = $1 AND tipo = $2 AND is_system = false LIMIT 1`,
        [cliente_id, tipo],
      );

      if (existentes.length === 0) {
        const { rows: base } = await pool.query(
          `SELECT nome, conteudo_xml FROM cliente_templates
           WHERE is_system = true AND tipo = $1 ORDER BY id ASC LIMIT 1`,
          [tipo],
        );
        if (base.length > 0) {
          await pool.query(
            `INSERT INTO cliente_templates
               (cliente_id, tipo, nome, conteudo_xml, ativo, is_system,
                categoria, is_padrao_categoria)
             VALUES ($1, $2, $3, $4, true, false,
                     $5, true)`,
            [
              cliente_id, tipo,
              tipo === "recibo" ? "Meu Recibo" : "Minha Etiqueta",
              base[0].conteudo_xml,
              tipo === "etiqueta_produto" ? "produto" : null,
            ],
          );
        }
      }
    }

    const { rows: templates_sistema } = await pool.query(
      `SELECT id, tipo, nome, descricao, conteudo_xml,
              ativo, is_system, categoria, is_padrao_categoria,
              created_at, updated_at
       FROM cliente_templates
       WHERE is_system = true
       ORDER BY tipo ASC, id ASC`,
    );

    const { rows: templates } = await pool.query(
      `SELECT id, tipo, nome, descricao, conteudo_xml,
              ativo, is_system, categoria, is_padrao_categoria,
              created_at, updated_at
       FROM cliente_templates
       WHERE cliente_id = $1 AND is_system = false
       ORDER BY tipo ASC, categoria ASC NULLS LAST, created_at ASC`,
      [cliente_id],
    );

    // Categorias existentes para o datalist do frontend
    const { rows: categoriasRows } = await pool.query(
      `SELECT DISTINCT categoria FROM cliente_templates
       WHERE cliente_id = $1 AND tipo = 'etiqueta_produto'
         AND categoria IS NOT NULL
       ORDER BY categoria ASC`,
      [cliente_id],
    );
    const categorias = categoriasRows.map((r) => r.categoria);

    res.json({ templates_sistema, templates, variaveis: VARIAVEIS_DISPONIVEIS, categorias });
  } catch (err) {
    console.error("[getTemplates]", err);
    res.status(500).json({ error: "Erro ao buscar templates" });
  }
};

// ─── POST /clientes/:id/templates ────────────────────────────────────────────

const createTemplate = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  const { tipo, nome, conteudo_xml, copiar_de, categoria } = req.body;

  if (!TIPOS_VALIDOS.includes(tipo))
    return res.status(400).json({ error: `Tipo inválido. Use: ${TIPOS_VALIDOS.join(", ")}` });
  if (!nome?.trim())
    return res.status(400).json({ error: "Nome do template é obrigatório" });
  if (tipo === "etiqueta_produto" && !categoria?.trim())
    return res.status(400).json({ error: "Categoria é obrigatória para etiquetas" });

  try {
    let xml = conteudo_xml?.trim();

    if (copiar_de && !xml) {
      const { rows } = await pool.query(
        `SELECT conteudo_xml, tipo FROM cliente_templates
         WHERE id = $1 AND (is_system = true OR cliente_id = $2)`,
        [copiar_de, cliente_id],
      );
      if (rows.length === 0)
        return res.status(404).json({ error: "Template base não encontrado" });
      if (rows[0].tipo !== tipo)
        return res.status(400).json({ error: "Tipo do template base não corresponde" });
      xml = rows[0].conteudo_xml;
    }

    if (!xml)
      return res.status(400).json({ error: "Conteúdo XML é obrigatório" });

    const categ = tipo === "etiqueta_produto" ? categoria.trim().toLowerCase() : null;

    // Verifica se já existe padrão para essa categoria
    const { rows: jaTemPadrao } = await pool.query(
      `SELECT id FROM cliente_templates
       WHERE cliente_id = $1 AND categoria = $2 AND is_padrao_categoria = true`,
      [cliente_id, categ],
    );
    const isPadrao = jaTemPadrao.length === 0; // Primeiro da categoria vira padrão

    const { rows } = await pool.query(
      `INSERT INTO cliente_templates
         (cliente_id, tipo, nome, conteudo_xml, ativo, is_system,
          categoria, is_padrao_categoria)
       VALUES ($1, $2, $3, $4, true, false, $5, $6)
       RETURNING *`,
      [cliente_id, tipo, nome.trim(), xml, categ, isPadrao],
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("[createTemplate]", err);
    res.status(500).json({ error: "Erro ao criar template" });
  }
};

// ─── PUT /clientes/:id/templates/:tid ────────────────────────────────────────

const updateTemplate = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  const { tid } = req.params;
  const { nome, conteudo_xml, ativo, categoria } = req.body;

  try {
    if (!(await ownsTemplate(tid, cliente_id)))
      return res.status(404).json({ error: "Template não encontrado ou não editável" });

    const { rows: atual } = await pool.query(
      "SELECT * FROM cliente_templates WHERE id = $1", [tid],
    );
    const t = atual[0];

    const novaCateg = t.tipo === "etiqueta_produto"
      ? (categoria?.trim().toLowerCase() ?? t.categoria)
      : null;

    const result = await pool.query(
      `UPDATE cliente_templates
       SET nome         = $1,
           conteudo_xml = $2,
           ativo        = $3,
           categoria    = $4,
           updated_at   = NOW()
       WHERE id = $5
       RETURNING *`,
      [
        nome         ?? t.nome,
        conteudo_xml ?? t.conteudo_xml,
        ativo        ?? t.ativo,
        novaCateg,
        tid,
      ],
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error("[updateTemplate]", err);
    res.status(500).json({ error: "Erro ao atualizar template" });
  }
};

// ─── DELETE /clientes/:id/templates/:tid ─────────────────────────────────────

const deleteTemplate = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  const { tid } = req.params;

  try {
    if (!(await ownsTemplate(tid, cliente_id)))
      return res.status(404).json({ error: "Template não encontrado ou não editável" });

    const { rows: atual } = await pool.query(
      "SELECT tipo, categoria, is_padrao_categoria FROM cliente_templates WHERE id = $1", [tid],
    );
    const t = atual[0];

    const { rows: demais } = await pool.query(
      `SELECT id FROM cliente_templates
       WHERE cliente_id = $1 AND tipo = $2 AND id != $3 AND is_system = false`,
      [cliente_id, t.tipo, tid],
    );
    if (demais.length === 0)
      return res.status(400).json({
        error: "Não é possível remover o único template deste tipo. Crie outro antes.",
      });

    await pool.query("DELETE FROM cliente_templates WHERE id = $1", [tid]);

    // Se era o padrão da categoria, promove o mais antigo da mesma categoria
    if (t.is_padrao_categoria && t.categoria) {
      await pool.query(
        `UPDATE cliente_templates SET is_padrao_categoria = true
         WHERE id = (
           SELECT id FROM cliente_templates
           WHERE cliente_id = $1 AND categoria = $2 AND is_system = false
           ORDER BY created_at ASC LIMIT 1
         )`,
        [cliente_id, t.categoria],
      );
    }

    res.json({ message: "Template removido com sucesso" });
  } catch (err) {
    console.error("[deleteTemplate]", err);
    res.status(500).json({ error: "Erro ao remover template" });
  }
};

// ─── POST /clientes/:id/templates/:tid/padrao ────────────────────────────────
// Define um template como padrão da sua categoria, removendo o padrão anterior.

const setPadraoCateg = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  const { tid } = req.params;

  try {
    if (!(await ownsTemplate(tid, cliente_id)))
      return res.status(404).json({ error: "Template não encontrado ou não editável" });

    const { rows } = await pool.query(
      "SELECT tipo, categoria FROM cliente_templates WHERE id = $1", [tid],
    );
    const t = rows[0];

    if (t.tipo !== "etiqueta_produto" || !t.categoria)
      return res.status(400).json({ error: "Apenas etiquetas com categoria podem ter padrão" });

    // Remove padrão anterior da mesma categoria
    await pool.query(
      `UPDATE cliente_templates
       SET is_padrao_categoria = false
       WHERE cliente_id = $1 AND categoria = $2 AND is_padrao_categoria = true`,
      [cliente_id, t.categoria],
    );

    // Define o novo padrão
    const { rows: updated } = await pool.query(
      `UPDATE cliente_templates
       SET is_padrao_categoria = true, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [tid],
    );

    res.json(updated[0]);
  } catch (err) {
    console.error("[setPadraoCateg]", err);
    res.status(500).json({ error: "Erro ao definir padrão" });
  }
};

// ─── POST /clientes/:id/templates/:tid/restaurar ─────────────────────────────

const restaurarTemplate = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  const { tid } = req.params;

  try {
    if (!(await ownsTemplate(tid, cliente_id)))
      return res.status(404).json({ error: "Template não encontrado ou não editável" });

    const { rows } = await pool.query(
      "SELECT tipo FROM cliente_templates WHERE id = $1", [tid],
    );
    const { rows: base } = await pool.query(
      `SELECT conteudo_xml FROM cliente_templates
       WHERE is_system = true AND tipo = $1 ORDER BY id ASC LIMIT 1`,
      [rows[0].tipo],
    );
    if (base.length === 0)
      return res.status(404).json({ error: "Nenhum template de sistema para restaurar" });

    const result = await pool.query(
      `UPDATE cliente_templates
       SET conteudo_xml = $1, updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [base[0].conteudo_xml, tid],
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error("[restaurarTemplate]", err);
    res.status(500).json({ error: "Erro ao restaurar template" });
  }
};

// ─── POST /clientes/:id/imprimir/recibo ──────────────────────────────────────
// (sem alterações — mantido idêntico ao original)
const renderizarRecibo = async (req, res) => {
  // ... código original sem mudanças ...
};

// ─── POST /clientes/:id/imprimir/etiqueta ────────────────────────────────────
// Agora aceita `categoria` como alternativa a `template_id`.

const renderizarEtiqueta = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  const { produto_ids, template_id, venda_id, categoria } = req.body;

  if (!Array.isArray(produto_ids) || produto_ids.length === 0)
    return res.status(400).json({ error: "produto_ids[] é obrigatório" });

  try {
    let xmlBase;

    if (template_id) {
      const { rows: tmpl } = await pool.query(
        `SELECT conteudo_xml FROM cliente_templates
         WHERE id = $1 AND tipo = 'etiqueta_produto'
           AND (cliente_id = $2 OR is_system = true)`,
        [template_id, cliente_id],
      );
      if (tmpl.length === 0)
        return res.status(404).json({ error: "Template não encontrado" });
      xmlBase = tmpl[0].conteudo_xml;

    } else if (categoria) {
      // Busca o padrão da categoria informada
      const { rows: tmpl } = await pool.query(
        `SELECT conteudo_xml FROM cliente_templates
         WHERE cliente_id = $1 AND tipo = 'etiqueta_produto'
           AND categoria = $2 AND is_padrao_categoria = true
           AND is_system = false`,
        [cliente_id, categoria.toLowerCase()],
      );
      if (tmpl.length === 0)
        return res.status(404).json({
          error: `Nenhum template padrão para a categoria "${categoria}"`,
        });
      xmlBase = tmpl[0].conteudo_xml;

    } else {
      // Fallback: padrão da categoria 'produto', ou qualquer ativo
      const { rows: tmpl } = await pool.query(
        `SELECT conteudo_xml FROM cliente_templates
         WHERE tipo = 'etiqueta_produto' AND ativo = true
           AND (cliente_id = $1 OR is_system = true)
         ORDER BY
           CASE WHEN cliente_id = $1 AND is_padrao_categoria = true THEN 0
                WHEN cliente_id = $1 THEN 1
                ELSE 2 END,
           created_at ASC
         LIMIT 1`,
        [cliente_id],
      );
      if (tmpl.length === 0)
        return res.status(404).json({ error: "Nenhum template de etiqueta disponível" });
      xmlBase = tmpl[0].conteudo_xml;
    }

    // ... resto do código original (dados de cliente, venda, produtos, map) ...
  } catch (err) {
    console.error("[renderizarEtiqueta]", err);
    res.status(500).json({ error: "Erro ao renderizar etiqueta" });
  }
};

module.exports = {
  getTemplates, createTemplate, updateTemplate,
  deleteTemplate, restaurarTemplate, setPadraoCateg,
  renderizarRecibo, renderizarEtiqueta,
};