// backend/scripts/optimize.js — Comprime datos antiguos en Neon para ahorrar Storage
const { pool, query } = require('../db');
const { comprimir } = require('../compress');

async function optimizarNeon() {
  console.log('🚀 Iniciando optimización de almacenamiento en Neon...');
  const client = await pool.connect();
  
  try {
    // 1. COMPRIMIR REGISTROS ANTIGUOS QUE NO TENGAN destinos_gz (si existen)
    // No hay mucho que hacer aquí ya que destinos_gz es el estándar ahora.

    // 2. COMPRIMIR FOXTROT_INTENTOS (La tabla más pesada)
    // Agrupamos datos de meses pasados que aún no estén optimizados
    const resultIntentos = await client.query(`
      SELECT * FROM foxtrot_intentos 
      WHERE metadata_gz IS NULL 
      AND fecha < CURRENT_DATE - INTERVAL '1 month'
      LIMIT 1000
    `);

    console.log(`📦 Procesando ${resultIntentos.rows.length} intentos antiguos...`);
    
    for (const row of resultIntentos.rows) {
      // Guardamos columnas pesadas en un objeto para comprimir
      const metadata = {
        cn: row.customer_name,
        lc: row.location_confidence,
        ts: row.visit_start_ts,
        vd: row.visit_duration_secs,
        vm: row.visit_meters_from_cust,
        as: row.aggregate_visit_status,
        sa: row.sequence_adherence_status,
        sd: row.suspicious_drive_by,
        is: row.inferred_service_secs,
        ar: row.archivo,
        dn: row.dc_name
      };

      const gz = await comprimir(metadata);
      
      await client.query(`
        UPDATE foxtrot_intentos SET 
          metadata_gz = $1,
          customer_name = '(comprimido)',
          dc_name = '',
          archivo = '',
          visit_start_ts = NULL
        WHERE id = $2
      `, [gz, row.id]);
    }

    // 3. COMPRIMIR RECHAZOS ANTIGUOS
    const resultRechazos = await client.query(`
      SELECT * FROM rechazos 
      WHERE metadata_gz IS NULL 
      AND fecha < CURRENT_DATE - INTERVAL '1 month'
      LIMIT 1000
    `);

    console.log(`📦 Procesando ${resultRechazos.rows.length} rechazos antiguos...`);

    for (const row of resultRechazos.rows) {
      const metadata = {
        art: row.articulo,
        ard: row.articulo_desc,
        md:  row.motivo_desc,
        cd:  row.cliente_desc,
        dom: row.domicilio,
        cad: row.canal_desc,
        chd: row.chofer_desc,
        rud: row.ruta_desc
      };

      const gz = await comprimir(metadata);

      await client.query(`
        UPDATE rechazos SET 
          metadata_gz = $1,
          articulo_desc = '(comprimido)',
          cliente_desc = '(comprimido)',
          domicilio = '',
          ruta_desc = ''
        WHERE id = $2
      `, [gz, row.id]);
    }

    console.log('✅ Optimización completada. Neon debería empezar a bajar el uso de Storage pronto.');
    
  } catch (err) {
    console.error('❌ Error en optimización:', err.message);
  } finally {
    client.release();
  }
}

module.exports = { optimizarNeon };
