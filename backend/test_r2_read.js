require('dotenv').config();
const storage = require('./storage');

async function testFallback() {
  console.log('📡 Simulando petición API para Enero 2026 (Fallback R2)...');
  try {
    const archived = await storage.download('rechazos/detalle_2026-01.json');
    if (archived && Array.isArray(archived)) {
      console.log(`✅ ¡Éxito! Se encontraron ${archived.length} registros en R2.`);
      console.log('Primer registro:', archived[0].chofer_desc, archived[0].fecha);
    } else {
      console.log('❌ No se encontró el archivo en R2.');
    }
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    process.exit();
  }
}
testFallback();
