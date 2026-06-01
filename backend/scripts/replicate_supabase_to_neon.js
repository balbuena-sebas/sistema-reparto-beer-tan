require('dotenv').config();
const { Pool } = require('pg');

const SUPABASE_URL = process.env.DATABASE_URL;
const NEON_URL = process.env.NEON_DATABASE_URL;

if (!SUPABASE_URL || !NEON_URL) {
  console.error('❌ Falta DATABASE_URL o NEON_DATABASE_URL');
  process.exit(1);
}

const supabasePool = new Pool({
  connectionString: SUPABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
});

const neonPool = new Pool({
  connectionString: NEON_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
});

async function replicateTable(supabaseClient, neonClient, tableName) {
  try {
    // Obtener datos de Supabase
    const supabaseData = await supabaseClient.query(`SELECT * FROM ${tableName}`);
    
    // Limpiar Neon primero (DELETE de todos los registros)
    await neonClient.query(`DELETE FROM ${tableName}`);
    
    // Si no hay datos en Supabase, finalizar
    if (supabaseData.rows.length === 0) {
      console.log(`  ✓ ${tableName}: 0 registros (tabla vacía)`);
      return;
    }

    // Preparar INSERT de datos de Supabase a Neon
    const columns = Object.keys(supabaseData.rows[0]);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(',');
    const columnList = columns.join(',');
    const insertSql = `INSERT INTO ${tableName} (${columnList}) VALUES (${placeholders})`;

    for (const row of supabaseData.rows) {
      const values = columns.map(col => row[col]);
      await neonClient.query(insertSql, values);
    }

    console.log(`  ✓ ${tableName}: ${supabaseData.rows.length} registros replicados`);
  } catch (err) {
    console.error(`  ❌ Error en ${tableName}:`, err.message);
  }
}

async function syncSupa2Neon() {
  console.log('🔄 Replicando tablas de Supabase → Neon (sincronización forzada)...\n');
  
  let supabaseClient, neonClient;
  // Tablas críticas y tablas pesadas que queremos replicar solo parcialmente
  const TABLAS_CRITICAS = ['registros', 'ausencias', 'configuracion', 'notas', 'checklists'];
  const TABLAS_PESADAS = ['rechazos', 'foxtrot_rutas', 'foxtrot_intentos'];
  const REPLICA_MONTHS = parseInt(process.env.NEON_REPLICA_MONTHS || '3', 10); // meses recientes a replicar para tablas pesadas
  
  try {
    supabaseClient = await supabasePool.connect();
    neonClient = await neonPool.connect();

    await supabaseClient.query('SELECT 1');
    await neonClient.query('SELECT 1');
    console.log('✅ Conexiones establecidas\n');

    console.log('📊 Replicando tablas críticas:');
    console.log('─'.repeat(80));

    for (const tabla of TABLAS_CRITICAS) {
      await replicateTable(supabaseClient, neonClient, tabla);
    }

    // Para tablas pesadas, replicamos sólo los últimos N meses para no llenar Neon
    const mesesClause = `TO_CHAR(fecha, 'YYYY-MM') >= TO_CHAR(CURRENT_DATE - INTERVAL '${REPLICA_MONTHS} months', 'YYYY-MM')`;
    for (const tabla of TABLAS_PESADAS) {
      try {
        console.log(`  ✓ ${tabla}: replicando últimos ${REPLICA_MONTHS} meses...`);
        // Obtener datos filtrados
        const supabaseData = await supabaseClient.query(`SELECT * FROM ${tabla} WHERE ${mesesClause}`);

        // Limpiar Neon primero (DELETE de registros equivalentes por mes)
        await neonClient.query(`DELETE FROM ${tabla} WHERE ${mesesClause}`);

        if (supabaseData.rows.length === 0) {
          console.log(`    ${tabla}: 0 registros en los últimos ${REPLICA_MONTHS} meses`);
          continue;
        }

        const columns = Object.keys(supabaseData.rows[0]);
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(',');
        const columnList = columns.join(',');
        const insertSql = `INSERT INTO ${tabla} (${columnList}) VALUES (${placeholders})`;
        for (const row of supabaseData.rows) {
          const values = columns.map(col => row[col]);
          await neonClient.query(insertSql, values);
        }
        console.log(`    ${tabla}: ${supabaseData.rows.length} registros replicados (recientes)`);
      } catch (err) {
        console.error(`  ❌ Error replicando tabla pesada ${tabla}:`, err.message);
      }
    }

    console.log('\n' + '─'.repeat(80));
    console.log('✅ Sincronización Supabase → Neon COMPLETADA');
    console.log('   Las tablas críticas están duplicadas en Neon como backup');

  } catch (err) {
    console.error('❌ Error crítico:', err.message);
  } finally {
    supabaseClient?.release();
    neonClient?.release();
    await supabasePool.end();
    await neonPool.end();
  }
}

if (require.main === module) {
  syncSupa2Neon();
}

module.exports = { syncSupa2Neon };
