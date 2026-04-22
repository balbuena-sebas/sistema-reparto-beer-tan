// backend/scripts/archive_to_r2.js
const { pool, query } = require('../db');
const storage = require('../storage');

async function archivarMes(mes) {
  console.log(`📦 Iniciando archivado de mes: ${mes}...`);
  
  try {
    // 1. Obtener todos los datos detallados del mes
    const result = await query(`
      SELECT * FROM rechazos 
      WHERE TO_CHAR(fecha, 'YYYY-MM') = $1
    `, [mes]);

    if (result.rows.length === 0) {
      console.log("ℹ No hay datos para este mes.");
      return;
    }

    // 2. Subir el "Snapshot" completo a Cloudflare R2
    const fileName = `rechazos/detalle_${mes}.json`;
    const uploadResult = await storage.upload(fileName, result.rows);
    
    console.log(`✅ Detalle guardado en R2: ${uploadResult.url}`);

    // 3. (Opcional) Borrar los datos pesados de la DB y dejar solo un resumen
    // O simplemente borrar si el usuario lo prefiere.
    // Para no romper la app, vamos a "vaciar" las columnas pesadas pero dejar la fila
    // O borrar las filas y crear una sola fila de "Resumen"
    
    /* 
    await query(`
      DELETE FROM rechazos WHERE TO_CHAR(fecha, 'YYYY-MM') = $1
    `, [mes]);
    console.log(`🗑 Filas eliminadas de Neon para liberar espacio.`);
    */

    console.log("💡 El mes ha sido respaldado en R2. Ahora puedes borrarlo de Neon con seguridad.");
  } catch (err) {
    console.error("❌ Error en archivado:", err.message);
  }
}

// Ejecución manual: node archive_to_r2.js 2024-03
const mesArg = process.argv[2];
if (mesArg) {
  archivarMes(mesArg).then(() => process.exit(0));
} else {
  console.log("Uso: node archive_to_r2.js YYYY-MM");
}
