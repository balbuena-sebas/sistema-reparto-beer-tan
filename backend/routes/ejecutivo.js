// routes/ejecutivo.js — Resumen mensual liviano para la vista ejecutiva.
// Guarda UNA fila chica por mes y localidad (clave '*' = total del mes). Se calcula desde registros,
// foxtrot y rechazos, y se conserva aunque más adelante se archiven o borren los datos diarios.
const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { descomprimirSafe } = require('../compress');

let tablaLista = false;
async function asegurarTabla() {
  if (tablaLista) return;
  await query(`
    CREATE TABLE IF NOT EXISTS ejecutivo_mensual (
      mes        TEXT NOT NULL,
      clave      TEXT NOT NULL,
      datos      JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (mes, clave)
    )`);
  tablaLista = true;
}

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const sumaMes = (mes, n) => { const [y, m] = mes.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
const mesHoy = () => new Date().toISOString().slice(0, 7);
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const vacio = () => ({ rep: 0, dias: 0, bul: 0, bol: 0, cos: 0, rec: 0, per: 0, hc: 0, ha: 0, km: 0, fx: 0, _f: new Set() });

// Calcula el resumen de un mes a partir de los datos diarios, usando las fuentes que existan
// (Registros, Foxtrot, Rechazos). Devuelve null solo si no hay ninguna.
async function calcularMes(mes) {
  const ini = `${mes}-01`;
  const fin = `${sumaMes(mes, 1)}-01`;
  const regs = (await query(
    `SELECT fecha, chofer, ay1, ay2, localidad, bultos, costo_reparto, n_recargas, destinos_gz
       FROM registros WHERE fecha >= $1::date AND fecha < $2::date`, [ini, fin])).rows;

  const fox = (await query(
    `SELECT fecha, chofer_mapeado, imported_customers, total_journey_seconds, total_driven_meters
       FROM foxtrot_rutas WHERE fecha >= $1::date AND fecha < $2::date`, [ini, fin])).rows;
  const foxMap = new Map();
  let fr = 0, fcl = 0, fseg = 0, fm = 0;
  fox.forEach((f) => {
    fr += 1; fcl += Number(f.imported_customers) || 0; fseg += Number(f.total_journey_seconds) || 0; fm += Number(f.total_driven_meters) || 0;
    if (!f.chofer_mapeado) return;
    const k = `${new Date(f.fecha).toISOString().slice(0, 10)}|${norm(f.chofer_mapeado)}`;
    const o = foxMap.get(k) || { seg: 0, m: 0 };
    o.seg += Number(f.total_journey_seconds) || 0; o.m += Number(f.total_driven_meters) || 0;
    foxMap.set(k, o);
  });
  // Si el detalle de Foxtrot ya no está, los KPI livianos por chofer lo conservan
  if (!fr) {
    const k = (await query(`SELECT datos_json FROM kpis_mensuales WHERE mes = $1 AND source = 'foxtrot'`, [mes])).rows;
    k.forEach((x) => { const d = x.datos_json || {}; fr += Number(d.rutas) || 0; fcl += Number(d.clientes_total) || 0; fm += Number(d.km_reales) || 0; });
  }

  const total = vacio();
  const porLoc = new Map();
  for (const r of regs) {
    const f = new Date(r.fecha).toISOString().slice(0, 10);
    const loc = String(r.localidad || 'Sin localidad').trim() || 'Sin localidad';
    const destinos = await descomprimirSafe(r.destinos_gz, []);
    const nAy = (String(r.ay1 || '').trim() ? 1 : 0) + (String(r.ay2 || '').trim() ? 1 : 0);
    const fx = foxMap.get(`${f}|${norm(r.chofer)}`);
    if (!porLoc.has(loc)) porLoc.set(loc, vacio());
    for (const a of [total, porLoc.get(loc)]) {
      a.rep += 1; a._f.add(f);
      a.bul += Number(r.bultos) || 0;
      a.bol += Array.isArray(destinos) ? destinos.length : 0;
      a.cos += Number(r.costo_reparto) || 0;
      a.rec += Number(r.n_recargas) || 0;
      a.per += 1 + nAy;
      if (fx) { a.hc += fx.seg; a.ha += fx.seg * nAy; a.km += fx.m / 1000; a.fx += 1; }
    }
  }
  const cierra = (a) => ({ rep: a.rep, dias: a._f.size, bul: Math.round(a.bul), bol: a.bol, cos: Math.round(a.cos), rec: a.rec, per: a.per,
    hc: Math.round(a.hc / 36) / 100, ha: Math.round(a.ha / 36) / 100, km: Math.round(a.km), fx: a.fx });   // horas con 2 decimales

  const tot = cierra(total);
  // Foxtrot del mes completo (aunque no haya registros): rutas, clientes, horas de jornada y km
  if (fr) { tot.fr = fr; tot.fcl = fcl; tot.fh = Math.round(fseg / 36) / 100; tot.fkm = Math.round(fm / 1000); }
  const out = new Map([['*', tot]]);
  porLoc.forEach((a, loc) => out.set(loc, cierra(a)));

  // Rechazos del mes (solo se guarda en el total); si el detalle ya no está, se usa el KPI liviano
  const rch = (await query(
    `SELECT COALESCE(SUM(importe_rechazado),0) AS imp, COALESCE(SUM(bultos_rechazados),0) AS bul, COUNT(*) AS n
       FROM rechazos WHERE fecha >= $1::date AND fecha < $2::date`, [ini, fin])).rows[0];
  if (Number(rch.n) > 0) tot.rch = { imp: Math.round(Number(rch.imp)), bul: Math.round(Number(rch.bul)), n: Number(rch.n) };
  else {
    const k = (await query(`SELECT datos_json FROM kpis_mensuales WHERE mes = $1 AND source = 'rechazos'`, [mes])).rows;
    if (k.length) {
      const o = { imp: 0, bul: 0, n: 0 };
      k.forEach((x) => { const d = x.datos_json || {}; o.imp += Number(d.importe_rechazado) || 0; o.bul += Number(d.bultos_rechazados) || 0; o.n += (Number(d.n_logistica) || 0) + (Number(d.n_facturacion) || 0); });
      if (o.imp || o.bul || o.n) tot.rch = { imp: Math.round(o.imp), bul: Math.round(o.bul), n: o.n };
    }
  }
  if (!regs.length && !fr && !tot.rch) return null;
  return out;
}

// Guarda el mes conservando lo que ya estaba si los datos diarios de esa parte ya no existen (archivados).
async function guardarMes(mes, nuevo) {
  const previo = new Map((await query(`SELECT clave, datos FROM ejecutivo_mensual WHERE mes = $1`, [mes])).rows.map((r) => [r.clave, r.datos]));
  for (const [clave, d] of nuevo) {
    const p = previo.get(clave);
    if (p) {
      if (!d.fx && p.fx) { d.hc = p.hc; d.ha = p.ha; d.km = p.km; d.fx = p.fx; }
      if (clave === '*' && !d.rch && p.rch) d.rch = p.rch;
      if (clave === '*' && !d.fr && p.fr) { d.fr = p.fr; d.fcl = p.fcl; d.fh = p.fh; d.fkm = p.fkm; }
      if (p.fac && !d.fac) d.fac = p.fac;                 // facturación cargada aparte: nunca se pisa
    }
    await query(
      `INSERT INTO ejecutivo_mensual (mes, clave, datos, updated_at) VALUES ($1,$2,$3,NOW())
       ON CONFLICT (mes, clave) DO UPDATE SET datos = EXCLUDED.datos, updated_at = NOW()`, [mes, clave, JSON.stringify(d)]);
  }
}

// GET /api/ejecutivo?desde=YYYY-MM&hasta=YYYY-MM[&refrescar=1]
router.get('/', async (req, res) => {
  try {
    await asegurarTabla();
    const hoy = mesHoy();
    let hasta = MES_RE.test(req.query.hasta || '') ? req.query.hasta : hoy;
    let desde = MES_RE.test(req.query.desde || '') ? req.query.desde : sumaMes(hasta, -11);
    if (desde > hasta) [desde, hasta] = [hasta, desde];
    if (sumaMes(desde, 59) < hasta) desde = sumaMes(hasta, -59);       // tope: 5 años
    const forzar = req.query.refrescar === '1';

    const guardados = new Set((await query(`SELECT DISTINCT mes FROM ejecutivo_mensual WHERE mes >= $1 AND mes <= $2`, [desde, hasta])).rows.map((r) => r.mes));
    for (let m = desde; m <= hasta; m = sumaMes(m, 1)) {
      const reciente = m >= sumaMes(hoy, -2);
      if (forzar || reciente || !guardados.has(m)) {
        const calc = await calcularMes(m);
        if (calc) await guardarMes(m, calc);
      }
    }
    const filas = (await query(`SELECT mes, clave, datos FROM ejecutivo_mensual WHERE mes >= $1 AND mes <= $2 ORDER BY mes, clave`, [desde, hasta])).rows;
    res.json({ ok: true, desde, hasta, data: filas.map((f) => ({ mes: f.mes, clave: f.clave, ...f.datos })) });
  } catch (err) {
    console.error('GET /ejecutivo:', err.message);
    res.status(500).json({ ok: false, error: 'Error al calcular el resumen ejecutivo' });
  }
});

module.exports = router;
