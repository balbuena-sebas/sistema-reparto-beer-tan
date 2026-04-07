// routes/config.js — Leer y guardar configuración del sistema
const express = require('express');
const router  = express.Router();
const { pool } = require('../db');
const { comprimir, descomprimirSafe } = require('../compress');

const CFG_DEFAULT = {
  empresa:             '',
  costoChofer:         0,
  costoAyudante:       0,
  costoOperarioChofer:  0,
  costoOperarioAyudante: 0,
  objTandil:           0,
  objFlores:           0,
  param1:              0,
  param2:              0,
  param3:              0,
  alertaRecargas:      10,
  choferes:            [],
  ayudantes:           [],
  patentes:            [],
  localidades:         [],
  destinos:            [],
  motivosAusencia:     [],
  operarios:           [],
  driverMap:           [],
  diasNoTrabajados:    [],
  bultosTotal:         0,
  bultosPorTransporte: {},
  bultosPorChofer:     {},
  bultosXMes:          {},
  personasNotas:       [],
  usuarios:            [],
  paramXMes:           {},   // { 'YYYY-MM': { objTandil, objFlores, costoChofer, costoAyudante, alertaRecargas } }
};

async function filaACfg(fila) {
  if (!fila) return { ...CFG_DEFAULT };
  try {
    const listas           = await descomprimirSafe(fila.listas_gz,    {});
    const driverMap        = await descomprimirSafe(fila.driver_map_gz, []);
    const diasNoTrabajados = await descomprimirSafe(fila.dias_no_gz, []);
    return {
      empresa:             fila.empresa         || '',
      costoChofer:         fila.costo_chofer     || 0,
      costoAyudante:       fila.costo_ayudante   || 0,
      costoOperarioChofer:  fila.costo_operario   || 0,
      costoOperarioAyudante: fila.costo_operario_ayudante || 0,
      costoTemporada:      fila.costo_temporada     || 0,
      objTandil:           fila.obj_tandil       || 0,
      objFlores:           fila.obj_flores       || 0,
      param1:              fila.param1           || 0,
      param2:              fila.param2           || 0,
      param3:              fila.param3           || 0,
      alertaRecargas:      fila.alerta_recargas  || 10,
      choferes:            listas.choferes        || [],
      ayudantes:           listas.ayudantes       || [],
      temporada:           listas.temporada       || [],
      patentes:            listas.patentes        || [],
      localidades:         listas.localidades     || [],
      destinos:            listas.destinos        || [],
      motivosAusencia:     listas.motivosAusencia || [],
      operarios:           listas.operarios       || [],
      driverMap:           Array.isArray(driverMap) ? driverMap : [],
      diasNoTrabajados:    Array.isArray(diasNoTrabajados) ? diasNoTrabajados : [],
      bultosTotal:         listas.bultosTotal         || 0,
      bultosPorTransporte: listas.bultosPorTransporte || {},
      bultosPorChofer:     listas.bultosPorChofer     || {},
      bultosXMes:          (listas.bultosXMes && typeof listas.bultosXMes === 'object')
                             ? listas.bultosXMes : {},
      personasNotas:       Array.isArray(listas.personasNotas) ? listas.personasNotas : [],
      usuarios:           Array.isArray(listas.usuarios) ? listas.usuarios : [],
      paramXMes:           (listas.paramXMes && typeof listas.paramXMes === 'object') ? listas.paramXMes : {},
      updatedAt:           fila.updated_at,
    };
  } catch (err) {
    console.error('filaACfg error:', err.message);
    return { ...CFG_DEFAULT };
  }
}

router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM configuracion WHERE id=1');
    const cfg = await filaACfg(result.rows[0] || null);
    res.json({ ok: true, data: cfg });
  } catch (err) {
    console.error('GET /config:', err.message);
    res.json({ ok: true, data: { ...CFG_DEFAULT } });
  }
});

router.put('/', async (req, res) => {
  try {
    const c = req.body || {};

    const listasGz = await comprimir({
      choferes:            Array.isArray(c.choferes)        ? c.choferes        : [],
      ayudantes:           Array.isArray(c.ayudantes)       ? c.ayudantes       : [],
      patentes:            Array.isArray(c.patentes)        ? c.patentes        : [],
      localidades:         Array.isArray(c.localidades)     ? c.localidades     : [],
      destinos:            Array.isArray(c.destinos)        ? c.destinos        : [],
      motivosAusencia:     Array.isArray(c.motivosAusencia) ? c.motivosAusencia : [],
      operarios:           Array.isArray(c.operarios)       ? c.operarios       : [],
      bultosTotal:         Number(c.bultosTotal) || 0,
      bultosPorTransporte: (c.bultosPorTransporte && typeof c.bultosPorTransporte === 'object')
                             ? c.bultosPorTransporte : {},
      bultosPorChofer:     (c.bultosPorChofer && typeof c.bultosPorChofer === 'object')
                             ? c.bultosPorChofer : {},
      bultosXMes:          (c.bultosXMes && typeof c.bultosXMes === 'object')
                             ? c.bultosXMes : {},
      personasNotas:       Array.isArray(c.personasNotas) ? c.personasNotas : [],
      usuarios:            Array.isArray(c.usuarios) ? c.usuarios : [],
      paramXMes:           (c.paramXMes && typeof c.paramXMes === 'object') ? c.paramXMes : {},
      temporada:           Array.isArray(c.temporada) ? c.temporada : [],
    });

    const driverMapGz = await comprimir(Array.isArray(c.driverMap) ? c.driverMap : []);
    const diasNoGz    = await comprimir(Array.isArray(c.diasNoTrabajados) ? c.diasNoTrabajados : []);

    const result = await pool.query(`
      INSERT INTO configuracion
        (id, empresa, costo_chofer, costo_ayudante, costo_operario, costo_operario_ayudante, costo_temporada,
         obj_tandil, obj_flores,
         param1, param2, param3, alerta_recargas,
         listas_gz, driver_map_gz, dias_no_gz, updated_at)
      VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
      ON CONFLICT (id) DO UPDATE SET
        empresa         = EXCLUDED.empresa,
        costo_chofer    = EXCLUDED.costo_chofer,
        costo_ayudante  = EXCLUDED.costo_ayudante,
        costo_operario  = EXCLUDED.costo_operario,
        costo_operario_ayudante = EXCLUDED.costo_operario_ayudante,
        costo_temporada = EXCLUDED.costo_temporada,
        obj_tandil      = EXCLUDED.obj_tandil,
        obj_flores      = EXCLUDED.obj_flores,
        param1          = EXCLUDED.param1,
        param2          = EXCLUDED.param2,
        param3          = EXCLUDED.param3,
        alerta_recargas = EXCLUDED.alerta_recargas,
        listas_gz       = EXCLUDED.listas_gz,
        driver_map_gz   = EXCLUDED.driver_map_gz,
        dias_no_gz      = EXCLUDED.dias_no_gz,
        updated_at      = NOW()
      RETURNING *
    `, [
      c.empresa        || '',
      c.costoChofer    || 0,
      c.costoAyudante  || 0,
      c.costoOperarioChofer || 0,
      c.costoOperarioAyudante || 0,
      c.costoTemporada || 0,
      c.objTandil      || 0,
      c.objFlores      || 0,
      c.param1         || 0,
      c.param2         || 0,
      c.param3         || 0,
      c.alertaRecargas || 10,
      listasGz,
      driverMapGz,
      diasNoGz,
    ]);

    const cfg = await filaACfg(result.rows[0]);
    res.json({ ok: true, data: cfg });
  } catch (err) {
    console.error('PUT /config:', err.message);
    res.status(500).json({ ok: false, error: 'Error al guardar configuración: ' + err.message });
  }
});

module.exports = router;