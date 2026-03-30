// routes/ausencias.js — CRUD de ausencias de personal
const express = require('express');
const router  = express.Router();
const { pool, query } = require('../db');

function filaAausencia(fila) {
  return {
    id:           Number(fila.id),
    persona:      fila.persona,
    motivo:       fila.motivo || '',
    fechaDesde:   fila.fecha_desde ? fila.fecha_desde.toISOString().split('T')[0] : '',
    fechaHasta:   fila.fecha_hasta ? fila.fecha_hasta.toISOString().split('T')[0] : '',
    observaciones: fila.observaciones || '',
    dias:         fila.dias || 1,
  };
}

router.get('/', async (req, res) => {
  try {
    const { mes } = req.query;
    let sql  = 'SELECT * FROM ausencias';
    let params = [];
    if (mes) {
      sql += " WHERE TO_CHAR(fecha_desde, 'YYYY-MM') = $1";
      params  = [mes];
    }
    sql += ' ORDER BY fecha_desde DESC';
    const result = await query(sql, params);
    res.json({ ok: true, data: result.rows.map(filaAausencia) });
  } catch (err) {
    console.error('GET /ausencias:', err.message);
    res.status(500).json({ ok: false, error: 'Error al obtener ausencias' });
  }
});

router.post('/', async (req, res) => {
  try {
    const a = req.body;
    if (!a.persona)    return res.status(400).json({ ok: false, error: 'Persona es obligatoria' });
    if (!a.fechaDesde) return res.status(400).json({ ok: false, error: 'Fecha desde es obligatoria' });
    const result = await query(`
      INSERT INTO ausencias (id, persona, motivo, fecha_desde, fecha_hasta, observaciones, dias)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *
    `, [
      a.id || Date.now(),
      a.persona, a.motivo || '',
      a.fechaDesde, a.fechaHasta || a.fechaDesde,
      a.observaciones || '',
      a.dias || 1,
    ]);
    res.status(201).json({ ok: true, data: filaAausencia(result.rows[0]) });
  } catch (err) {
    console.error('POST /ausencias:', err.message);
    if (err.code === '23505') return res.status(409).json({ ok: false, error: 'ID duplicado' });
    res.status(500).json({ ok: false, error: 'Error al crear ausencia' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const a = req.body;
    const result = await query(`
      UPDATE ausencias SET
        persona=$1, motivo=$2, fecha_desde=$3, fecha_hasta=$4,
        observaciones=$5, dias=$6, updated_at=NOW()
      WHERE id=$7
      RETURNING *
    `, [
      a.persona, a.motivo || '',
      a.fechaDesde, a.fechaHasta || a.fechaDesde,
      a.observaciones || '', a.dias || 1,
      req.params.id,
    ]);
    if (result.rows.length === 0)
      return res.status(404).json({ ok: false, error: 'Ausencia no encontrada' });
    res.json({ ok: true, data: filaAausencia(result.rows[0]) });
  } catch (err) {
    console.error('PUT /ausencias:', err.message);
    res.status(500).json({ ok: false, error: 'Error al actualizar ausencia' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await query('DELETE FROM ausencias WHERE id=$1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0)
      return res.status(404).json({ ok: false, error: 'Ausencia no encontrada' });
    res.json({ ok: true, id: Number(result.rows[0].id) });
  } catch (err) {
    console.error('DELETE /ausencias:', err.message);
    res.status(500).json({ ok: false, error: 'Error al eliminar ausencia' });
  }
});

module.exports = router;
