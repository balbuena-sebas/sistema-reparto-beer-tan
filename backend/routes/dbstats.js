const express = require('express');
const { pool } = require('../db');
const { Pool } = require('pg');
const storage = require('../storage');

const router = express.Router();

function prettyBytes(n) {
  if (n === null || n === undefined) return 'N/A';
  if (n === 0) return '0 bytes';
  const units = ['bytes','KB','MB','GB','TB'];
  let i = 0;
  let v = Number(n);
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(2)} ${units[i]}`;
}

router.get('/', async (req, res) => {
  try {
    // Supabase (pool) - tamaño de la base actual
    const supRes = await pool.query(`SELECT pg_database_size(current_database()) AS bytes, pg_size_pretty(pg_database_size(current_database())) AS pretty`);
    const supBytes = Number(supRes.rows[0]?.bytes || 0);

    // Neon (si está configurado)
    let neonInfo = null;
    if (process.env.NEON_DATABASE_URL) {
      try {
        const neonPool = new Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } });
        const r = await neonPool.query(`SELECT pg_database_size(current_database()) AS bytes, pg_size_pretty(pg_database_size(current_database())) AS pretty`);
        neonInfo = { bytes: Number(r.rows[0]?.bytes || 0), pretty: r.rows[0]?.pretty || '0 bytes' };
        await neonPool.end();
      } catch (err) {
        neonInfo = { error: err.message };
      }
    }

    // R2 usage
    const r2Usage = await storage.getUsage();

    // Top tables (opcional)
    let topTables = [];
    try {
      const t = await pool.query(`
        SELECT relname AS tabla, pg_total_relation_size(relid) AS bytes, pg_size_pretty(pg_total_relation_size(relid)) AS pretty
        FROM pg_stat_user_tables
        ORDER BY pg_total_relation_size(relid) DESC
        LIMIT 10
      `);
      topTables = t.rows.map(r => ({ tabla: r.tabla, bytes: Number(r.bytes || 0), pretty: r.pretty }));
    } catch (err) {
      // ignore
    }

    return res.json({
      ok: true,
      data: {
        supabase: { bytes: supBytes, pretty: supRes.rows[0]?.pretty || prettyBytes(supBytes) },
        neon: neonInfo,
        r2: r2Usage,
        topTables,
      },
    });
  } catch (err) {
    console.error('Error dbstats:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
