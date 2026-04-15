const { query } = require('../db');

async function migrar() {
  console.log('🏗️ Iniciando migración manual de columnas...');
  try {
    const tablas = ['rechazos', 'foxtrot_intentos', 'foxtrot_rutas', 'notas', 'ausencias', 'checklists'];
    for (const tabla of tablas) {
      await query(`ALTER TABLE ${tabla} ADD COLUMN IF NOT EXISTS metadata_gz BYTEA`);
      console.log(`✅ Columna metadata_gz asegurada en "${tabla}"`);
    }
    
    console.log('🚀 Migración INTEGRAL completada.');
  } catch (err) {
    console.error('❌ Error en migración:', err.message);
  } finally {
    process.exit();
  }
}

migrar();
