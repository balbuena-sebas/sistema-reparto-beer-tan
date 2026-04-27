require('dotenv').config();
const { query } = require('../db');

async function cleanupEmptyKPIs() {
  console.log("🧹 Limpiando KPIs mensuales sin datos o huérfanos...");
  try {
    // 1. Eliminar los que tienen bultos 0 o NULL (ya existente)
    const res1 = await query(`
      DELETE FROM kpis_mensuales 
      WHERE (datos_json->>'bultos_pedidos')::numeric = 0 
         OR (datos_json->>'bultos_pedidos') IS NULL
         OR (datos_json->>'bultos_rechazados')::numeric = 0 AND (datos_json->>'bultos_pedidos') IS NULL
    `);
    
    // 2. Eliminar KPIs que no tienen respaldo en las tablas de detalle (Huérfanos)
    // Esto limpia los meses que quedan "zombis" cuando se borra el historial
    const res2 = await query(`
      DELETE FROM kpis_mensuales
      WHERE source = 'rechazos'
      AND mes NOT IN (SELECT DISTINCT TO_CHAR(fecha, 'YYYY-MM') FROM rechazos)
      AND mes NOT IN (
        -- Evitar borrar si existe en R2 (si R2 está configurado, esto es un safe check)
        -- Si no hay R2, esto no afectará. 
        SELECT '' -- placeholder por si acaso
      )
    `);

    const res3 = await query(`
      DELETE FROM kpis_mensuales
      WHERE source = 'foxtrot'
      AND mes NOT IN (SELECT DISTINCT TO_CHAR(fecha, 'YYYY-MM') FROM foxtrot_rutas)
    `);

    console.log(`✅ Limpieza completada: ${res1.rowCount} vacíos, ${res2.rowCount + res3.rowCount} huérfanos eliminados.`);
  } catch (err) {
    console.error("❌ Error en cleanup:", err.message);
  }
}

if (require.main === module) {
  cleanupEmptyKPIs().then(() => process.exit());
}

module.exports = { cleanupEmptyKPIs };
