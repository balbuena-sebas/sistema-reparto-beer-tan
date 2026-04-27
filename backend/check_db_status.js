require('dotenv').config();
const { query } = require('./db');

async function run() {
  console.log("📊 Estado actual de la base de datos:");
  try {
    const r = await query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
    for (const row of r.rows) {
      try {
        const c = await query(`SELECT count(*) FROM ${row.table_name}`);
        console.log(`- ${row.table_name.padEnd(20)}: ${c.rows[0].count} registros`);
      } catch (e) {
        console.log(`- ${row.table_name.padEnd(20)}: (Error al leer)`);
      }
    }
  } catch (err) {
    console.error("❌ Error:", err.message);
  } finally {
    process.exit();
  }
}

run();
