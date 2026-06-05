const pool = require("../db");

const TIPOS_VALIDOS = ["recibo", "etiqueta_produto", "recibo_venda"];

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
  recibo_venda: [
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
};

const fmtDataHora = (d) =>
  new Date(d).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

const fmt = (v) =>
  Number(v || 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
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
    // ── Bootstrap etiqueta_produto e recibo (tipos simples, sem subcategoria) ──
    const TIPOS_SIMPLES = ["recibo", "etiqueta_produto"];
    for (const tipo of TIPOS_SIMPLES) {
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
             VALUES ($1, $2, $3, $4, true, false, $5, true)`,
            [
              cliente_id,
              tipo,
              tipo === "recibo" ? "Meu Recibo" : "Minha Etiqueta",
              base[0].conteudo_xml,
              tipo === "etiqueta_produto" ? "produto" : null,
            ],
          );
        }
      }
    }

    // ── Bootstrap recibo_venda (por categoria: bobina_80mm e a4) ──────────────
    for (const categ of ["bobina_80mm", "a4"]) {
      const { rows: existentes } = await pool.query(
        `SELECT id FROM cliente_templates
         WHERE cliente_id = $1 AND tipo = 'recibo_venda'
           AND categoria = $2 AND is_system = false LIMIT 1`,
        [cliente_id, categ],
      );
      if (existentes.length === 0) {
        const { rows: base } = await pool.query(
          `SELECT nome, conteudo_xml FROM cliente_templates
           WHERE is_system = true AND tipo = 'recibo_venda'
             AND categoria = $1
           ORDER BY id ASC LIMIT 1`,
          [categ],
        );
        if (base.length > 0) {
          await pool.query(
            `INSERT INTO cliente_templates
               (cliente_id, tipo, nome, conteudo_xml, ativo, is_system,
                categoria, is_padrao_categoria)
             VALUES ($1, 'recibo_venda', $2, $3, true, false, $4, $5)`,
            [
              cliente_id,
              categ === "bobina_80mm"
                ? "Meu Recibo (Bobina)"
                : "Meu Recibo (A4)",
              base[0].conteudo_xml,
              categ,
              categ === "bobina_80mm",
            ],
          );
        }
      }
    }

    // ── Bootstrap etiqueta_produto categoria "venda" ───────────────────────────
    for (const categ of ["produto", "venda"]) {
      const { rows: existentes } = await pool.query(
        `SELECT id FROM cliente_templates
         WHERE cliente_id = $1 AND tipo = 'etiqueta_produto'
           AND categoria = $2 AND is_system = false LIMIT 1`,
        [cliente_id, categ],
      );
      if (existentes.length === 0) {
        const { rows: base } = await pool.query(
          `SELECT nome, conteudo_xml FROM cliente_templates
           WHERE is_system = true AND tipo = 'etiqueta_produto'
             AND categoria = $1
           ORDER BY id ASC LIMIT 1`,
          [categ],
        );
        if (base.length > 0) {
          await pool.query(
            `INSERT INTO cliente_templates
               (cliente_id, tipo, nome, conteudo_xml, ativo, is_system,
                categoria, is_padrao_categoria)
             VALUES ($1, 'etiqueta_produto', $2, $3, true, false, $4, true)`,
            [
              cliente_id,
              categ === "venda" ? "Minha Etiqueta de Venda" : "Minha Etiqueta",
              base[0].conteudo_xml,
              categ,
            ],
          );
        }
      }
    }

    // ── Queries de retorno ─────────────────────────────────────────────────────
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

    const { rows: categoriasRows } = await pool.query(
      `SELECT DISTINCT categoria FROM cliente_templates
       WHERE cliente_id = $1 AND tipo = 'etiqueta_produto'
         AND categoria IS NOT NULL
       ORDER BY categoria ASC`,
      [cliente_id],
    );
    const categorias = categoriasRows.map((r) => r.categoria);

    res.json({
      templates_sistema,
      templates,
      variaveis: VARIAVEIS_DISPONIVEIS,
      categorias,
    });
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
    return res
      .status(400)
      .json({ error: `Tipo inválido. Use: ${TIPOS_VALIDOS.join(", ")}` });
  if (!nome?.trim())
    return res.status(400).json({ error: "Nome do template é obrigatório" });
  if (tipo === "etiqueta_produto" && !categoria?.trim())
    return res
      .status(400)
      .json({ error: "Categoria é obrigatória para etiquetas" });

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
        return res
          .status(400)
          .json({ error: "Tipo do template base não corresponde" });
      xml = rows[0].conteudo_xml;
    }

    if (!xml)
      return res.status(400).json({ error: "Conteúdo XML é obrigatório" });

    const categ =
      tipo === "etiqueta_produto" ? categoria.trim().toLowerCase() : null;

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
      return res
        .status(404)
        .json({ error: "Template não encontrado ou não editável" });

    const { rows: atual } = await pool.query(
      "SELECT * FROM cliente_templates WHERE id = $1",
      [tid],
    );
    const t = atual[0];

    const TIPOS_COM_CATEGORIA = ["etiqueta_produto", "recibo_venda"];
    const novaCateg = TIPOS_COM_CATEGORIA.includes(t.tipo)
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
        nome ?? t.nome,
        conteudo_xml ?? t.conteudo_xml,
        ativo ?? t.ativo,
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
      return res
        .status(404)
        .json({ error: "Template não encontrado ou não editável" });

    const { rows: atual } = await pool.query(
      "SELECT tipo, categoria, is_padrao_categoria FROM cliente_templates WHERE id = $1",
      [tid],
    );
    const t = atual[0];

    const { rows: demais } = await pool.query(
      `SELECT id FROM cliente_templates
       WHERE cliente_id = $1 AND tipo = $2 AND id != $3 AND is_system = false`,
      [cliente_id, t.tipo, tid],
    );
    if (demais.length === 0)
      return res.status(400).json({
        error:
          "Não é possível remover o único template deste tipo. Crie outro antes.",
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
      return res
        .status(404)
        .json({ error: "Template não encontrado ou não editável" });

    const { rows } = await pool.query(
      "SELECT tipo, categoria FROM cliente_templates WHERE id = $1",
      [tid],
    );
    const t = rows[0];

    const TIPOS_COM_PADRAO_POR_CATEGORIA = ["etiqueta_produto", "recibo_venda"];
    if (!TIPOS_COM_PADRAO_POR_CATEGORIA.includes(t.tipo) || !t.categoria)
      return res
        .status(400)
        .json({
          error: "Este tipo de template não suporta padrão por categoria",
        });

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
      return res
        .status(404)
        .json({ error: "Template não encontrado ou não editável" });

    const { rows } = await pool.query(
      "SELECT tipo FROM cliente_templates WHERE id = $1",
      [tid],
    );
    const { rows: base } = await pool.query(
      `SELECT conteudo_xml FROM cliente_templates
       WHERE is_system = true AND tipo = $1 ORDER BY id ASC LIMIT 1`,
      [rows[0].tipo],
    );
    if (base.length === 0)
      return res
        .status(404)
        .json({ error: "Nenhum template de sistema para restaurar" });

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
// ─── POST /clientes/:id/imprimir/recibo ──────────────────────────────────────
const renderizarRecibo = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  const { venda_id, template_id, categoria } = req.body;

  if (!venda_id)
    return res.status(400).json({ error: "venda_id é obrigatório" });

  try {
    // ── 1. Busca o template ─────────────────────────────────────────────────
    let xmlBase;
    let templateCategoria = "bobina_80mm"; // fallback

    if (template_id) {
      const { rows } = await pool.query(
        `SELECT conteudo_xml, categoria FROM cliente_templates
         WHERE id = $1 AND tipo = 'recibo_venda'
           AND (cliente_id = $2 OR is_system = true)`,
        [template_id, cliente_id],
      );
      if (!rows.length)
        return res.status(404).json({ error: "Template não encontrado" });
      xmlBase = rows[0].conteudo_xml;
      templateCategoria = rows[0].categoria ?? "bobina_80mm";
    } else if (categoria) {
      const { rows } = await pool.query(
        `SELECT conteudo_xml, categoria FROM cliente_templates
         WHERE cliente_id = $1 AND tipo = 'recibo_venda'
           AND categoria = $2 AND is_padrao_categoria = true
           AND is_system = false`,
        [cliente_id, categoria.toLowerCase()],
      );
      if (!rows.length)
        return res.status(404).json({
          error: `Nenhum template padrão para categoria "${categoria}"`,
        });
      xmlBase = rows[0].conteudo_xml;
      templateCategoria = rows[0].categoria;
    } else {
      // Fallback: pega o padrão que o cliente definiu (qualquer categoria)
      const { rows } = await pool.query(
        `SELECT conteudo_xml, categoria FROM cliente_templates
         WHERE cliente_id = $1 AND tipo = 'recibo_venda'
           AND is_padrao_categoria = true AND is_system = false
         ORDER BY created_at ASC LIMIT 1`,
        [cliente_id],
      );
      if (!rows.length) {
        // sem template próprio → pega o de sistema bobina
        const { rows: sys } = await pool.query(
          `SELECT conteudo_xml, categoria FROM cliente_templates
           WHERE is_system = true AND tipo = 'recibo_venda'
             AND categoria = 'bobina_80mm'
           LIMIT 1`,
        );
        if (!sys.length)
          return res
            .status(404)
            .json({ error: "Nenhum template de recibo disponível" });
        xmlBase = sys[0].conteudo_xml;
        templateCategoria = sys[0].categoria;
      } else {
        xmlBase = rows[0].conteudo_xml;
        templateCategoria = rows[0].categoria;
      }
    }

    // ── 2. Busca dados da venda ─────────────────────────────────────────────
    const { rows: vendaRows } = await pool.query(
      `SELECT v.*,
              u.nome AS vendedor_nome,
              c.nome AS cliente_nome,
              c.cnpj_cpf AS cliente_cnpj_cpf,
              c.endereco AS cliente_endereco,
              c.logo_base64 AS cliente_logo,
              sc.nome AS sub_cliente_nome,
              sc.cpf_cnpj AS sub_cliente_cpf_cnpj
       FROM venda v
       JOIN usuario u ON u.id = v.usuario_id
       JOIN cliente c ON c.id = v.cliente_id
       LEFT JOIN sub_cliente sc ON sc.id = v.sub_cliente_id
       WHERE v.id = $1 AND v.cliente_id = $2`,
      [venda_id, cliente_id],
    );
    if (!vendaRows.length)
      return res.status(404).json({ error: "Venda não encontrada" });
    const venda = vendaRows[0];

    // ── 3. Busca itens da venda ─────────────────────────────────────────────
    const { rows: itens } = await pool.query(
      `SELECT vi.quantidade, vi.valor_unitario, vi.valor_total,
              p.nome AS produto_nome
       FROM venda_item vi
       JOIN produto p ON p.id = vi.produto_id
       WHERE vi.venda_id = $1
       ORDER BY vi.id ASC`,
      [venda_id],
    );

    // ── 4. Busca pagamentos ─────────────────────────────────────────────────
    let pagamentos = [];
    try {
      const { rows: pgtos } = await pool.query(
        `SELECT forma, valor FROM venda_pagamento WHERE venda_id = $1 ORDER BY id ASC`,
        [venda_id],
      );
      pagamentos = pgtos;
    } catch (_) {
      // tabela pode não existir — fallback para forma_pagamento da venda
      pagamentos = [{ forma: venda.forma_pagamento, valor: venda.valor_pago }];
    }
    if (!pagamentos.length) {
      pagamentos = [{ forma: venda.forma_pagamento, valor: venda.valor_pago }];
    }

    // ── 5. Monta os blocos dinâmicos ────────────────────────────────────────
    const isA4 = templateCategoria === "a4";

    const subtotal = Number(venda.valor_total) + Number(venda.desconto || 0);

    if (isA4) {
      xmlBase = montarReciboA4(xmlBase, venda, itens, pagamentos, subtotal);
    } else {
      xmlBase = montarReciboBobina(xmlBase, venda, itens, pagamentos, subtotal);
    }

    res.json({ zpl: xmlBase, categoria: templateCategoria });
  } catch (err) {
    console.error("[renderizarRecibo]", err);
    res.status(500).json({ error: "Erro ao renderizar recibo" });
  }
};

// ─── Montagem Bobina 80mm ─────────────────────────────────────────────────────
function montarReciboBobina(xml, venda, itens, pagamentos, subtotal) {
  const LW = 25; // largura do campo nome do item (chars)
  let y = 270;
  let itensBloco = "";

  for (const item of itens) {
    const nome = String(item.produto_nome).substring(0, LW).padEnd(LW);
    const qtd = String(item.quantidade).padStart(3);
    const unit = fmt(item.valor_unitario).padStart(7);
    const tot = fmt(item.valor_total).padStart(7);
    itensBloco += `^FO20,${y}^A0N,20,20^FD${nome} ${qtd} ${unit} ${tot}^FS\n`;
    y += 24;
  }

  const yPagamentos = y + 80;
  let pgtoBloco = "";
  let yPg = yPagamentos;
  for (const p of pagamentos) {
    pgtoBloco += `^FO20,${yPg}^A0N,20,20^FD${p.forma}: RS ${fmt(p.valor)}^FS\n`;
    yPg += 24;
  }

  // sub_cliente
  let subBloco = "";
  let ySub = yPg + 10;
  if (venda.sub_cliente_nome) {
    subBloco = `^FO20,${ySub}^A0N,20,20^FDCliente: ${venda.sub_cliente_nome}^FS\n`;
    ySub += 24;
    if (venda.sub_cliente_cpf_cnpj) {
      subBloco += `^FO20,${ySub}^A0N,20,20^FDCPF/CNPJ: ${venda.sub_cliente_cpf_cnpj}^FS\n`;
      ySub += 24;
    }
  }

  const yRodape = ySub + 16;

  return xml
    .replace("{{itens_bloco}}", itensBloco)
    .replace("{{pagamentos_bloco}}", pgtoBloco)
    .replace("{{sub_cliente_bloco}}", subBloco)
    .replace("{{y_sep1}}", String(y + 4))
    .replace("{{y_subtotal}}", String(y + 18))
    .replace("{{y_desconto}}", String(y + 42))
    .replace("{{y_total}}", String(y + 66))
    .replace("{{y_sep2}}", String(y + 100))
    .replace("{{y_troco}}", String(yPg + 4))
    .replace("{{y_sep3}}", String(yPg + 30))
    .replace("{{y_rodape}}", String(yRodape))
    .replace("{{venda.id}}", String(venda.id))
    .replace("{{venda.subtotal}}", fmt(subtotal))
    .replace("{{venda.desconto}}", fmt(venda.desconto || 0))
    .replace("{{venda.total}}", fmt(venda.valor_total))
    .replace("{{venda.troco}}", fmt(venda.troco || 0))
    .replace("{{venda.forma_pagamento}}", venda.forma_pagamento)
    .replace("{{data_hora}}", fmtDataHora(venda.created_at))
    .replace("{{vendedor.nome}}", venda.vendedor_nome)
    .replace("{{cliente.nome}}", venda.cliente_nome)
    .replace("{{cliente.cnpj_cpf}}", venda.cliente_cnpj_cpf || "")
    .replace("{{cliente.endereco}}", venda.cliente_endereco || "");
}

// ─── Montagem A4 ──────────────────────────────────────────────────────────────
function montarReciboA4(xml, venda, itens, pagamentos, subtotal) {
  // Logo: se o cliente tem logo_base64, gera bloco ^GF, senão pula
  let logoBloco = "";
  let yBase = 60;

  if (venda.cliente_logo) {
    // ^GFA,tamanho,tamanho,largura_linha,dados_hex
    // A logo deve estar em formato GRF (monocromático) — aqui usamos placeholder
    // para o desenvolvedor substituir pela conversão real da imagem
    logoBloco = `^FO60,60^GFA,3000,3000,30,${venda.cliente_logo}^FS`;
    yBase = 200; // empurra o conteúdo para baixo do logo
  }

  let y = yBase + 560; // após cabeçalho fixo
  let itensBloco = "";
  for (const item of itens) {
    const nome = String(item.produto_nome).substring(0, 38);
    itensBloco += `^FO60,${y}^A0N,28,28^FD${nome}^FS\n`;
    itensBloco += `^FO880,${y}^A0N,28,28^FD${item.quantidade}^FS\n`;
    itensBloco += `^FO1040,${y}^A0N,28,28^FDRS ${fmt(item.valor_unitario)}^FS\n`;
    itensBloco += `^FO1260,${y}^A0N,28,28^FDRS ${fmt(item.valor_total)}^FS\n`;
    y += 44;
  }

  let pgtoBloco = "";
  let yPg = y + 220; // após bloco de totais
  for (const p of pagamentos) {
    pgtoBloco += `^FO60,${yPg}^A0N,28,28^FD${p.forma}: RS ${fmt(p.valor)}^FS\n`;
    yPg += 40;
  }

  let subBloco = "";
  let ySub = yPg + 20;
  if (venda.sub_cliente_nome) {
    subBloco = `^FO60,${ySub}^A0N,28,28^FDCliente vinculado: ${venda.sub_cliente_nome}^FS\n`;
    ySub += 40;
    if (venda.sub_cliente_cpf_cnpj) {
      subBloco += `^FO60,${ySub}^A0N,28,28^FDCPF/CNPJ: ${venda.sub_cliente_cpf_cnpj}^FS\n`;
      ySub += 40;
    }
  }

  const yRodape = ySub + 40;

  // Offsets do cabeçalho fixo (relativos ao yBase)
  const yNome = yBase;
  const yCnpj = yBase + 50;
  const yEndereco = yBase + 85;
  const ySep0 = yBase + 120;
  const yTitulo = yBase + 150;
  const yData = yBase + 205;
  const yVendedor = yBase + 248;
  const ySep1 = yBase + 290;
  const yTh = yBase + 320;
  const yThSep = yBase + 356;

  return (
    xml
      .replace("{{logo_bloco}}", logoBloco)
      .replace("{{itens_bloco}}", itensBloco)
      .replace("{{pagamentos_bloco}}", pgtoBloco)
      .replace("{{sub_cliente_bloco}}", subBloco)
      // cabeçalho
      .replace("{{y_nome_cliente}}", String(yNome))
      .replace("{{y_cnpj}}", String(yCnpj))
      .replace("{{y_endereco}}", String(yEndereco))
      .replace("{{y_sep0}}", String(ySep0))
      .replace("{{y_titulo}}", String(yTitulo))
      .replace("{{y_data}}", String(yData))
      .replace("{{y_vendedor}}", String(yVendedor))
      .replace("{{y_sep1}}", String(ySep1))
      .replace("{{y_th}}", String(yTh))
      .replace("{{y_th_sep}}", String(yThSep))
      // totais (após itens)
      .replace("{{y_sep2}}", String(y + 10))
      .replace("{{y_subtotal}}", String(y + 40))
      .replace("{{y_desconto}}", String(y + 84))
      .replace("{{y_sep3}}", String(y + 118))
      .replace("{{y_total}}", String(y + 136))
      .replace("{{y_sep4}}", String(y + 194))
      .replace("{{y_pgto_title}}", String(y + 210))
      .replace("{{y_troco}}", String(yPg + 10))
      .replace("{{y_sep5}}", String(yPg + 50))
      .replace("{{y_rodape}}", String(yRodape))
      // variáveis
      .replace("{{venda.id}}", String(venda.id))
      .replace("{{venda.subtotal}}", fmt(subtotal))
      .replace("{{venda.desconto}}", fmt(venda.desconto || 0))
      .replace("{{venda.total}}", fmt(venda.valor_total))
      .replace("{{venda.troco}}", fmt(venda.troco || 0))
      .replace("{{data_hora}}", fmtDataHora(venda.created_at))
      .replace("{{vendedor.nome}}", venda.vendedor_nome)
      .replace("{{cliente.nome}}", venda.cliente_nome)
      .replace("{{cliente.cnpj_cpf}}", venda.cliente_cnpj_cpf || "")
      .replace("{{cliente.endereco}}", venda.cliente_endereco || "")
  );
}

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
        return res
          .status(404)
          .json({ error: "Nenhum template de etiqueta disponível" });
      xmlBase = tmpl[0].conteudo_xml;
    }

    // ... resto do código original (dados de cliente, venda, produtos, map) ...
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
  setPadraoCateg,
  renderizarRecibo,
  renderizarEtiqueta,
};
