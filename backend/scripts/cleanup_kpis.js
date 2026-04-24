require('dotenv').config();
const { query } = require('../db');

async function cleanupEmptyKPIs() {
  console.log("🧹 Limpiando KPIs mensuales sin datos...");
  try {
    const result = await query(`
      DELETE FROM kpis_mensuales 
      WHERE (datos_json->>'bultos_pedidos')::numeric = 0 
         OR (datos_json->>'bultos_pedidos') IS NULL
         OR (datos_json->>'bultos_rechazados')::numeric = 0 AND (datos_json->>'bultos_pedidos') IS NULL
    `);
    console.log(`✅ Se eliminaron ${result.rowCount} registros de KPI vacíos.`);
  } catch (err) {
    console.error("❌ Error en cleanup:", err.message);
  }
}

if (require.main === module) {
  cleanupEmptyKPIs().then(() => process.exit());
}

module.exports = { cleanupEmptyKPIs };
