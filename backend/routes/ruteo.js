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

// ── Ubicaciones de clientes (maestra liviana: código, lat, lon, nombre, localidad) ──
// Una sola fila; el PUT FUSIONA por código (no acumula duplicados).
const MAX_UBIC_BYTES = 3 * 1024 * 1024;
router.get('/ubicaciones', async (req, res) => {
  try {
    await ensureSchema();
    const r = await query(`SELECT version, datos_gz, updated_at, updated_by FROM sim_estado WHERE clave = 'ubicaciones'`);
    if (!r.rows.length) return res.json({ ok: true, version: 0, data: [] });
    const f = r.rows[0];
    const etag = `"u${f.version}"`;
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    res.set('ETag', etag);
    res.json({ ok: true, version: Number(f.version), updatedAt: f.updated_at, updatedBy: f.updated_by,
               data: await descomprimirSafe(f.datos_gz, []) });
  } catch (err) {
    console.error('GET /ruteo/ubicaciones:', err.message);
    res.status(500).json({ ok: false, error: 'Error al obtener ubicaciones' });
  }
});

router.put('/ubicaciones', async (req, res) => {
  try {
    // reemplazar=true (maestra nueva): la maestra vieja se descarta y queda solo la nueva.
    // Sin reemplazar (posiciones aprendidas de un romaneo): se fusiona por código y NO se pisan
    // el nombre ni la localidad ya conocidos con valores vacíos.
    const { items, reemplazar } = req.body || {};
    if (!Array.isArray(items) || !items.length || items.length > 30000)
      return res.status(400).json({ ok: false, error: 'Ubicaciones inválidas' });
    await ensureSchema();
    const mapa = new Map();
    if (reemplazar !== true) {
      const prev = await query(`SELECT datos_gz FROM sim_estado WHERE clave = 'ubicaciones'`);
      for (const it of (prev.rows.length ? await descomprimirSafe(prev.rows[0].datos_gz, []) : [])) mapa.set(it[0], it);
    }
    for (const it of items) {
      if (!Array.isArray(it) || !Number.isFinite(it[0]) || !Number.isFinite(it[1]) || !Number.isFinite(it[2])) continue;
      const ant = mapa.get(it[0]) || [];
      mapa.set(it[0], [it[0], it[1], it[2], String(it[3] || ant[3] || '').slice(0, 60), String(it[4] || ant[4] || '').slice(0, 40)]);
    }
    if (!mapa.size) return res.status(400).json({ ok: false, error: 'Ubicaciones inválidas' });
    const all = [...mapa.values()];
    if (sizeOf(all) > MAX_UBIC_BYTES) return res.status(413).json({ ok: false, error: 'Demasiadas ubicaciones' });
    const gz = await comprimir(all);
    const r = await query(
      `INSERT INTO sim_estado (clave, version, datos_gz, updated_at, updated_by)
       VALUES ('ubicaciones', 1, $1, NOW(), $2)
       ON CONFLICT (clave) DO UPDATE SET version = sim_estado.version + 1,
         datos_gz=$1, updated_at=NOW(), updated_by=$2
       RETURNING version`, [gz, quien(req)]);
    difundir('ubicaciones', { version: Number(r.rows[0].version) });
    res.json({ ok: true, total: all.length, version: Number(r.rows[0].version) });
  } catch (err) {
    console.error('PUT /ruteo/ubicaciones:', err.message);
    res.status(500).json({ ok: false, error: 'Error al guardar ubicaciones' });
  }
});

// ── Asignación de choferes del día (quién vino y quién cubre qué zona) ──────
// Fila única y chica: { fecha, ausentes:[nombre], cubre:{ chofer: choferCuyaZonaCubre }, manual:{ clienteAncla: chofer } }
const MAX_ASIG_BYTES = 100 * 1024;
router.get('/asignacion', async (req, res) => {
  try {
    await ensureSchema();
    const r = await query(`SELECT version, datos_gz, updated_at, updated_by FROM sim_estado WHERE clave = 'asignacion'`);
    if (!r.rows.length) return res.json({ ok: true, version: 0, data: null });
    const f = r.rows[0];
    res.json({ ok: true, version: Number(f.version), updatedAt: f.updated_at, updatedBy: f.updated_by,
               data: await descomprimirSafe(f.datos_gz, null) });
  } catch (err) {
    console.error('GET /ruteo/asignacion:', err.message);
    res.status(500).json({ ok: false, error: 'Error al obtener la asignación' });
  }
});

router.put('/asignacion', async (req, res) => {
  try {
    const b = req.body || {};
    if (!FECHA_RE.test(String(b.fecha || '')) || !Array.isArray(b.ausentes) || typeof b.cubre !== 'object' || b.cubre === null)
      return res.status(400).json({ ok: false, error: 'Asignación inválida' });
    const limpio = {
      fecha: b.fecha,
      ausentes: b.ausentes.map((x) => String(x).slice(0, 60)).slice(0, 80),
      cubre: Object.fromEntries(Object.entries(b.cubre).slice(0, 80).map(([k, v]) => [String(k).slice(0, 60), String(v).slice(0, 60)])),
      // localidades que NO salen ese día (quedan fuera de la simulación)
      excluidas: (Array.isArray(b.excluidas) ? b.excluidas : []).map((x) => String(x).slice(0, 40)).slice(0, 80),
      // camiones fijados a mano por localidad: { LOCALIDAD: n }
      camionesLoc: Object.fromEntries(Object.entries(b.camionesLoc && typeof b.camionesLoc === 'object' ? b.camionesLoc : {}).slice(0, 80)
        .map(([k, v]) => [String(k).slice(0, 40).toUpperCase(), Math.floor(Number(v)) || 0]).filter(([, v]) => v >= 1 && v <= 20)),
      // reparto editado a mano: camiones con sus clientes y orden, y clientes que quedan para otro día
      plan: (() => {
        const p = b.plan; if (!p || typeof p !== 'object' || !Array.isArray(p.camiones)) return null;
        const nums = (a) => (Array.isArray(a) ? a : []).map(Number).filter(Number.isFinite).slice(0, 3000);
        return {
          camiones: p.camiones.slice(0, 40).map((t) => ({ id: Math.floor(Number(t && t.id)) || 0, cods: nums(t && t.cods), orden: !!(t && t.orden), chofer: t && t.chofer ? String(t.chofer).slice(0, 60) : null })).filter((t) => t.id > 0),
          pend: nums(p.pend),
        };
      })(),
      // elección manual de chofer por ruta: { códigoDeClienteAncla: chofer }
      manual: Object.fromEntries(Object.entries(b.manual && typeof b.manual === 'object' ? b.manual : {}).slice(0, 80)
        .map(([k, v]) => [String(k).slice(0, 20), String(v).slice(0, 60)])),
    };
    if (sizeOf(limpio) > MAX_ASIG_BYTES) return res.status(413).json({ ok: false, error: 'Asignación demasiado grande' });
    await ensureSchema();
    const gz = await comprimir(limpio);
    const r = await query(
      `INSERT INTO sim_estado (clave, version, datos_gz, updated_at, updated_by)
       VALUES ('asignacion', 1, $1, NOW(), $2)
       ON CONFLICT (clave) DO UPDATE SET version = sim_estado.version + 1,
         datos_gz=$1, updated_at=NOW(), updated_by=$2
       RETURNING version`, [gz, quien(req)]);
    difundir('asignacion', { version: Number(r.rows[0].version), updatedBy: quien(req) });
    res.json({ ok: true, version: Number(r.rows[0].version) });
  } catch (err) {
    console.error('PUT /ruteo/asignacion:', err.message);
    res.status(500).json({ ok: false, error: 'Error al guardar la asignación' });
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

// ── Precios de gasoil en surtidor (Secretaría de Energía, Res. 314/2016) ───────
// Se descarga el CSV oficial de "vigentes" desde el servidor, se filtra la zona y se
// guarda en memoria unas horas. Si falla, el front sigue con los precios del Excel.
const URL_PRECIOS = process.env.PRECIOS_SURTIDOR_URL ||
  'http://datos.energia.gob.ar/dataset/1c181390-5045-475e-94dc-410429be4b17/resource/80ac25de-a44a-4445-9215-090cf55cfda5/download/precios-en-surtidor-resolucin-3142016.csv';
const LOCALIDADES_PRECIO = (process.env.PRECIOS_LOCALIDADES || 'TANDIL').split(',').map((x) => x.trim().toUpperCase());
// Si una marca no declaró precio reciente en Tandil se usa la zona (igual que la hoja PreciosSE del Excel).
const LOCALIDADES_ZONA = (process.env.PRECIOS_ZONA || 'AZUL,OLAVARRIA,BENITO JUAREZ,RAUCH,LAS FLORES,AYACUCHO,BALCARCE,NECOCHEA,TRES ARROYOS,LOBERIA').split(',').map((x) => x.trim().toUpperCase());
let cachePrecios = { t: 0, data: null };

function partirCsv(linea) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (q) { if (c === '"') { if (linea[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur); return out;
}
const sinTildes = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

// Devuelve, por marca, el precio del gasoil (grado 2 y 3) en las localidades pedidas.
function resumirPrecios(texto) {
  const lineas = texto.split(/\r?\n/);
  const cab = partirCsv(lineas[0]).map((h) => sinTildes(h).toLowerCase());
  const ix = (n) => cab.indexOf(n);
  const iProd = ix('producto'), iPrecio = ix('precio'), iFecha = ix('fecha_vigencia'), iLoc = ix('localidad'),
    iBand = ix('empresabandera'), iHor = ix('tipohorario');
  if ([iProd, iPrecio, iLoc, iBand].some((i) => i < 0)) throw new Error('Columnas inesperadas en el CSV de Energía');
  const grupos = {};
  for (let k = 1; k < lineas.length; k++) {
    if (!lineas[k]) continue;
    const f = partirCsv(lineas[k]);
    const loc = sinTildes(f[iLoc]);
    const local = LOCALIDADES_PRECIO.includes(loc);
    if (!local && !LOCALIDADES_ZONA.includes(loc)) continue;
    const prod = sinTildes(f[iProd]);
    if (!prod.includes('GAS OIL')) continue;
    if (iHor >= 0 && sinTildes(f[iHor]).includes('NOCT')) continue;      // solo horario diurno
    const precio = parseFloat(f[iPrecio]); if (!(precio > 0)) continue;
    const marca = sinTildes(f[iBand]);
    const grado = prod.includes('GRADO 3') ? 'premium' : 'comun';
    const fecha = String(f[iFecha] || '').slice(0, 10);
    ((grupos[marca] = grupos[marca] || {})[grado] = grupos[marca][grado] || []).push({ precio, fecha, local });
  }
  const res = [];
  for (const [marca, g] of Object.entries(grupos)) {
    const fila = { marca };
    for (const grado of ['comun', 'premium']) {
      const todos = g[grado]; if (!todos) continue;
      const ult = (a) => a.map((x) => x.fecha).sort().pop() || '';
      const loc = todos.filter((x) => x.local), zona = todos.filter((x) => !x.local);
      // Tandil si declaró hace poco (≤21 días de diferencia con la zona); si no, la zona.
      const dias = (a, b) => (new Date(a) - new Date(b)) / 864e5;
      const usaLocal = loc.length && (!zona.length || dias(ult(zona), ult(loc)) <= 21);
      const arr = usaLocal ? loc : zona;
      const ps = arr.map((x) => x.precio).sort((a, b) => a - b);
      fila[grado] = { precio: ps[Math.floor(ps.length / 2)], min: ps[0], max: ps[ps.length - 1], estaciones: ps.length, origen: usaLocal ? 'Tandil' : 'zona',
        fecha: arr.map((x) => x.fecha).sort().pop() };
    }
    res.push(fila);
  }
  return res;
}

// Fuente principal: API pública y gratuita de naftas.com.ar (datos de la Secretaría de Energía ya
// depurados, con YPF/Shell/Axion/Puma por ciudad y fecha de vigencia). Sin clave.
const URL_NAFTAS = process.env.NAFTAS_API_URL || 'https://naftas.com.ar/api/fuel';
const CIUDAD_PRECIO = (process.env.PRECIOS_CIUDAD || 'TANDIL').toUpperCase();
const PREMIUM = /(INFINIA|V-?POWER|QUANTIUM|(^|\s)ION\s|ULTRA|(^|\s)MAX\s|PREMIUM)/i;
function resumirNaftas(json) {
  const ciudad = json && (json[CIUDAD_PRECIO] || Object.values(json)[0]);
  if (!ciudad || !ciudad.empresas) throw new Error('Respuesta inesperada de naftas.com.ar');
  const marcas = [];
  for (const [empresa, prods] of Object.entries(ciudad.empresas)) {
    const diesel = Object.entries(prods).filter(([n, d]) => /DIESEL|GASOIL/i.test(n) && !/GNC/i.test(n) && d && d.precio > 0);
    const mejor = (lista) => {
      if (!lista.length) return null;
      const [nombre, d] = lista.sort((a, b) => a[1].precio - b[1].precio)[0];
      return { precio: d.precio, min: d.precio, max: d.precio, estaciones: 1, origen: 'Tandil', fecha: String(d.fecha_vigencia || '').slice(0, 10), producto: nombre };
    };
    const fila = { marca: empresa.toUpperCase() };
    const comun = mejor(diesel.filter(([n]) => !PREMIUM.test(n))), premium = mejor(diesel.filter(([n]) => PREMIUM.test(n)));
    if (comun) fila.comun = comun;
    if (premium) fila.premium = premium;
    if (comun || premium) marcas.push(fila);
  }
  return marcas;
}
router.resumirNaftas = resumirNaftas;

const claveMarca = (m) => (/SHELL/.test(m) ? 'SHELL' : /AXION/.test(m) ? 'AXION' : /YPF/.test(m) ? 'YPF' : /PUMA/.test(m) ? 'PUMA' : m);
// Une las dos fuentes: por marca queda el precio con la fecha de vigencia más reciente
// (si empatan, el de Tandil antes que el de la zona, y naftas.com.ar antes que el CSV).
function combinarPrecios(listas) {
  const mejor = new Map();
  for (const { fuente, marcas } of listas) {
    for (const m of marcas) {
      const k = claveMarca(m.marca);
      const fila = mejor.get(k) || { marca: k };
      for (const grado of ['comun', 'premium']) {
        const g = m[grado]; if (!g) continue;
        const a = fila[grado];
        if (!a || g.fecha > a.fecha || (g.fecha === a.fecha && g.origen === 'Tandil' && a.origen !== 'Tandil')) fila[grado] = { ...g, fuente };
      }
      mejor.set(k, fila);
    }
  }
  return [...mejor.values()];
}
router.combinarPrecios = combinarPrecios;

// Lee las dos fuentes en paralelo; si una falla se sigue con la otra.
async function leerPrecios() {
  const nafta = (async () => {
    const r = await fetch(`${URL_NAFTAS}?city=${encodeURIComponent(CIUDAD_PRECIO)}`, { signal: AbortSignal.timeout(20000), headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error(`naftas.com.ar respondió ${r.status}`);
    return { fuente: 'naftas.com.ar', marcas: resumirNaftas(await r.json()) };
  })();
  const energia = (async () => {
    const r = await fetch(URL_PRECIOS, { signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error(`Energía respondió ${r.status}`);
    return { fuente: 'Energía (CSV oficial)', marcas: resumirPrecios(await r.text()) };
  })();
  const res = await Promise.allSettled([nafta, energia]);
  const ok = res.filter((x) => x.status === 'fulfilled').map((x) => x.value);
  const fallas = res.filter((x) => x.status === 'rejected').map((x) => x.reason.message);
  if (fallas.length) console.error('precios combustible:', fallas.join(' | '));
  if (!ok.length) throw new Error(fallas.join(' | '));
  return { marcas: combinarPrecios(ok), fuentes: ok.map((x) => x.fuente), fallas };
}

router.get('/combustible', async (req, res) => {
  try {
    const forzar = req.query.refrescar === '1';
    if (!forzar && cachePrecios.data && Date.now() - cachePrecios.t < 6 * 3600 * 1000) return res.json({ ok: true, data: cachePrecios.data, cache: true });
    const data = { ...(await leerPrecios()), obtenido: new Date().toISOString() };
    if (!data.marcas.length) throw new Error('Sin precios de gasoil para la zona');
    cachePrecios = { t: Date.now(), data };
    res.json({ ok: true, data });
  } catch (e) {
    if (cachePrecios.data) return res.json({ ok: true, data: cachePrecios.data, cache: true, aviso: e.message });
    res.status(502).json({ ok: false, error: `No se pudo leer el precio oficial: ${e.message}` });
  }
});
router.resumirPrecios = resumirPrecios;

module.exports = router;
