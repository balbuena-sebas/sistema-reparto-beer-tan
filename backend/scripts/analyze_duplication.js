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

async function analyzeDuplication() {
  console.log('🔍 Analizando duplicación de datos entre Neon y Supabase...\n');
  
  let supabaseClient, neonClient;
  const TABLAS = ['registros', 'ausencias', 'rechazos', 'notas', 'checklists', 'foxtrot_rutas', 'foxtrot_intentos'];
  
  try {
    supabaseClient = await supabasePool.connect();
    neonClient = await neonPool.connect();

    await supabaseClient.query('SELECT 1');
    await neonClient.query('SELECT 1');
    console.log('✅ Conexiones establecidas\n');

    console.log('📊 ANÁLISIS DE DUPLICACIÓN:');
    console.log('═'.repeat(80));

    let totalSupabase = 0, totalNeon = 0;

    for (const tabla of TABLAS) {
      const countSupa = await supabaseClient.query(`SELECT COUNT(*) FROM ${tabla}`);
      const countNeon = await neonClient.query(`SELECT COUNT(*) FROM ${tabla}`);
      
      const countSupaNum = parseInt(countSupa.rows[0].count);
      const countNeonNum = parseInt(countNeon.rows[0].count);
      
      totalSupabase += countSupaNum;
      totalNeon += countNeonNum;

      console.log(`\n📋 ${tabla}:`);
      console.log(`   Supabase: ${countSupaNum} registros`);
      console.log(`   Neon:     ${countNeonNum} registros`);
      
      if (countSupaNum === countNeonNum && countSupaNum > 0) {
        console.log(`   ⚠️  DUPLICADOS: Ambas BDs tienen los mismos ${countSupaNum} registros`);
      } else if (countSupaNum > countNeonNum) {
        console.log(`   ℹ️  Supabase tiene ${countSupaNum - countNeonNum} más registros`);
      } else if (countNeonNum > countSupaNum) {
        console.log(`   ℹ️  Neon tiene ${countNeonNum - countSupaNum} más registros`);
      } else {
        console.log(`   ✅ Ambas vacías`);
      }
    }

    console.log('\n' + '═'.repeat(80));
    console.log('\n📈 RESUMEN TOTAL:');
    console.log(`   Supabase: ${totalSupabase} registros totales`);
    console.log(`   Neon:     ${totalNeon} registros totales`);
    
    if (totalSupabase === totalNeon && totalSupabase > 0) {
      console.log(`\n❌ PROBLEMA: Las 2 BDs tienen EXACTAMENTE los mismos datos`);
      console.log(`   Esto significa que estás guardando datos dos veces (duplicación)`);
      console.log(`   Espacio desperdiciado: ~${Math.round(totalSupabase * 0.001)}MB × 2`);
      console.log(`\n✅ SOLUCIÓN:`);
      console.log(`   1. Neon debe ser SOLO backup (espejo de emergencia)`);
      console.log(`   2. Supabase debe ser la BD principal (donde la app escribe)`);
      console.log(`   3. Borrar datos de Neon regularmente o hacer sincronización one-way`);
    } else {
      console.log(`\n✅ Las BDs están asincrónicas (Neon ≠ Supabase)`);
    }

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    supabaseClient?.release();
    neonClient?.release();
    await supabasePool.end();
    await neonPool.end();
  }
}

analyzeDuplication();
