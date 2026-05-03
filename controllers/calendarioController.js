const pool = require("../db");

// ─── Listar eventos por período ───────────────────────────────────────────────
const getEventos = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  const { inicio, fim, tipo, status } = req.query;

  try {
    const conditions = ["e.cliente_id = $1"]; // ← prefixo e. corrige a ambiguidade
    const values = [cliente_id];
    let i = 2;

    if (inicio) { conditions.push(`e.data_inicio >= $${i++}`); values.push(inicio); }
    if (fim)    { conditions.push(`e.data_inicio <= $${i++}`); values.push(fim); }
    if (tipo)   { conditions.push(`e.tipo = $${i++}`);         values.push(tipo); }
    if (status) { conditions.push(`e.status = $${i++}`);       values.push(status); }

    const result = await pool.query(
      `SELECT e.*, u.nome AS usuario_nome
       FROM calendario_evento e
       LEFT JOIN usuario u ON u.id = e.usuario_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY e.data_inicio ASC`,
      values
    );
    res.json(result.rows);
  } catch (err) {
    console.error("[getEventos]", err);
    res.status(500).json({ error: "Erro ao buscar eventos" });
  }
};

// ─── Buscar evento por ID ─────────────────────────────────────────────────────
const getEventoById = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT e.*, u.nome AS usuario_nome
       FROM calendario_evento e
       LEFT JOIN usuario u ON u.id = e.usuario_id
       WHERE e.id = $1 AND e.cliente_id = $2`, // ← e. em ambas
      [id, cliente_id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "Evento não encontrado" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("[getEventoById]", err);
    res.status(500).json({ error: "Erro ao buscar evento" });
  }
};

// ─── Criar evento ─────────────────────────────────────────────────────────────
const createEvento = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  const usuario_id = req.user.id;

  const {
    titulo, descricao, tipo = "outro",
    data_inicio, data_fim, dia_todo = false,
    status = "pendente", cor = "#3b7eff", observacoes,
  } = req.body;

  if (!titulo || !data_inicio)
    return res.status(400).json({ error: "titulo e data_inicio são obrigatórios" });

  try {
    const result = await pool.query(
      `INSERT INTO calendario_evento
         (cliente_id, usuario_id, titulo, descricao, tipo,
          data_inicio, data_fim, dia_todo, status, cor, observacoes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        cliente_id, usuario_id, titulo, descricao, tipo,
        data_inicio, data_fim ?? null, dia_todo,
        status, cor, observacoes ?? null,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("[createEvento]", err);
    res.status(500).json({ error: "Erro ao criar evento" });
  }
};

// ─── Atualizar evento ─────────────────────────────────────────────────────────
const updateEvento = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  const { id } = req.params;

  const {
    titulo, descricao, tipo,
    data_inicio, data_fim, dia_todo,
    status, cor, observacoes,
  } = req.body;

  try {
    // Sem JOIN aqui — sem ambiguidade
    const { rows } = await pool.query(
      "SELECT * FROM calendario_evento WHERE id=$1 AND cliente_id=$2",
      [id, cliente_id]
    );
    if (rows.length === 0)
      return res.status(404).json({ error: "Evento não encontrado" });

    const atual = rows[0];

    const result = await pool.query(
      `UPDATE calendario_evento
       SET titulo=$1, descricao=$2, tipo=$3,
           data_inicio=$4, data_fim=$5, dia_todo=$6,
           status=$7, cor=$8, observacoes=$9
       WHERE id=$10 AND cliente_id=$11
       RETURNING *`,
      [
        titulo       ?? atual.titulo,
        descricao    ?? atual.descricao,
        tipo         ?? atual.tipo,
        data_inicio  ?? atual.data_inicio,
        data_fim     !== undefined ? data_fim : atual.data_fim,
        dia_todo     ?? atual.dia_todo,
        status       ?? atual.status,
        cor          ?? atual.cor,
        observacoes  ?? atual.observacoes,
        id,
        cliente_id,
      ]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error("[updateEvento]", err);
    res.status(500).json({ error: "Erro ao atualizar evento" });
  }
};

// ─── Atualizar só o status ────────────────────────────────────────────────────
const updateStatus = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  const { id } = req.params;
  const { status } = req.body;

  const validos = ["pendente", "confirmado", "concluido", "cancelado"];
  if (!validos.includes(status))
    return res.status(400).json({ error: "Status inválido" });

  try {
    const result = await pool.query(
      `UPDATE calendario_evento SET status=$1
       WHERE id=$2 AND cliente_id=$3 RETURNING *`,
      [status, id, cliente_id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "Evento não encontrado" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("[updateStatus]", err);
    res.status(500).json({ error: "Erro ao atualizar status" });
  }
};

// ─── Deletar evento ───────────────────────────────────────────────────────────
const deleteEvento = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  const { id } = req.params;

  try {
    const result = await pool.query(
      "DELETE FROM calendario_evento WHERE id=$1 AND cliente_id=$2 RETURNING id",
      [id, cliente_id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "Evento não encontrado" });
    res.json({ message: "Evento removido", id: result.rows[0].id });
  } catch (err) {
    console.error("[deleteEvento]", err);
    res.status(500).json({ error: "Erro ao remover evento" });
  }
};

// ─── Próximos eventos ─────────────────────────────────────────────────────────
const getProximos = async (req, res) => {
  const cliente_id = req.user.cliente_id;
  const limite = parseInt(req.query.limite) || 5;

  try {
    const result = await pool.query(
      `SELECT * FROM calendario_evento
       WHERE cliente_id=$1
         AND data_inicio >= NOW()
         AND status NOT IN ('concluido', 'cancelado')
       ORDER BY data_inicio ASC
       LIMIT $2`,
      [cliente_id, limite]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("[getProximos]", err);
    res.status(500).json({ error: "Erro ao buscar próximos eventos" });
  }
};

module.exports = {
  getEventos,
  getEventoById,
  createEvento,
  updateEvento,
  updateStatus,
  deleteEvento,
  getProximos,
};