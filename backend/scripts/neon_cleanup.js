// backend/scripts/neon_cleanup.js
const { query } = require('../db');
const { actualizarKPIMensual } = require('../utils/kpi_utils');

async function realizarLimpiezaAutomatica() {
  console.log("🧹 Iniciando limpieza automática de Neon SQL...");
  
  try {
    // 1. Identificar meses a resumir (anteriores al mes pasado)
    // Queremos mantener los últimos 13-14 meses para comparaciones YoY.
    // Borraremos lo que tenga más de 15 meses de antigüedad.
    const mesesViejosRes = await query(`
      SELECT DISTINCT TO_CHAR(fecha, 'YYYY-MM') as mes 
      FROM foxtrot_rutas 
      WHERE fecha < CURRENT_DATE - INTERVAL '15 months'
      UNION
      SELECT DISTINCT TO_CHAR(fecha, 'YYYY-MM') as mes 
      FROM rechazos 
      WHERE fecha < CURRENT_DATE - INTERVAL '15 months'
    `);

    const mesesParaLimpiar = mesesViejosRes.rows.map(r => r.mes);
    
    if (mesesParaLimpiar.length === 0) {
      console.log("✅ No hay datos lo suficientemente viejos para limpiar.");
      return;
    }

    for (const mes of mesesParaLimpiar) {
      console.log(`📦 Procesando mes histórico: ${mes}...`);
      
      // Aseguramos que existan los KPIs antes de borrar nada
      // Primero obtenemos los chóferes de ese mes
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

      // Ahora borramos los detalles pesados
      console.log(`🗑 Eliminando detalle de ${mes} en Neon...`);
      await query("DELETE FROM foxtrot_intentos WHERE TO_CHAR(fecha, 'YYYY-MM') = $1", [mes]);
      await query("DELETE FROM foxtrot_rutas WHERE TO_CHAR(fecha, 'YYYY-MM') = $1", [mes]);
      await query("DELETE FROM rechazos WHERE TO_CHAR(fecha, 'YYYY-MM') = $1", [mes]);
    }

    console.log("✨ Limpieza completada con éxito.");
  } catch (err) {
    console.error("❌ Error en limpieza Neon:", err.message);
  }
}

// Ejecutar si se llama directamente
if (require.main === module) {
  realizarLimpiezaAutomatica().then(() => process.exit(0));
}

module.exports = { realizarLimpiezaAutomatica };
