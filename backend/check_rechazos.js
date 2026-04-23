require('dotenv').config();
const { pool } = require('./db');

async function check() {
  try {
    console.log('🔍 Buscando rechazos de Enero (2026-01)...');
    const res = await pool.query(`
      SELECT COUNT(*) as total, MIN(fecha) as primera, MAX(fecha) as ultima 
      FROM rechazos 
      WHERE TO_CHAR(fecha, 'YYYY-MM') = '2026-01'
    `);
    
    console.log('📊 Resultado:', res.rows[0]);
    
    const resAll = await pool.query('SELECT COUNT(*) as total FROM rechazos');
    console.log('📈 Total general en tabla rechazos:', resAll.rows[0].total);

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    process.exit();
  }
}
check();
