const express = require('express');
const router  = express.Router();
const { optimizarNeon } = require('../scripts/optimize');
const { realizarLimpiezaAutomatica } = require('../scripts/neon_cleanup');
const { archivarMes } = require('../scripts/archive_to_r2');
const { syncSupa2Neon } = require('../scripts/replicate_supabase_to_neon');

// POST /api/mantenimiento/optimizar
router.post('/optimizar', async (req, res) => {
  try {
    console.log('🚀 Solicitud de compactación recibida...');
    
    // Ejecutamos en segundo plano para no hacer esperar al frontend
    optimizarNeon().catch(err => console.error('❌ Error en optimizarNeon:', err.message));
    // No borramos por defecto: solo archival a R2 y limpieza segura
    realizarLimpiezaAutomatica({ allowDelete: false }).catch(err => console.error('❌ Error en limpiezaAutomatica:', err.message));

    res.json({ 
      ok: true, 
      msg: 'Proceso de compactación y limpieza iniciado en segundo plano. El espacio se liberará gradualmente.' 
    });
  } catch (err) {
    console.error('❌ Error al iniciar mantenimiento:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/mantenimiento/archive-month  body: { mes: 'YYYY-MM' }
router.post('/archive-month', async (req, res) => {
  try {
    const { mes } = req.body || {};
    if (!mes) return res.status(400).json({ ok: false, error: 'Falta parámetro mes (YYYY-MM)' });
    console.log(`🔁 Petición de archivado para mes ${mes} recibida por API`);
    archivarMes(mes).then(() => console.log(`✅ Archivado ${mes} finalizado`)).catch(err => console.error('❌ Error archivando:', err.message));
    return res.json({ ok: true, msg: `Archivado iniciado para ${mes}` });
  } catch (err) {
    console.error('❌ Error archive-month:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/mantenimiento/replicate-neon  body: { months: 3 }
router.post('/replicate-neon', async (req, res) => {
  try {
    const months = parseInt((req.body && req.body.months) || process.env.NEON_REPLICA_MONTHS || 3, 10);
    console.log(`🔁 Petición de replicación a Neon (últimos ${months} meses)`);
    // Ajustar env var temporalmente para la tarea
    process.env.NEON_REPLICA_MONTHS = String(months);
    syncSupa2Neon().then(() => console.log('✅ Replicación iniciada')).catch(err => console.error('❌ Error replicando:', err.message));
    return res.json({ ok: true, msg: `Replicación iniciada (últimos ${months} meses)` });
  } catch (err) {
    console.error('❌ Error replicate-neon:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
