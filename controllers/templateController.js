const pool = require("../db");

// ─── Tipos válidos ────────────────────────────────────────────────────────────

const TIPOS_VALIDOS = ["recibo", "etiqueta_produto"];

// ─── Variáveis disponíveis por tipo ──────────────────────────────────────────
// Retornadas ao frontend para exibir no editor como botões clicáveis.

const VARIAVEIS_DISPONIVEIS = {
  recibo: [
    "{{cliente.nome}}",
    "{{cliente.endereco}}",
    "{{cliente.cnpj_cpf}}",
    "{{venda.id}}",
    "{{venda.total}}",
    "{{venda.subtotal}}",
    "{{venda.desconto}}",
    "{{venda.forma_pagamento}}",
    "{{venda.valor_pago}}",
    "{{venda.troco}}",
    "{{item.nome}}",
    "{{item.quantidade}}",
    "{{item.valor_unitario}}",
    "{{item.valor_total}}",
    "{{data_hora}}",
    "{{vendedor.nome}}",
    "{{sub_cliente.nome}}",
    "{{sub_cliente.cpf_cnpj}}",
  ],
  etiqueta_produto: [
    "{{produto.nome}}",
    "{{produto.descricao}}",
    "{{produto.ean}}",
    "{{produto.preco_venda}}",
    "{{produto.preco_custo}}",
    "{{cliente.nome}}",
    "{{cliente.cnpj_cpf}}",
    "{{venda.forma_pagamento}}",
    "{{vendedor.nome}}",
    "{{data_hora}}",
  ],
};

// ─── Helper: formata valor monetário ─────────────────────────────────────────

const fmt = (v) =>
  Number(v || 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

// ─── Helper: verifica se o template pertence ao cliente e não é de sistema ────

const ownsTemplate = async (templateId, clienteId) => {
  const { rows } = await pool.query(
    `SELECT id FROM cliente_templates
     WHERE id = $1 AND cliente_id = $2 AND is_system = false`,
    [templateId, clienteId],
  );
  return rows.length > 0;
};

// ─── GET /clientes/:id/templates ─────────────────────────────────────────────
// Retorna templates do sistema (somente leitura) + templates do cliente (editáveis).
// Garante que o cliente sempre tenha ao menos um template próprio por tipo,
// copiando o primeiro modelo de sistema disponível se necessário.

const getTemplates = async (req, res) => {
  const cliente_id = req.user.cliente_id;

  try {
    // Garante ao menos um template próprio por tipo
    for (const tipo of TIPOS_VALIDOS) {
      const { rows: existentes } = await pool.query(
        `SELECT id FROM cliente_templates
         WHERE cliente_id = $1 AND tipo = $2 AND is_system = false
         LIMIT 1`,
        [cliente_id, tipo],
      );

      if (existentes.length === 0) {
        // Busca o primeiro template de sistema desse tipo para copiar o XML
        const { rows: base } = await pool.query(
          `SELECT nome, conteudo_xml FROM cliente_templates
           WHERE is_system = true AND tipo = $1
           ORDER BY id ASC LIMIT 1`,
          [tipo],
        );

        if (base.length > 0) {
          await pool.query(
            `INSERT INTO cliente_templates
               (cliente_id, tipo, nome, conteudo_xml, ativo, is_system)
             VALUES ($1, $2, $3, $4, true, false)`,
            [
              cliente_id,
              tipo,
              tipo === "recibo" ? "Meu Recibo" : "Minha Etiqueta",
              base[0].conteudo_xml,
            ],
          );
        }
      }
    }

    // Templates de sistema (somente leitura, compartilhados por todos)
    const { rows: templates_sistema } = await pool.query(
      `SELECT id, tipo, nome, descricao, conteudo_xml,
              ativo, is_system, created_at, updated_at
       FROM cliente_templates
       WHERE is_system = true
       ORDER BY tipo ASC, id ASC`,
    );

    // Templates do cliente (editáveis)
    const { rows: templates } = await pool.query(
      `SELECT id, tipo, nome, descricao, conteudo_xml,
              ativo, is_system, created_at, updated_at
       FROM cliente_templates
       WHERE cliente_id = $1 AND is_system = false
       ORDER BY tipo ASC, created_at ASC`,
      [cliente_id],
    );

    res.json({
      templates_sistema,
      templates,
      variaveis: VARIAVEIS_DISPONIVEIS,
    });
  } catch (err) {
    console.error("[getTemplates]", err);
    res.status(500).json({ error: "Erro ao buscar templates" });
  }
};

// ─── POST /clientes/:id/templates ────────────────────────────────────────────
// Cria um template novo para o cliente.
// Se vier `copiar_de` (id de qualquer template), copia o XML dele como ponto de partida.

const createTemplate = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  const { tipo, nome, conteudo_xml, copiar_de } = req.body;

  if (!TIPOS_VALIDOS.includes(tipo))
    return res
      .status(400)
      .json({ error: `Tipo inválido. Use: ${TIPOS_VALIDOS.join(", ")}` });

  if (!nome?.trim())
    return res.status(400).json({ error: "Nome do template é obrigatório" });

  try {
    let xml = conteudo_xml?.trim();

    // Copia XML de um template existente (sistema ou do próprio cliente)
    if (copiar_de && !xml) {
      const { rows } = await pool.query(
        `SELECT conteudo_xml, tipo FROM cliente_templates
         WHERE id = $1
           AND (is_system = true OR cliente_id = $2)`,
        [copiar_de, cliente_id],
      );

      if (rows.length === 0)
        return res.status(404).json({ error: "Template base não encontrado" });

      if (rows[0].tipo !== tipo)
        return res
          .status(400)
          .json({
            error: "O tipo do template base não corresponde ao tipo informado",
          });

      xml = rows[0].conteudo_xml;
    }

    if (!xml)
      return res.status(400).json({ error: "Conteúdo XML é obrigatório" });

    const { rows } = await pool.query(
      `INSERT INTO cliente_templates
         (cliente_id, tipo, nome, conteudo_xml, ativo, is_system)
       VALUES ($1, $2, $3, $4, true, false)
       RETURNING *`,
      [cliente_id, tipo, nome.trim(), xml],
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("[createTemplate]", err);
    res.status(500).json({ error: "Erro ao criar template" });
  }
};

// ─── PUT /clientes/:id/templates/:tid ────────────────────────────────────────
// Atualiza nome, XML e/ou estado ativo de um template do cliente.
// Templates de sistema (is_system=true) são bloqueados.

const updateTemplate = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  const { tid } = req.params;
  const { nome, conteudo_xml, ativo } = req.body;

  try {
    if (!(await ownsTemplate(tid, cliente_id)))
      return res
        .status(404)
        .json({ error: "Template não encontrado ou não editável" });

    const { rows: atual } = await pool.query(
      "SELECT * FROM cliente_templates WHERE id = $1",
      [tid],
    );

    const result = await pool.query(
      `UPDATE cliente_templates
       SET nome         = $1,
           conteudo_xml = $2,
           ativo        = $3,
           updated_at   = NOW()
       WHERE id = $4
       RETURNING *`,
      [
        nome ?? atual[0].nome,
        conteudo_xml ?? atual[0].conteudo_xml,
        ativo ?? atual[0].ativo,
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
// Remove template do cliente.
// Bloqueia se for o único template ativo do tipo para o cliente.

const deleteTemplate = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  const { tid } = req.params;

  try {
    if (!(await ownsTemplate(tid, cliente_id)))
      return res
        .status(404)
        .json({ error: "Template não encontrado ou não editável" });

    const { rows: atual } = await pool.query(
      "SELECT tipo FROM cliente_templates WHERE id = $1",
      [tid],
    );

    const { rows: demais } = await pool.query(
      `SELECT id FROM cliente_templates
       WHERE cliente_id = $1 AND tipo = $2 AND id != $3 AND is_system = false`,
      [cliente_id, atual[0].tipo, tid],
    );

    if (demais.length === 0)
      return res.status(400).json({
        error:
          "Não é possível remover o único template deste tipo. Crie outro antes.",
      });

    await pool.query("DELETE FROM cliente_templates WHERE id = $1", [tid]);
    res.json({ message: "Template removido com sucesso" });
  } catch (err) {
    console.error("[deleteTemplate]", err);
    res.status(500).json({ error: "Erro ao remover template" });
  }
};

// ─── POST /clientes/:id/templates/:tid/restaurar ─────────────────────────────
// Restaura o XML do template do cliente copiando do primeiro template de sistema
// do mesmo tipo. Não afeta templates de sistema.

const restaurarTemplate = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  const { tid } = req.params;

  try {
    if (!(await ownsTemplate(tid, cliente_id)))
      return res
        .status(404)
        .json({ error: "Template não encontrado ou não editável" });

    const { rows } = await pool.query(
      "SELECT tipo FROM cliente_templates WHERE id = $1",
      [tid],
    );

    const { rows: base } = await pool.query(
      `SELECT conteudo_xml FROM cliente_templates
       WHERE is_system = true AND tipo = $1
       ORDER BY id ASC LIMIT 1`,
      [rows[0].tipo],
    );

    if (base.length === 0)
      return res
        .status(404)
        .json({
          error: "Nenhum template de sistema encontrado para restaurar",
        });

    const result = await pool.query(
      `UPDATE cliente_templates
       SET conteudo_xml = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [base[0].conteudo_xml, tid],
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error("[restaurarTemplate]", err);
    res.status(500).json({ error: "Erro ao restaurar template" });
  }
};

// ─── POST /clientes/:id/imprimir/recibo ──────────────────────────────────────
// Renderiza o XML do recibo substituindo todas as variáveis com dados reais.
// Body:    { venda_id, template_id? }
// Retorna: { xml, venda, itens }

const renderizarRecibo = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  const { venda_id, template_id } = req.body;

  if (!venda_id)
    return res.status(400).json({ error: "venda_id é obrigatório" });

  try {
    // ── Dados da venda ────────────────────────────────────────────────────
    const { rows: vendas } = await pool.query(
      `SELECT
         v.*,
         v.criado_em AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo' AS criado_em_local,
         sc.nome     AS sub_cliente_nome,
         sc.cpf_cnpj AS sub_cliente_cpf_cnpj,
         u.nome      AS vendedor_nome,
         c.nome      AS cliente_nome,
         c.endereco  AS cliente_endereco,
         c.cnpj_cpf  AS cliente_cnpj_cpf
       FROM venda v
       LEFT JOIN sub_cliente sc ON sc.id = v.sub_cliente_id
       LEFT JOIN usuario     u  ON u.id  = v.usuario_id
       LEFT JOIN cliente     c  ON c.id  = v.cliente_id
       WHERE v.id = $1 AND v.cliente_id = $2`,
      [venda_id, cliente_id],
    );

    if (vendas.length === 0)
      return res.status(404).json({ error: "Venda não encontrada" });

    const venda = vendas[0];

    // ── Itens ─────────────────────────────────────────────────────────────
    const { rows: itens } = await pool.query(
      `SELECT vi.*, p.nome AS produto_nome
       FROM venda_item vi
       LEFT JOIN produto p ON p.id = vi.produto_id
       WHERE vi.venda_id = $1
       ORDER BY vi.id`,
      [venda_id],
    );

    const subtotal = itens.reduce((acc, it) => acc + Number(it.valor_total), 0);

    // ── Template ──────────────────────────────────────────────────────────
    let xmlBase;

    if (template_id) {
      const { rows: tmpl } = await pool.query(
        `SELECT conteudo_xml FROM cliente_templates
         WHERE id = $1
           AND tipo = 'recibo'
           AND (cliente_id = $2 OR is_system = true)`,
        [template_id, cliente_id],
      );
      if (tmpl.length === 0)
        return res.status(404).json({ error: "Template não encontrado" });
      xmlBase = tmpl[0].conteudo_xml;
    } else {
      // Prioridade: template próprio do cliente → template de sistema
      const { rows: tmpl } = await pool.query(
        `SELECT conteudo_xml FROM cliente_templates
         WHERE tipo = 'recibo' AND ativo = true
           AND (cliente_id = $1 OR is_system = true)
         ORDER BY
           CASE WHEN cliente_id = $1 THEN 0 ELSE 1 END,
           created_at ASC
         LIMIT 1`,
        [cliente_id],
      );
      if (tmpl.length === 0)
        return res
          .status(404)
          .json({ error: "Nenhum template de recibo disponível" });
      xmlBase = tmpl[0].conteudo_xml;
    }

    const dataHora = new Date(venda.criado_em_local).toLocaleString("pt-BR");

    // ── Expande bloco <item> para cada item da venda ───────────────────────
    let xml = xmlBase.replace(/<item>([\s\S]*?)<\/item>/g, (_, blocoItem) =>
      itens
        .map(
          (it) =>
            `<item>${blocoItem
              .replace(/\{\{item\.nome\}\}/g, it.produto_nome ?? "")
              .replace(/\{\{item\.quantidade\}\}/g, String(it.quantidade))
              .replace(/\{\{item\.valor_unitario\}\}/g, fmt(it.valor_unitario))
              .replace(
                /\{\{item\.valor_total\}\}/g,
                fmt(it.valor_total),
              )}</item>`,
        )
        .join("\n"),
    );

    // ── Substitui variáveis globais ───────────────────────────────────────
    xml = xml
      .replace(/\{\{cliente\.nome\}\}/g, venda.cliente_nome ?? "")
      .replace(/\{\{cliente\.endereco\}\}/g, venda.cliente_endereco ?? "")
      .replace(/\{\{cliente\.cnpj_cpf\}\}/g, venda.cliente_cnpj_cpf ?? "")
      .replace(/\{\{venda\.id\}\}/g, String(venda.id))
      .replace(/\{\{venda\.total\}\}/g, fmt(venda.valor_total))
      .replace(/\{\{venda\.subtotal\}\}/g, fmt(subtotal))
      .replace(/\{\{venda\.desconto\}\}/g, fmt(venda.desconto))
      .replace(/\{\{venda\.forma_pagamento\}\}/g, venda.forma_pagamento ?? "")
      .replace(/\{\{venda\.valor_pago\}\}/g, fmt(venda.valor_pago))
      .replace(/\{\{venda\.troco\}\}/g, fmt(venda.troco))
      .replace(/\{\{data_hora\}\}/g, dataHora)
      .replace(/\{\{vendedor\.nome\}\}/g, venda.vendedor_nome ?? "")
      .replace(/\{\{sub_cliente\.nome\}\}/g, venda.sub_cliente_nome ?? "")
      .replace(
        /\{\{sub_cliente\.cpf_cnpj\}\}/g,
        venda.sub_cliente_cpf_cnpj ?? "",
      );

    res.json({ xml, venda, itens });
  } catch (err) {
    console.error("[renderizarRecibo]", err);
    res.status(500).json({ error: "Erro ao renderizar recibo" });
  }
};

// ─── POST /clientes/:id/imprimir/etiqueta ────────────────────────────────────
// Renderiza o XML da etiqueta para N produtos.
// Body:    { produto_ids: number[], template_id?, venda_id? }
//   venda_id é opcional — necessário só para a etiqueta produto+venda.
// Retorna: { etiquetas: [{ produto_id, produto_nome, xml }] }

const renderizarEtiqueta = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  const { produto_ids, template_id, venda_id } = req.body;

  if (!Array.isArray(produto_ids) || produto_ids.length === 0)
    return res.status(400).json({ error: "produto_ids[] é obrigatório" });

  try {
    // ── Template ──────────────────────────────────────────────────────────
    let xmlBase;

    if (template_id) {
      const { rows: tmpl } = await pool.query(
        `SELECT conteudo_xml FROM cliente_templates
         WHERE id = $1
           AND tipo = 'etiqueta_produto'
           AND (cliente_id = $2 OR is_system = true)`,
        [template_id, cliente_id],
      );
      if (tmpl.length === 0)
        return res.status(404).json({ error: "Template não encontrado" });
      xmlBase = tmpl[0].conteudo_xml;
    } else {
      const { rows: tmpl } = await pool.query(
        `SELECT conteudo_xml FROM cliente_templates
         WHERE tipo = 'etiqueta_produto' AND ativo = true
           AND (cliente_id = $1 OR is_system = true)
         ORDER BY
           CASE WHEN cliente_id = $1 THEN 0 ELSE 1 END,
           created_at ASC
         LIMIT 1`,
        [cliente_id],
      );
      if (tmpl.length === 0)
        return res
          .status(404)
          .json({ error: "Nenhum template de etiqueta disponível" });
      xmlBase = tmpl[0].conteudo_xml;
    }

    // ── Dados do cliente ──────────────────────────────────────────────────
    const { rows: clientes } = await pool.query(
      "SELECT nome, cnpj_cpf FROM cliente WHERE id = $1",
      [cliente_id],
    );
    const cli = clientes[0] ?? {};

    // ── Dados da venda (opcional — usado na etiqueta produto+venda) ───────
    let vendaData = null;
    if (venda_id) {
      const { rows: vendas } = await pool.query(
        `SELECT
           v.forma_pagamento,
           v.criado_em AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo' AS criado_em_local,
           u.nome AS vendedor_nome
         FROM venda v
         LEFT JOIN usuario u ON u.id = v.usuario_id
         WHERE v.id = $1 AND v.cliente_id = $2`,
        [venda_id, cliente_id],
      );
      vendaData = vendas[0] ?? null;
    }

    // ── Produtos com preço de venda do lote mais recente ──────────────────
    const { rows: produtos } = await pool.query(
      `SELECT
         p.id,
         p.nome,
         p.ean,
         p.descricao,
         p.preco_custo,
         COALESCE(
  (SELECT valor_venda FROM estoque
   WHERE produto_id = p.id AND cliente_id = p.cliente_id
     AND valor_venda IS NOT NULL
   ORDER BY data_atualizacao DESC LIMIT 1),
  null   -- ← era 0, agora fica em branco na etiqueta
) AS preco_venda
       FROM produto p
       WHERE p.id = ANY($1) AND p.cliente_id = $2`,
      [produto_ids, cliente_id],
    );

    const dataHoraAtual = new Date().toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
    });
    const dataHoraVenda = vendaData
      ? new Date(vendaData.criado_em_local).toLocaleString("pt-BR")
      : dataHoraAtual;

    // ── Gera um XML renderizado por produto ───────────────────────────────
    const etiquetas = produtos.map((p) => ({
      produto_id: p.id,
      produto_nome: p.nome,
      xml: xmlBase
        .replace(/\{\{produto\.nome\}\}/g, p.nome ?? "")
        .replace(/\{\{produto\.descricao\}\}/g, p.descricao ?? "")
        .replace(/\{\{produto\.ean\}\}/g, p.ean ?? "")
        .replace(/\{\{produto\.preco_venda\}\}/g, p.preco_venda ? fmt(p.preco_venda) : "")
        .replace(/\{\{produto\.preco_custo\}\}/g, fmt(p.preco_custo))
        .replace(/\{\{cliente\.nome\}\}/g, cli.nome ?? "")
        .replace(/\{\{cliente\.cnpj_cpf\}\}/g, cli.cnpj_cpf ?? "")
        .replace(
          /\{\{venda\.forma_pagamento\}\}/g,
          vendaData?.forma_pagamento ?? "",
        )
        .replace(/\{\{vendedor\.nome\}\}/g, vendaData?.vendedor_nome ?? "")
        .replace(/\{\{data_hora\}\}/g, dataHoraVenda),
    }));

    res.json({ etiquetas });
  } catch (err) {
    console.error("[renderizarEtiqueta]", err);
    res.status(500).json({ error: "Erro ao renderizar etiqueta" });
  }
};

module.exports = {
  getTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  restaurarTemplate,
  renderizarRecibo,
  renderizarEtiqueta,
};
