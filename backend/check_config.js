require('dotenv').config();
const { pool } = require('./db');
const { descomprimirSafe } = require('./compress');

async function check() {
  try {
    const res = await pool.query('SELECT * FROM configuracion WHERE id=1');
    if (res.rows.length === 0) {
      console.log('❌ Error: La tabla configuracion está VACÍA.');
    } else {
      const fila = res.rows[0];
      const listas = await descomprimirSafe(fila.listas_gz, {});
      console.log('✅ Fila encontrada.');
      console.log('👥 Usuarios en DB:', listas.usuarios);
      console.log('🚚 Choferes en DB:', listas.choferes);
    }
  } catch (err) {
    console.error('❌ Error al conectar:', err.message);
  } finally {
    process.exit();
  }
}
check();
