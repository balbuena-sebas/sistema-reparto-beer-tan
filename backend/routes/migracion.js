// routes/migracion.js — Importa datos del localStorage a Neon de una sola vez
const express = require('express');
const router  = express.Router();
const { pool } = require('../db');
const { comprimir } = require('../compress');

// POST /api/migracion — Recibe { regs, aus, cfg } del frontend y los guarda todos
router.post('/', async (req, res) => {
  const { regs = [], aus = [], cfg = null } = req.body;

  if (!Array.isArray(regs) || !Array.isArray(aus)) {
    return res.status(400).json({ ok: false, error: 'Formato inválido. Se esperan arrays regs y aus.' });
  }

  const client = await pool.connect();
  const resultado = { regsOk: 0, regsFail: 0, ausOk: 0, ausFail: 0, cfgOk: false, errores: [] };

  try {
    await client.query('BEGIN');

    // ── Migrar registros ────────────────────────────────────────────────────
    for (const r of regs) {
      try {
        const destinosGz = await comprimir(r.destinos || []);
        await client.query(`
          INSERT INTO registros
            (id, fecha, chofer, ay1, ay2, patente, localidad, destino,
             bultos, costo_reparto, rec_sn, n_recargas, rec_cant, fte,
             bultos_clark, bultos_rec, destinos_gz)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
          ON CONFLICT (id) DO UPDATE SET
            fecha=EXCLUDED.fecha, chofer=EXCLUDED.chofer,
            bultos=EXCLUDED.bultos, costo_reparto=EXCLUDED.costo_reparto,
            destinos_gz=EXCLUDED.destinos_gz, updated_at=NOW()
        `, [
          r.id || Date.now() + Math.random(),
          r.fecha, r.chofer || '',
          r.ay1 || '', r.ay2 || '',
          r.patente || '', r.localidad || '',
          r.destino || '',
          r.bultos || 0, r.costoReparto || 0,
          r.recSN || 'NO', r.nRecargas || 0, r.recCant || '',
          r.fte || 1, r.bultosClark || 0, r.bultosRec || 0,
          destinosGz,
        ]);
        resultado.regsOk++;
      } catch (err) {
        resultado.regsFail++;
        resultado.errores.push(`Registro ${r.id}: ${err.message}`);
      }
    }

    // ── Migrar ausencias ────────────────────────────────────────────────────
    for (const a of aus) {
      try {
        await client.query(`
          INSERT INTO ausencias (id, persona, motivo, fecha_desde, fecha_hasta, observaciones, dias)
          VALUES ($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT (id) DO UPDATE SET
            persona=EXCLUDED.persona, motivo=EXCLUDED.motivo,
            fecha_desde=EXCLUDED.fecha_desde, updated_at=NOW()
        `, [
          a.id || Date.now() + Math.random(),
          a.persona || '', a.motivo || '',
          a.fechaDesde, a.fechaHasta || a.fechaDesde,
          a.observaciones || '', a.dias || 1,
        ]);
        resultado.ausOk++;
      } catch (err) {
        resultado.ausFail++;
        resultado.errores.push(`Ausencia ${a.id}: ${err.message}`);
      }
    }

    // ── Migrar configuración ────────────────────────────────────────────────
    if (cfg) {
      try {
        const listasGz = await comprimir({
          choferes:        cfg.choferes        || [],
          ayudantes:       cfg.ayudantes       || [],
          patentes:        cfg.patentes        || [],
          localidades:     cfg.localidades     || [],
          destinos:        cfg.destinos        || [],
          motivosAusencia: cfg.motivosAusencia || [],
        });
        const driverMapGz = await comprimir(cfg.driverMap || []);

        await client.query(`
          UPDATE configuracion SET
            empresa=$1, costo_chofer=$2, costo_ayudante=$3,
            obj_tandil=$4, obj_flores=$5,
            param1=$6, param2=$7, param3=$8,
            alerta_recargas=$9, listas_gz=$10, driver_map_gz=$11,
            updated_at=NOW()
          WHERE id=1
        `, [
          cfg.empresa || '',
          cfg.costoChofer || 0, cfg.costoAyudante || 0,
          cfg.objTandil || 0, cfg.objFlores || 0,
          cfg.param1 || 0, cfg.param2 || 0, cfg.param3 || 0,
          cfg.alertaRecargas || 10,
          listasGz, driverMapGz,
        ]);
        resultado.cfgOk = true;
      } catch (err) {
        resultado.errores.push(`Config: ${err.message}`);
      }
    }

    await client.query('COMMIT');
    console.log(`Migración: ${resultado.regsOk} regs, ${resultado.ausOk} aus, cfg=${resultado.cfgOk}`);
    res.json({ ok: true, resultado });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error en migración:', err.message);
    res.status(500).json({ ok: false, error: 'Error en la migración: ' + err.message });
  } finally {
    client.release();
  }
});

module.exports = router;