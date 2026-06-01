require('dotenv').config();
const { query } = require('../db');
const storage = require('../storage');
const { realizarLimpiezaAutomatica } = require('../scripts/neon_cleanup');
const { optimizarNeon } = require('../scripts/optimize');

const SUPABASE_QUOTA_GB = parseFloat(process.env.SUPABASE_QUOTA_GB || '0.5');
const DB_DELETE_THRESHOLD_PERCENT = parseFloat(process.env.DB_DELETE_THRESHOLD_PERCENT || '80');
const AUTO_MAINTENANCE = (process.env.AUTO_MAINTENANCE || 'true') === 'true';
const MAINTENANCE_TIME = process.env.MAINTENANCE_TIME || '02:00'; // HH:MM

function msUntilNextTime(hhmm) {
  const [hh, mm] = hhmm.split(':').map(Number);
  const now = new Date();
  const next = new Date(now);
  next.setHours(hh, mm, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next - now;
}

async function checkAndRun() {
  try {
    console.log('🔎 Scheduler: comprobando uso de Supabase...');
    const res = await query(`SELECT pg_database_size(current_database()) AS bytes`);
    const usedBytes = Number(res.rows[0]?.bytes || 0);
    const quotaBytes = SUPABASE_QUOTA_GB * 1024 * 1024 * 1024;
    const pct = (usedBytes / quotaBytes) * 100;
    console.log(`ℹ Supabase uso: ${((usedBytes/1024/1024)|0)} MB, umbral: ${DB_DELETE_THRESHOLD_PERCENT}% -> ${pct.toFixed(2)}%`);

    if (pct >= DB_DELETE_THRESHOLD_PERCENT) {
      console.log(`⚠ Umbral alcanzado (${pct.toFixed(2)}%). Iniciando archivado y limpieza (ALLOW_DELETE=${process.env.ALLOW_DELETE})`);
      // Primero optimizar indices
      optimizarNeon().catch(e => console.error('❌ Error optimizarNeon:', e.message));
      // Archivar y permitir borrado si ALLOW_DELETE=true
      const allowDelete = (process.env.ALLOW_DELETE === 'true');
      await realizarLimpiezaAutomatica({ allowDelete });
      console.log('✅ Scheduler: proceso de mantenimiento finalizado.');
    } else {
      console.log('✅ Uso dentro de límites. No se ejecuta mantenimiento de borrado.');
    }
  } catch (err) {
    console.error('❌ Scheduler error:', err.message);
  }
}

function start() {
  if (!AUTO_MAINTENANCE) {
    console.log('Scheduler: AUTO_MAINTENANCE deshabilitado.');
    return;
  }

  console.log(`Scheduler: programado a las ${MAINTENANCE_TIME} (umbral ${DB_DELETE_THRESHOLD_PERCENT}%, cuota ${SUPABASE_QUOTA_GB}GB)`);
  const firstMs = msUntilNextTime(MAINTENANCE_TIME);
  setTimeout(() => {
    checkAndRun();
    setInterval(checkAndRun, 24 * 60 * 60 * 1000);
  }, firstMs);
}

module.exports = { start };
