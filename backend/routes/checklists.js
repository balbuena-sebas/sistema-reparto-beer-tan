const express = require('express');
const router = express.Router();
const { query } = require('../db');

// Listar checklists de una fecha (para admin)
router.get('/', async (req, res) => {
  try {
    const { fecha } = req.query;
    if (!fecha) return res.status(400).json({ error: 'Fecha requerida' });
    const result = await query(
      'SELECT * FROM checklists WHERE fecha = $1 ORDER BY creado_en DESC',
      [fecha]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Guardar un checklist (para chofer)
router.post('/', async (req, res) => {
  try {
    const { chofer, dni, fecha, estado } = req.body;
    if (!chofer || !dni || !fecha) return res.status(400).json({ error: 'Datos incompletos' });
    
    await query(
      'INSERT INTO checklists (fecha, chofer, dni, estado) VALUES ($1, $2, $3, $4)',
      [fecha, chofer, dni, estado || 'completado']
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
