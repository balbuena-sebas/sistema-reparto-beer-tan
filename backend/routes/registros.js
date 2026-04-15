// routes/registros.js — CRUD de registros de reparto
const express = require('express');
const router  = express.Router();
const { pool, query } = require('../db');
const { comprimir, descomprimirSafe } = require('../compress');

async function filaARegistro(fila) {
  const destinos = await descomprimirSafe(fila.destinos_gz, []);
  return {
    id:           Number(fila.id),
    fecha:        fila.fecha ? fila.fecha.toISOString().split('T')[0] : '',
    chofer:       fila.chofer,
    ay1:          fila.ay1 || '',
    ay2:          fila.ay2 || '',
    patente:      fila.patente || '',
    localidad:    fila.localidad || '',
    destino:      fila.destino || '',
    bultos:       fila.bultos || 0,
    costoReparto: fila.costo_reparto || 0,
    recSN:        fila.rec_sn || 'NO',
    nRecargas:    fila.n_recargas || 0,
    recCant:      fila.rec_cant || '',
    fte:          fila.fte || 1,
    bultosClark:  fila.bultos_clark || 0,
    bultosRec:    fila.bultos_rec || 0,
    destinos:     destinos || [],
    createdByDni: fila.created_by_dni || '',
    createdByNombre: fila.created_by_nombre || '',
  };
}

router.get('/', async (req, res) => {
  try {
    const { mes } = req.query;
    let sql  = 'SELECT * FROM registros';
    let params = [];
    if (mes) {
      sql += " WHERE TO_CHAR(fecha, 'YYYY-MM') = $1";
      params  = [mes];
    } else {
      // Si no hay mes, limitar a los últimos 6 meses para no saturar Neon
      sql += " WHERE fecha >= CURRENT_DATE - INTERVAL '6 months'";
    }
    sql += ' ORDER BY fecha DESC';
    const result = await query(sql, params);
    const registros = await Promise.all(result.rows.map(filaARegistro));
    res.json({ ok: true, data: registros });
  } catch (err) {
    console.error('GET /registros:', err.message);
    res.status(500).json({ ok: false, error: 'Error al obtener registros' });
  }
});

router.post('/', async (req, res) => {
  try {
    const r = req.body;
    if (!r.chofer) return res.status(400).json({ ok: false, error: 'Chofer es obligatorio' });
    if (!r.fecha)  return res.status(400).json({ ok: false, error: 'Fecha es obligatoria' });
    const destinosGz = await comprimir(r.destinos || []);
    const result = await query(`
      INSERT INTO registros
        (id, fecha, chofer, ay1, ay2, patente, localidad, destino,
         bultos, costo_reparto, rec_sn, n_recargas, rec_cant, fte,
       bultos_clark, bultos_rec, destinos_gz, created_by_dni, created_by_nombre)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      RETURNING *
    `, [
      r.id || Date.now(),
      r.fecha, r.chofer,
      r.ay1 || '', r.ay2 || '',
      r.patente || '', r.localidad || '',
      r.destino || '',
      r.bultos || 0, r.costoReparto || 0,
      r.recSN || 'NO', r.nRecargas || 0, r.recCant || '',
      r.fte || 1, r.bultosClark || 0, r.bultosRec || 0,
      destinosGz,
      r.createdByDni || '',
      r.createdByNombre || '',
    ]);
    const nuevo = await filaARegistro(result.rows[0]);
    res.status(201).json({ ok: true, data: nuevo });
  } catch (err) {
    console.error('POST /registros:', err.message);
    if (err.code === '23505') return res.status(409).json({ ok: false, error: 'ID duplicado' });
    res.status(500).json({ ok: false, error: 'Error al crear registro' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const r = req.body;
    const destinosGz = await comprimir(r.destinos || []);
    const result = await query(`
      UPDATE registros SET
        fecha=$1, chofer=$2, ay1=$3, ay2=$4, patente=$5, localidad=$6,
        destino=$7, bultos=$8, costo_reparto=$9, rec_sn=$10,
        n_recargas=$11, rec_cant=$12, fte=$13,
        bultos_clark=$14, bultos_rec=$15, destinos_gz=$16,
        created_by_dni=$17, created_by_nombre=$18,
        updated_at=NOW()
      WHERE id=$19
      RETURNING *
    `, [
      r.fecha, r.chofer,
      r.ay1 || '', r.ay2 || '',
      r.patente || '', r.localidad || '',
      r.destino || '',
      r.bultos || 0, r.costoReparto || 0,
      r.recSN || 'NO', r.nRecargas || 0, r.recCant || '',
      r.fte || 1, r.bultosClark || 0, r.bultosRec || 0,
      destinosGz, 
      r.createdByDni || '',
      r.createdByNombre || '',
      id,
    ]);
    if (result.rows.length === 0)
      return res.status(404).json({ ok: false, error: 'Registro no encontrado' });
    const actualizado = await filaARegistro(result.rows[0]);
    res.json({ ok: true, data: actualizado });
  } catch (err) {
    console.error('PUT /registros:', err.message);
    res.status(500).json({ ok: false, error: 'Error al actualizar registro' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await query('DELETE FROM registros WHERE id=$1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0)
      return res.status(404).json({ ok: false, error: 'Registro no encontrado' });
    res.json({ ok: true, id: Number(result.rows[0].id) });
  } catch (err) {
    console.error('DELETE /registros:', err.message);
    res.status(500).json({ ok: false, error: 'Error al eliminar registro' });
  }
});

module.exports = router;
