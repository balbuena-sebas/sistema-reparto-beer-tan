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

// Tablas críticas que siempre deben estar sincronizadas
const TABLAS_CRITICAS = ['registros', 'ausencias', 'configuracion', 'notas', 'checklists', 'rechazos'];

// Obtener lista de tablas en una BD
async function getTables(client) {
  try {
    const result = await client.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `);
    return result.rows.map(r => r.table_name);
  } catch (err) {
    console.error('Error obteniendo tablas:', err.message);
    return [];
  }
}

// Obtener el schema de una tabla
async function getTableSchema(client, tableName) {
  try {
    const columns = await client.query(`
      SELECT column_name,
             data_type,
             is_nullable,
             column_default,
             character_maximum_length,
             numeric_precision,
             numeric_scale
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position
    `, [tableName]);

    const primaryKey = await client.query(`
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_name = kcu.table_name
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema = 'public'
        AND tc.table_name = $1
      ORDER BY kcu.ordinal_position
    `, [tableName]);

    return {
      tableName,
      columns: columns.rows,
      primaryKey: primaryKey.rows.map(r => r.column_name),
    };
  } catch (err) {
    console.error(`Error obteniendo schema de ${tableName}:`, err.message);
    return null;
  }
}

function formatColumnType(column) {
  let type = column.data_type;
  if (type === 'character varying') {
    type = column.character_maximum_length
      ? `varchar(${column.character_maximum_length})`
      : 'varchar';
  } else if (type === 'numeric') {
    if (column.numeric_precision && column.numeric_scale != null) {
      type = `numeric(${column.numeric_precision}, ${column.numeric_scale})`;
    } else if (column.numeric_precision) {
      type = `numeric(${column.numeric_precision})`;
    }
  } else if (type === 'timestamp without time zone') {
    type = 'timestamp';
  } else if (type === 'timestamp with time zone') {
    type = 'timestamptz';
  }
  return type;
}

// Crear tabla en destino basado en el schema de origen
async function createTable(sourceClient, destClient, tableName) {
  try {
    const schema = await getTableSchema(sourceClient, tableName);
    if (!schema) return false;

    const sequenceNames = new Set();
    const columnsSql = schema.columns.map((col) => {
      let colType = formatColumnType(col);
      let colDef = `"${col.column_name}" ${colType}`;
      if (col.column_default) {
        const matches = /nextval\('"?([^"']+)"?'::regclass\)/.exec(col.column_default);
        if (matches) {
          const sequenceName = matches[1];
          sequenceNames.add(sequenceName);
        }
        colDef += ` DEFAULT ${col.column_default}`;
      }
      if (col.is_nullable === 'NO') colDef += ' NOT NULL';
      return colDef;
    });

    for (const sequenceName of sequenceNames) {
      await destClient.query(`CREATE SEQUENCE IF NOT EXISTS public."${sequenceName}"`);
    }

    if (schema.primaryKey.length > 0) {
      const pk = schema.primaryKey.map((col) => `"${col}"`).join(', ');
      columnsSql.push(`PRIMARY KEY (${pk})`);
    }

    const createSQL = `CREATE TABLE IF NOT EXISTS public."${tableName}" (${columnsSql.join(', ')});`;
    await destClient.query(createSQL);

    for (const sequenceName of sequenceNames) {
      const owningColumn = schema.columns.find((col) => col.column_default && col.column_default.includes(sequenceName));
      if (owningColumn) {
        await destClient.query(
          `ALTER SEQUENCE public."${sequenceName}" OWNED BY public."${tableName}"."${owningColumn.column_name}"`
        );
      }
    }

    console.log(`  ✓ Tabla ${tableName} creada o existente en destino`);
    return true;
  } catch (err) {
    console.error(`  ⚠ Error creando tabla ${tableName}:`, err.message);
    return false;
  }
}

// Sincronizar datos de una tabla
async function syncTableData(sourceClient, destClient, tableName) {
  try {
    const destCount = await destClient.query(`SELECT COUNT(*) AS cnt FROM public."${tableName}"`);
    const destRowCount = parseInt(destCount.rows[0].cnt, 10);

    if (destRowCount > 0) {
      console.log(`  ℹ ${tableName}: ${destRowCount} registros ya existen en destino`);
      return;
    }

    const sourceData = await sourceClient.query(`SELECT * FROM public."${tableName}"`);
    if (sourceData.rows.length === 0) {
      console.log(`  ℹ ${tableName}: 0 registros en origen`);
      return;
    }

    const fieldNames = sourceData.fields.map((f) => f.name);
    const quotedColumns = fieldNames.map((name) => `"${name}"`).join(', ');
    const placeholderRow = fieldNames.map((_, idx) => `$${idx + 1}`).join(', ');
    const insertSQL = `INSERT INTO public."${tableName}" (${quotedColumns}) VALUES (${placeholderRow})`;

    const batchSize = 50;
    for (let i = 0; i < sourceData.rows.length; i += batchSize) {
      const batch = sourceData.rows.slice(i, i + batchSize);
      for (const row of batch) {
        const values = fieldNames.map((name) => row[name]);
        await destClient.query(insertSQL, values);
      }
    }

    console.log(`  ✓ ${tableName}: ${sourceData.rows.length} registros sincronizados`);
  } catch (err) {
    console.error(`  ❌ Error sincronizando datos de ${tableName}:`, err.message);
  }
}

async function syncTablesAcrossDBs() {
  let supabaseClient, neonClient;
  
  try {
    supabaseClient = await supabasePool.connect();
    neonClient = await neonPool.connect();

    // Verificar conexiones
    await supabaseClient.query('SELECT 1');
    await neonClient.query('SELECT 1');
    console.log('✅ Conexiones establecidas\n');

    // Obtener lista de tablas en ambas BDs
    const supabaseTables = await getTables(supabaseClient);
    const neonTables = await getTables(neonClient);

    console.log(`📊 Supabase tiene ${supabaseTables.length} tablas`);
    console.log(`📊 Neon tiene ${neonTables.length} tablas\n`);

    // Tablas que existen en Supabase pero no en Neon
    const tablasAFaltarEnNeon = supabaseTables.filter(t => !neonTables.includes(t));
    
    // Tablas que existen en Neon pero no en Supabase
    const tablasAFaltarEnSupabase = neonTables.filter(t => !supabaseTables.includes(t));

    console.log('─'.repeat(80));
    
    if (tablasAFaltarEnNeon.length > 0) {
      console.log(`\n🔄 Creando ${tablasAFaltarEnNeon.length} tablas en Neon que existen en Supabase:\n`);
      for (const tabla of tablasAFaltarEnNeon) {
        const created = await createTable(supabaseClient, neonClient, tabla);
        if (created) {
          await syncTableData(supabaseClient, neonClient, tabla);
        }
      }
    }

    if (tablasAFaltarEnSupabase.length > 0) {
      console.log(`\n🔄 Creando ${tablasAFaltarEnSupabase.length} tablas en Supabase que existen en Neon:\n`);
      for (const tabla of tablasAFaltarEnSupabase) {
        const created = await createTable(neonClient, supabaseClient, tabla);
        if (created) {
          await syncTableData(neonClient, supabaseClient, tabla);
        }
      }
    }

    if (tablasAFaltarEnNeon.length === 0 && tablasAFaltarEnSupabase.length === 0) {
      console.log('\n✅ Ambas BDs tienen las mismas tablas\n');
    }

    console.log('─'.repeat(80));
    console.log('\n✅ Sincronización de tablas COMPLETADA');
    console.log('   Supabase y Neon ahora tienen la misma estructura\n');

  } catch (err) {
    console.error('❌ Error crítico:', err.message);
  } finally {
    supabaseClient?.release();
    neonClient?.release();
    await supabasePool.end();
    await neonPool.end();
  }
}

// Ejecutar si se llama directamente
if (require.main === module) {
  syncTablesAcrossDBs();
}

module.exports = { syncTablesAcrossDBs };
