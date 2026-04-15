// backend/scripts/diag.js — Diagnóstico de tamaño de tablas en Neon
const { pool } = require('../db');

async function diagnosticar() {
  const client = await pool.connect();
  try {
    const res = await client.query(`
      SELECT 
        relname AS tabla,
        pg_size_pretty(pg_total_relation_size(relid)) AS tamano_total,
        pg_size_pretty(pg_relation_size(relid)) AS tamano_datos,
        pg_size_pretty(pg_total_relation_size(relid) - pg_relation_size(relid)) AS tamano_indices,
        (SELECT count(*) FROM pg_class WHERE relname = relname) as existe
      FROM pg_stat_user_tables
      ORDER BY pg_total_relation_size(relid) DESC;
    `);
    
    console.log('📊 Diagnóstico de Almacenamiento Neon:');
    console.table(res.rows);

    const colsIntentos = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'foxtrot_intentos';
    `);
    console.log('\n🔍 Columnas en foxtrot_intentos:');
    console.table(colsIntentos.rows);

  } catch (err) {
    console.error('❌ Error diag:', err.message);
  } finally {
    client.release();
    process.exit();
  }
}

diagnosticar();
