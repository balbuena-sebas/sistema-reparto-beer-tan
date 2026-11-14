// routes/ruteo.js — Simulación de reparto: romaneo por día + pedidos en vivo.
// Módulo AISLADO: crea sus propias tablas (IF NOT EXISTS) y no toca las existentes.
// Livianos por diseño: 1 fila por día (romaneo, comprimido) y 1 fila única que
// se SOBRESCRIBE (pedidos vigentes). Nada se acumula.
const express = require('express');
const router  = express.Router();
const { query } = require('../db');
const { comprimir, descomprimirSafe } = require('../compress');

const MAX_DIA_BYTES     = 1.5 * 1024 * 1024; // romaneo de un día
const MAX_PEDIDOS_BYTES = 600 * 1024;        // pedidos vigentes
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

let schemaPromise = null;
function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await query(`
        CREATE TABLE IF NOT EXISTS ruteo_dias (
          fecha       DATE PRIMARY KEY,
          paradas     INTEGER DEFAULT 0,
          bultos      NUMERIC DEFAULT 0,
          datos_gz    BYTEA,
          updated_at  TIMESTAMPTZ DEFAULT NOW(),
          updated_by  TEXT DEFAULT ''
        )`);
      await query(`
        CREATE TABLE IF NOT EXISTS sim_estado (
          clave       TEXT PRIMARY KEY,
          version     BIGINT DEFAULT 0,
          datos_gz    BYTEA,
          updated_at  TIMESTAMPTZ DEFAULT NOW(),
          updated_by  TEXT DEFAULT ''
        )`);
    })().catch((e) => { schemaPromise = null; throw e; });
  }
  return schemaPromise;
}

const quien = (req) => String(req.headers['x-user-name'] || '').slice(0, 60);
const sizeOf = (obj) => Buffer.byteLength(JSON.stringify(obj), 'utf8');

// ── SSE: clientes conectados ────────────────────────────────────────────────
const clientes = new Set();
function difundir(evento, payload) {
  const msg = `event: ${evento}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clientes) {
    try { res.write(msg); if (res.flush) res.flush(); } catch { clientes.delete(res); }
  }
}

// ── Romaneo por día ─────────────────────────────────────────────────────────
// Lista liviana para pintar el calendario (sin descomprimir nada)
router.get('/dias', async (req, res) => {
  try {
    await ensureSchema();
    const r = await query(
      `SELECT TO_CHAR(fecha,'YYYY-MM-DD') AS fecha, paradas, bultos
         FROM ruteo_dias ORDER BY fecha DESC LIMIT 800`);
    res.json({ ok: true, data: r.rows.map((x) => ({
      fecha: x.fecha, paradas: Number(x.paradas) || 0, bultos: Number(x.bultos) || 0 })) });
  } catch (err) {
    console.error('GET /ruteo/dias:', err.message);
    res.status(500).json({ ok: false, error: 'Error al listar días' });
  }
});

router.get('/dia/:fecha', async (req, res) => {
  try {
    const { fecha } = req.params;
    if (!FECHA_RE.test(fecha)) return res.status(400).json({ ok: false, error: 'Fecha inválida' });
    await ensureSchema();
    const r = await query('SELECT datos_gz, updated_at FROM ruteo_dias WHERE fecha = $1', [fecha]);
    if (!r.rows.length) return res.json({ ok: true, data: null });
    const datos = await descomprimirSafe(r.rows[0].datos_gz, null);
    res.set('Cache-Control', 'private, max-age=60');
    res.json({ ok: true, data: datos, updatedAt: r.rows[0].updated_at });
  } catch (err) {
    console.error('GET /ruteo/dia:', err.message);
    res.status(500).json({ ok: false, error: 'Error al obtener el día' });
  }
});

// Body: { paradas: [...], resumen: { paradas, bultos } }  (reemplaza el día completo)
router.put('/dia/:fecha', async (req, res) => {
  try {
    const { fecha } = req.params;
    if (!FECHA_RE.test(fecha)) return res.status(400).json({ ok: false, error: 'Fecha inválida' });
    const body = req.body || {};
    if (!Array.isArray(body.paradas) || body.paradas.length > 3000)
      return res.status(400).json({ ok: false, error: 'Paradas inválidas' });
    if (sizeOf(body) > MAX_DIA_BYTES)
      return res.status(413).json({ ok: false, error: 'Día demasiado grande' });
    await ensureSchema();
    const gz = await comprimir(body);
    const resumen = body.resumen || {};
    await query(
      `INSERT INTO ruteo_dias (fecha, paradas, bultos, datos_gz, updated_at, updated_by)
       VALUES ($1,$2,$3,$4,NOW(),$5)
       ON CONFLICT (fecha) DO UPDATE SET paradas=$2, bultos=$3, datos_gz=$4,
         updated_at=NOW(), updated_by=$5`,
      [fecha, Number(resumen.paradas) || body.paradas.length, Number(resumen.bultos) || 0, gz, quien(req)]);
    difundir('dia', { fecha });
    res.json({ ok: true });
  } catch (err) {
    console.error('PUT /ruteo/dia:', err.message);
    res.status(500).json({ ok: false, error: 'Error al guardar el día' });
  }
});

// ── Pedidos vigentes (fila única, se sobrescribe) ───────────────────────────
router.get('/pedidos', async (req, res) => {
  try {
    await ensureSchema();
    const r = await query(
      `SELECT version, datos_gz, updated_at, updated_by FROM sim_estado WHERE clave = 'pedidos'`);
    if (!r.rows.length) return res.json({ ok: true, version: 0, data: null });
    const f = r.rows[0];
    const etag = `"p${f.version}"`;
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    const datos = await descomprimirSafe(f.datos_gz, null);
    res.set('ETag', etag);
    res.json({ ok: true, version: Number(f.version), updatedAt: f.updated_at,
               updatedBy: f.updated_by, data: datos });
  } catch (err) {
    console.error('GET /ruteo/pedidos:', err.message);
    res.status(500).json({ ok: false, error: 'Error al obtener pedidos' });
  }
});

// Body: { fechaEntrega, archivo, clientes: [{c, b, p, ...}] }
router.put('/pedidos', async (req, res) => {
  try {
    const body = req.body || {};
    if (!Array.isArray(body.clientes) || body.clientes.length > 5000)
      return res.status(400).json({ ok: false, error: 'Pedidos inválidos' });
    if (sizeOf(body) > MAX_PEDIDOS_BYTES)
      return res.status(413).json({ ok: false, error: 'Archivo de pedidos demasiado grande' });
    await ensureSchema();
    const gz = await comprimir(body);
    const r = await query(
      `INSERT INTO sim_estado (clave, version, datos_gz, updated_at, updated_by)
       VALUES ('pedidos', 1, $1, NOW(), $2)
       ON CONFLICT (clave) DO UPDATE SET version = sim_estado.version + 1,
         datos_gz=$1, updated_at=NOW(), updated_by=$2
       RETURNING version`, [gz, quien(req)]);
    const version = Number(r.rows[0].version);
    difundir('pedidos', { version, updatedBy: quien(req) });
    res.json({ ok: true, version });
  } catch (err) {
    console.error('PUT /ruteo/pedidos:', err.message);
    res.status(500).json({ ok: false, error: 'Error al guardar pedidos' });
  }
});

// ── Tiempo real (Server-Sent Events) ────────────────────────────────────────
router.get('/stream', (req, res) => {
  if (clientes.size >= 50) return res.status(503).end();
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write(`retry: 5000\nevent: hola\ndata: {}\n\n`);
  if (res.flush) res.flush();
  clientes.add(res);
  const hb = setInterval(() => {
    try { res.write(': hb\n\n'); if (res.flush) res.flush(); } catch { /* cierre */ }
  }, 25000);
  req.on('close', () => { clearInterval(hb); clientes.delete(res); });
});

module.exports = router;
