// backend/scripts/optimize.js — Compactador Universal para Neon
const { pool, query } = require('../db');
const { comprimir } = require('../compress');

async function optimizarNeon() {
  console.log('🚀 Iniciando Compactación Universal en Neon...');
  let client;
  try {
    client = await pool.connect();
    
    // 1. FOXTROT_INTENTOS
    const resultIntentos = await client.query('SELECT * FROM foxtrot_intentos WHERE metadata_gz IS NULL LIMIT 2000');
    console.log(`📦 Procesando ${resultIntentos.rows.length} intentos Foxtrot...`);
    for (const r of resultIntentos.rows) {
      const gz = await comprimir({ cn: r.customer_name, lc: r.location_confidence, ts: r.visit_start_ts, as: r.aggregate_visit_status, sa: r.sequence_adherence_status });
      await client.query('UPDATE foxtrot_intentos SET metadata_gz = $1, customer_name = \'(comprimido)\', location_confidence = \'\', visit_start_ts = NULL WHERE id = $2', [gz, r.id]);
    }

    // 2. RECHAZOS
    const resultRechazos = await client.query('SELECT * FROM rechazos WHERE metadata_gz IS NULL LIMIT 2000');
    console.log(`📦 Procesando ${resultRechazos.rows.length} rechazos...`);
    for (const r of resultRechazos.rows) {
      const gz = await comprimir({ ad: r.articulo_desc, md: r.motivo_desc, cd: r.cliente_desc, dm: r.domicilio, rd: r.ruta_desc });
      await client.query('UPDATE rechazos SET metadata_gz = $1, articulo_desc = \'(comprimido)\', motivo_desc = \'(comprimido)\', cliente_desc = \'(comprimido)\', domicilio = \'\', ruta_desc = \'\' WHERE id = $2', [gz, r.id]);
    }

    // 3. NOTAS
    const resultNotas = await client.query('SELECT * FROM notas WHERE metadata_gz IS NULL LIMIT 500');
    console.log(`📦 Procesando ${resultNotas.rows.length} notas...`);
    for (const r of resultNotas.rows) {
      const gz = await comprimir({ txt: r.texto });
      await client.query('UPDATE notas SET metadata_gz = $1, texto = \'(comprimido)\' WHERE id = $2', [gz, r.id]);
    }

    // 4. FOXTROT_RUTAS
    const resultRutas = await client.query('SELECT * FROM foxtrot_rutas WHERE metadata_gz IS NULL LIMIT 500');
    console.log(`📦 Procesando ${resultRutas.rows.length} rutas Foxtrot...`);
    for (const r of resultRutas.rows) {
      const gz = await comprimir({ r_id: r.route_id, r_name: r.route_name, d_name: r.driver_name });
      await client.query('UPDATE foxtrot_rutas SET metadata_gz = $1 WHERE id = $2', [gz, r.id]);
    }

    console.log('✅ Compactación completada.');
  } catch (err) {
    console.error('❌ Error en compactación:', err.message);
  } finally {
    if (client) client.release();
  }
}

// Exportar para usar en el servidor sin que se ejecute solo
module.exports = { optimizarNeon };

// Permitir ejecución manual desde consola
if (require.main === module) {
  optimizarNeon().then(() => process.exit(0));
}
