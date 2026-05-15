require('dotenv').config();
const { Pool } = require('pg');

const NEON_URL = process.env.NEON_DATABASE_URL;
const SUPABASE_URL = process.env.DATABASE_URL;

if (!NEON_URL || !SUPABASE_URL) {
  console.error('❌ Falta NEON_DATABASE_URL o DATABASE_URL en .env');
  process.exit(1);
}

const neonPool = new Pool({
  connectionString: NEON_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
});

const supabasePool = new Pool({
  connectionString: SUPABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
});

async function getTableSchema(client, tableName) {
  const result = await client.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns 
    WHERE table_name = $1
    ORDER BY ordinal_position
  `, [tableName]);
  return result.rows;
}

async function compareSchemas() {
  console.log('🔍 Verificando esquemas de Neon vs Supabase...\n');
  
  let neonClient, supabaseClient;
  const TABLAS = ['registros', 'ausencias', 'configuracion', 'rechazos', 'notas', 'checklists', 'foxtrot_rutas', 'foxtrot_intentos'];
  
  try {
    neonClient = await neonPool.connect();
    supabaseClient = await supabasePool.connect();

    // Verificar conexiones
    await neonClient.query('SELECT 1');
    await supabaseClient.query('SELECT 1');
    console.log('✅ Conexiones establecidas\n');

    let todosIguales = true;

    for (const tabla of TABLAS) {
      console.log(`📋 Tabla: ${tabla}`);
      console.log('─'.repeat(80));

      try {
        const neonSchema = await getTableSchema(neonClient, tabla);
        const supabaseSchema = await getTableSchema(supabaseClient, tabla);

        if (neonSchema.length === 0) {
          console.log(`  ⚠️  NO EXISTE en Neon`);
          todosIguales = false;
          console.log('');
          continue;
        }

        if (supabaseSchema.length === 0) {
          console.log(`  ⚠️  NO EXISTE en Supabase`);
          todosIguales = false;
          console.log('');
          continue;
        }

        // Comparar cantidad de columnas
        if (neonSchema.length !== supabaseSchema.length) {
          console.log(`  ❌ DIFERENCIA: Neon tiene ${neonSchema.length} columnas, Supabase tiene ${supabaseSchema.length}`);
          todosIguales = false;
        } else {
          console.log(`  ✅ Ambas tienen ${neonSchema.length} columnas`);
        }

        // Comparar cada columna
        let columnasIguales = true;
        const neonMap = {};
        const supabaseMap = {};

        neonSchema.forEach(col => {
          neonMap[col.column_name] = `${col.data_type}${col.is_nullable === 'NO' ? ' NOT NULL' : ''}`;
        });

        supabaseSchema.forEach(col => {
          supabaseMap[col.column_name] = `${col.data_type}${col.is_nullable === 'NO' ? ' NOT NULL' : ''}`;
        });

        // Revisar columnas
        const todosNeon = Object.keys(neonMap);
        const todosSupa = Object.keys(supabaseMap);

        for (const col of todosNeon) {
          if (!supabaseMap[col]) {
            console.log(`  ❌ COLUMNA FALTANTE en Supabase: ${col}`);
            columnasIguales = false;
            todosIguales = false;
          } else if (neonMap[col] !== supabaseMap[col]) {
            console.log(`  ❌ TIPO DIFERENTE en ${col}:`);
            console.log(`     Neon:     ${neonMap[col]}`);
            console.log(`     Supabase: ${supabaseMap[col]}`);
            columnasIguales = false;
            todosIguales = false;
          }
        }

        for (const col of todosSupa) {
          if (!neonMap[col]) {
            console.log(`  ❌ COLUMNA EXTRA en Supabase: ${col}`);
            columnasIguales = false;
            todosIguales = false;
          }
        }

        if (columnasIguales) {
          console.log(`  ✅ Esquema IDÉNTICO`);
          
          // Contar filas
          const countNeon = await neonClient.query(`SELECT COUNT(*) FROM ${tabla}`);
          const countSupabase = await supabaseClient.query(`SELECT COUNT(*) FROM ${tabla}`);
          const neonRows = parseInt(countNeon.rows[0].count);
          const supabaseRows = parseInt(countSupabase.rows[0].count);
          
          console.log(`  📊 Neon: ${neonRows} filas | Supabase: ${supabaseRows} filas`);
          
          if (neonRows === supabaseRows) {
            console.log(`  ✅ Cantidad de datos SINCRONIZADA`);
          } else {
            console.log(`  ⚠️  DIFERENCIA en cantidad de datos`);
          }
        }

      } catch (err) {
        console.log(`  ❌ Error al leer tabla: ${err.message}`);
        todosIguales = false;
      }

      console.log('');
    }

    // Resumen final
    console.log('═'.repeat(80));
    if (todosIguales) {
      console.log('✅ TODAS LAS TABLAS ESTÁN SINCRONIZADAS - La base de datos está lista para producción');
    } else {
      console.log('❌ HAY DIFERENCIAS - Revisa los errores anteriores');
    }
    console.log('═'.repeat(80));

  } catch (err) {
    console.error('❌ Error crítico:', err.message);
    process.exit(1);
  } finally {
    neonClient?.release();
    supabaseClient?.release();
    await neonPool.end();
    await supabasePool.end();
  }
}

compareSchemas();
