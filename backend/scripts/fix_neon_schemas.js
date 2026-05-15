require('dotenv').config();
const { Pool } = require('pg');

const NEON_URL = process.env.NEON_DATABASE_URL;

if (!NEON_URL) {
  console.error('❌ Falta NEON_DATABASE_URL en .env');
  process.exit(1);
}

const neonPool = new Pool({
  connectionString: NEON_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
});

async function fixSchemas() {
  console.log('🔧 Corrigiendo esquemas en Neon...\n');
  
  let neonClient;
  
  try {
    neonClient = await neonPool.connect();
    await neonClient.query('SELECT 1');
    console.log('✅ Conectado a Neon\n');

    // 1. Arreglar tabla registros
    console.log('📋 Arreglando tabla registros...');
    
    // Cambiar costo_reparto de integer a numeric
    try {
      await neonClient.query(`ALTER TABLE registros ALTER COLUMN costo_reparto TYPE NUMERIC`);
      console.log('  ✓ costo_reparto convertido a NUMERIC');
    } catch (err) {
      console.log(`  ⚠️  No se pudo convertir costo_reparto: ${err.message}`);
    }

    // Cambiar localidad a NOT NULL
    try {
      await neonClient.query(`ALTER TABLE registros ALTER COLUMN localidad SET NOT NULL`);
      console.log('  ✓ localidad establecido como NOT NULL');
    } catch (err) {
      console.log(`  ⚠️  No se pudo cambiar localidad: ${err.message}`);
    }

    // Agregar metadata_gz si no existe
    try {
      await neonClient.query(`ALTER TABLE registros ADD COLUMN metadata_gz BYTEA`);
      console.log('  ✓ Columna metadata_gz agregada');
    } catch (err) {
      console.log(`  ℹ️  metadata_gz ya existe`);
    }

    // 2. Arreglar tabla ausencias - renombrar observaciones a observations
    console.log('\n📋 Arreglando tabla ausencias...');
    try {
      // Verificar si existe observaciones
      const result = await neonClient.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_name = 'ausencias' AND column_name = 'observaciones'
      `);
      
      if (result.rows.length > 0) {
        // Renombrar si existe
        await neonClient.query(`ALTER TABLE ausencias RENAME COLUMN observaciones TO observations`);
        console.log('  ✓ Columna observaciones renombrada a observations');
      } else {
        console.log('  ℹ️  observations ya está correcta');
      }
    } catch (err) {
      console.log(`  ⚠️  Error al renombrar: ${err.message}`);
    }

    console.log('\n✅ Correcciones completadas en Neon');

  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  } finally {
    neonClient?.release();
    await neonPool.end();
  }
}

fixSchemas();
