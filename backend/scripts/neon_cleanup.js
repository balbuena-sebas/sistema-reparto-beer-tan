const { query } = require('../db');
const { actualizarKPIMensual } = require('../utils/kpi_utils');
const storage = require('../storage');

async function realizarLimpiezaAutomatica() {
  console.log("🧹 Iniciando limpieza y traslado a R2...");
  
  try {
    // 1. Identificar meses a archivar (más de 2 meses de antigüedad)
    // Dejamos los últimos 2 meses en Supabase para máxima velocidad.
    const mesesViejosRes = await query(`
      SELECT DISTINCT TO_CHAR(fecha, 'YYYY-MM') as mes 
      FROM foxtrot_rutas 
      WHERE fecha < CURRENT_DATE - INTERVAL '2 months'
      UNION
      SELECT DISTINCT TO_CHAR(fecha, 'YYYY-MM') as mes 
      FROM rechazos 
      WHERE fecha < CURRENT_DATE - INTERVAL '2 months'
    `);

    const mesesParaArchivar = mesesViejosRes.rows.map(r => r.mes).filter(Boolean);
    
    if (mesesParaArchivar.length === 0) {
      console.log("✅ No hay datos viejos para archivar.");
      return;
    }

    for (const mes of mesesParaArchivar) {
      console.log(`📦 Archivando mes histórico: ${mes}...`);
      
      // A. Asegurar KPIs en Supabase
      const choferes = await query(`
         SELECT DISTINCT chofer_mapeado as chofer FROM foxtrot_rutas WHERE TO_CHAR(fecha, 'YYYY-MM') = $1
         UNION
         SELECT DISTINCT chofer_desc as chofer FROM rechazos WHERE TO_CHAR(fecha, 'YYYY-MM') = $1
      `, [mes]);

      for (const c of choferes.rows) {
        if (!c.chofer) continue;
        await actualizarKPIMensual(mes, c.chofer, 'foxtrot');
        await actualizarKPIMensual(mes, c.chofer, 'rechazos');
      }

      // B. Respaldar detalle completo en R2 antes de borrar
      const detalleRechazos = await query("SELECT * FROM rechazos WHERE TO_CHAR(fecha, 'YYYY-MM') = $1", [mes]);
      if (detalleRechazos.rows.length > 0) {
        await storage.upload(`rechazos/detalle_${mes}.json`, detalleRechazos.rows);
      }

      const detalleFoxtrot = await query("SELECT * FROM foxtrot_rutas WHERE TO_CHAR(fecha, 'YYYY-MM') = $1", [mes]);
      if (detalleFoxtrot.rows.length > 0) {
        await storage.upload(`foxtrot/detalle_${mes}.json`, detalleFoxtrot.rows);
      }

      // C. BORRAR de Supabase para liberar espacio real
      console.log(`🗑 Liberando espacio: Borrando detalle de ${mes} de Supabase...`);
      await query("DELETE FROM foxtrot_intentos WHERE TO_CHAR(fecha, 'YYYY-MM') = $1", [mes]);
      await query("DELETE FROM foxtrot_rutas WHERE TO_CHAR(fecha, 'YYYY-MM') = $1", [mes]);
      await query("DELETE FROM rechazos WHERE TO_CHAR(fecha, 'YYYY-MM') = $1", [mes]);
    }

    console.log("✨ Traslado a R2 completado. Supabase está limpio.");
  } catch (err) {
    console.error("❌ Error en traslado R2:", err.message);
  }
}

module.exports = { realizarLimpiezaAutomatica };
