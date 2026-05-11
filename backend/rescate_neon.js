require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const zlib = require('zlib');
const { promisify } = require('util');

const gzip = promisify(zlib.gzip);
const dbUrl = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;

const TABLES = [
  'registros',
  'ausencias',
  'rechazos',
  'notas',
  'checklists',
  'foxtrot_rutas',
  'foxtrot_intentos',
  'configuracion',
  'kpis_mensuales',
];

async function exportTable(client, tableName) {
  const { rows } = await client.query(`SELECT * FROM ${tableName}`);
  const filename = `${tableName}_rescatado_${Date.now()}.json.gz`;
  const payload = JSON.stringify(rows, (key, value) => {
    if (Buffer.isBuffer(value)) {
      return { __type: 'Buffer', data: value.toString('base64') };
    }
    return value;
  }, 2);

  const compressed = await gzip(Buffer.from(payload, 'utf8'));
  fs.writeFileSync(filename, compressed);
  console.log(`✅ Exportado ${rows.length} filas de ${tableName} → ${filename}`);
}

async function rescatar() {
  if (!dbUrl) {
    console.error('❌ Falta la variable de entorno DATABASE_URL o NEON_DATABASE_URL');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  const args = process.argv.slice(2);
  const tables = args.length > 0 ? args : TABLES;

  try {
    console.log('🔗 Intentando conectar a Neon para rescate...');
    await pool.query('SELECT 1');

    for (const table of tables) {
      try {
        await exportTable(pool, table);
      } catch (err) {
        console.error(`⚠️ No se pudo exportar ${table}:`, err.message);
      }
    }

    console.log('✅ Exportación completa. Revisa los archivos .json.gz generados.');
  } catch (err) {
    console.error('❌ ERROR CRÍTICO: Neon bloqueó la conexión por completo.');
    console.error('Mensaje de Neon:', err.message);
  } finally {
    await pool.end();
  }
}

rescatar();
