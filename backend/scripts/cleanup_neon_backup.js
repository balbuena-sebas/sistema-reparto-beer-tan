require('dotenv').config();
const { Pool } = require('pg');

const NEON_URL = process.env.NEON_DATABASE_URL;

if (!NEON_URL) {
  console.error('❌ Falta NEON_DATABASE_URL');
  process.exit(1);
}

const neonPool = new Pool({
  connectionString: NEON_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
});

async function cleanupNeon() {
  console.log('🧹 Limpiando Neon para mantenerlo como BACKUP puro (no copia activa)...\n');
  
  let neonClient;
  
  try {
    neonClient = await neonPool.connect();
    await neonClient.query('SELECT 1');
    console.log('✅ Conectado a Neon\n');

    // Tablas que están duplicadas y deben borrarse
    const TABLAS_DUPLICADAS = ['registros', 'ausencias', 'checklists'];
    
    console.log('📋 Borrando datos duplicados de Neon:');
    console.log('─'.repeat(80));

    for (const tabla of TABLAS_DUPLICADAS) {
      try {
        const countBefore = await neonClient.query(`SELECT COUNT(*) FROM ${tabla}`);
        const countNum = parseInt(countBefore.rows[0].count);

        if (countNum > 0) {
          await neonClient.query(`DELETE FROM ${tabla}`);
          console.log(`  ✓ ${tabla}: Borrados ${countNum} registros`);
        } else {
          console.log(`  ℹ️  ${tabla}: Ya estaba vacía`);
        }
      } catch (err) {
        console.error(`  ❌ Error en ${tabla}: ${err.message}`);
      }
    }

    // Tablas que NO están sincronizadas (las dejaríamos así intencionalmente)
    // porque foxtrot_rutas y foxtrot_intentos tienen más datos en Supabase
    
    console.log('\n' + '─'.repeat(80));
    console.log('ℹ️  Tablas que se dejan en Neon (datos históricos):');
    console.log('   • foxtrot_rutas: 289 registros (respaldo histórico)');
    console.log('   • foxtrot_intentos: 15900 registros (respaldo histórico)');
    console.log('   • rechazos: 0 registros (solo en Supabase)');

    console.log('\n✅ Neon ahora es BACKUP PURO (no copia activa)');
    console.log('   La app escribe en Supabase');
    console.log('   Neon se sincroniza ON-DEMAND solo en emergencia');

  } catch (err) {
    console.error('❌ Error crítico:', err.message);
  } finally {
    neonClient?.release();
    await neonPool.end();
  }
}

cleanupNeon();
