// routes/notas.js — CRUD de notas por persona y mes
const express = require('express');
const router  = express.Router();
const { pool, query } = require('../db');
const { comprimir, descomprimirSafe } = require('../compress');

async function filaNota(f) {
  let meta = {};
  if (f.metadata_gz) {
    meta = await descomprimirSafe(f.metadata_gz, {});
  }
  return {
    id:        Number(f.id),
    persona:   f.persona,
    mes:       f.mes,           // 'YYYY-MM'
    fecha:     f.fecha ? new Date(f.fecha).toISOString().split('T')[0] : null,
    categoria: f.categoria,
    texto:     meta.txt || f.texto || '',
    prioridad: f.prioridad || 'normal',   // normal | urgente
    estado:    f.estado || 'activa',      // activa | resuelta | eliminada
    creadoEn:  f.creado_en,
    updatedAt: f.updated_at,
  };
}

// GET /api/notas — filtrar por mes (requerido) y/o persona
router.get('/', async (req, res) => {
  try {
    const { mes, persona, estado } = req.query;
    let q = `SELECT * FROM notas WHERE estado != 'eliminada'`;
    const params = [];
    let i = 1;
    if (mes)     { q += ` AND mes = $${i++}`;                    params.push(mes); }
    if (persona) { q += ` AND persona ILIKE $${i++}`;            params.push(`%${persona}%`); }
    if (estado)  { q += ` AND estado = $${i++}`;                 params.push(estado); }
    q += ' ORDER BY creado_en DESC';
    const result = await query(q, params);
    const data = [];
    for (const r of result.rows) {
      data.push(await filaNota(r));
    }
    res.json({ ok: true, data });
  } catch (err) {
    if (err.message.includes('does not exist')) return res.json({ ok: true, data: [] });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/notas
router.post('/', async (req, res) => {
  try {
    const { persona, mes, fecha, categoria, texto, prioridad } = req.body;
    if (!persona) return res.status(400).json({ ok: false, error: 'Persona es obligatoria' });
    if (!texto)   return res.status(400).json({ ok: false, error: 'Texto es obligatorio' });
    const gz = await comprimir({ txt: texto });
    const result = await query(`
      INSERT INTO notas (persona, mes, fecha, categoria, texto, prioridad, estado, metadata_gz)
      VALUES ($1, $2, $3, $4, '(comprimido)', $5, 'activa', $6)
      RETURNING *
    `, [
      persona,
      mes || new Date().toISOString().slice(0, 7),
      fecha || new Date().toISOString().split('T')[0],
      categoria || 'Nota libre',
      prioridad || 'normal',
      gz
    ]);
    res.status(201).json({ ok: true, data: await filaNota(result.rows[0]) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PUT /api/notas/:id — editar o cambiar estado
router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ ok: false, error: 'ID inválido' });
  try {
    const { persona, mes, fecha, categoria, texto, prioridad, estado } = req.body;
    let gz = null;
    if (texto) gz = await comprimir({ txt: texto });
    
    const result = await query(`
      UPDATE notas SET
        persona   = COALESCE($1, persona),
        mes       = COALESCE($2, mes),
        fecha     = COALESCE($3, fecha),
        categoria = COALESCE($4, categoria),
        texto     = COALESCE($5, texto),
        prioridad = COALESCE($6, prioridad),
        estado    = COALESCE($7, estado),
        metadata_gz = COALESCE($8, metadata_gz),
        updated_at = NOW()
      WHERE id = $9
      RETURNING *
    `, [persona, mes, fecha, categoria, texto ? '(comprimido)' : null, prioridad, estado, gz, id]);
    if (result.rowCount === 0) return res.status(404).json({ ok: false, error: 'Nota no encontrada' });
    res.json({ ok: true, data: await filaNota(result.rows[0]) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /api/notas/:id — eliminación física
router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ ok: false, error: 'ID inválido' });
  try {
    await query('DELETE FROM notas WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;