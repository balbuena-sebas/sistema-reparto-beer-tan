const { Client } = require('pg');
const fs = require('fs');

// URL de Neon (la vieja)
const neonUrl = "postgresql://neondb_owner:npg_0vjVyLR4HSYF@ep-wandering-moon-aiewzq6n-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require";

async function rescatar() {
  const client = new Client({ connectionString: neonUrl });
  try {
    console.log('🔗 Intentando conectar a Neon para rescate...');
    await client.connect();
    
    console.log('📥 Extrayendo tabla REGISTROS...');
    const res = await client.query('SELECT * FROM registros ORDER BY fecha DESC');
    
    if (res.rows.length > 0) {
      fs.writeFileSync('registros_rescatados.json', JSON.stringify(res.rows, null, 2));
      console.log(`✅ ¡ÉXITO! Se rescataron ${res.rows.length} registros.`);
      console.log('📁 Los datos están guardados en: registros_rescatados.json');
    } else {
      console.log('⚠ La tabla de registros está vacía.');
    }

    console.log('📥 Extrayendo tabla AUSENCIAS...');
    const resAus = await client.query('SELECT * FROM ausencias');
    fs.writeFileSync('ausencias_rescatadas.json', JSON.stringify(resAus.rows, null, 2));
    console.log(`✅ Se rescataron ${resAus.rows.length} ausencias.`);

  } catch (err) {
    console.error('❌ ERROR CRÍTICO: Neon bloqueó la conexión por completo.');
    console.error('Mensaje de Neon:', err.message);
  } finally {
    await client.end();
  }
}

rescatar();
