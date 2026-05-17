// routes/filtros.js — Obtener filtros dinámicos desde la BD (no hardcodeados)
const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { descomprimirSafe } = require('../compress');

// GET /api/filtros — Obtiene todos los filtros dinámicos desde la BD
router.get('/', async (req, res) => {
  try {
    // Obtener configuración que contiene los filtros
    const cfgResult = await query('SELECT * FROM configuracion WHERE id = 1');
    const cfg = cfgResult.rows[0];

    if (!cfg) {
      return res.json({ 
        ok: true, 
        data: {
          choferes: [],
          ayudantes: [],
          patentes: [],
          localidades: [],
          destinos: [],
          motivosAusencia: [],
          usuarios: [],
          mensaje: 'La configuración no ha sido inicializada. Crea registros en la BD.'
        }
      });
    }

    // Descomprimir los datos que están en listas_gz
    const listas = await descomprimirSafe(cfg.listas_gz, {});

    return res.json({
      ok: true,
      data: {
        choferes: listas.choferes || [],
        ayudantes: listas.ayudantes || [],
        patentes: listas.patentes || [],
        localidades: listas.localidades || [],
        destinos: listas.destinos || [],
        motivosAusencia: listas.motivosAusencia || [],
        usuarios: listas.usuarios || [],
        operarios: listas.operarios || [],
        driverMap: await descomprimirSafe(cfg.driver_map_gz, []),
        empresa: cfg.empresa,
        costoChofer: cfg.costo_chofer,
        costoAyudante: cfg.costo_ayudante,
        costoOperario: cfg.costo_operario,
        objTandil: cfg.obj_tandil,
        objFlores: cfg.obj_flores,
        alertaRecargas: cfg.alerta_recargas,
      }
    });
  } catch (err) {
    console.error('GET /filtros:', err.message);
    res.status(500).json({ 
      ok: false, 
      error: 'Error al obtener filtros dinámicos',
      message: err.message
    });
  }
});

// GET /api/filtros/choferes — Solo choferes (para autocompletado)
router.get('/choferes', async (req, res) => {
  try {
    const cfgResult = await query('SELECT listas_gz FROM configuracion WHERE id = 1');
    const cfg = cfgResult.rows[0];
    const listas = await descomprimirSafe(cfg?.listas_gz, {});
    res.json({ ok: true, data: listas.choferes || [] });
  } catch (err) {
    console.error('GET /filtros/choferes:', err.message);
    res.status(500).json({ ok: false, error: 'Error al obtener choferes' });
  }
});

// GET /api/filtros/localidades — Solo localidades
router.get('/localidades', async (req, res) => {
  try {
    const cfgResult = await query('SELECT listas_gz FROM configuracion WHERE id = 1');
    const cfg = cfgResult.rows[0];
    const listas = await descomprimirSafe(cfg?.listas_gz, {});
    res.json({ ok: true, data: listas.localidades || [] });
  } catch (err) {
    console.error('GET /filtros/localidades:', err.message);
    res.status(500).json({ ok: false, error: 'Error al obtener localidades' });
  }
});

// GET /api/filtros/destinos — Solo destinos
router.get('/destinos', async (req, res) => {
  try {
    const cfgResult = await query('SELECT listas_gz FROM configuracion WHERE id = 1');
    const cfg = cfgResult.rows[0];
    const listas = await descomprimirSafe(cfg?.listas_gz, {});
    res.json({ ok: true, data: listas.destinos || [] });
  } catch (err) {
    console.error('GET /filtros/destinos:', err.message);
    res.status(500).json({ ok: false, error: 'Error al obtener destinos' });
  }
});

// GET /api/filtros/patentes — Solo patentes
router.get('/patentes', async (req, res) => {
  try {
    const cfgResult = await query('SELECT listas_gz FROM configuracion WHERE id = 1');
    const cfg = cfgResult.rows[0];
    const listas = await descomprimirSafe(cfg?.listas_gz, {});
    res.json({ ok: true, data: listas.patentes || [] });
  } catch (err) {
    console.error('GET /filtros/patentes:', err.message);
    res.status(500).json({ ok: false, error: 'Error al obtener patentes' });
  }
});

module.exports = router;
