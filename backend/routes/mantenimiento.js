const express = require('express');
const router  = express.Router();
const { optimizarNeon } = require('../scripts/optimize');
const { realizarLimpiezaAutomatica } = require('../scripts/neon_cleanup');

// POST /api/mantenimiento/optimizar
router.post('/optimizar', async (req, res) => {
  try {
    console.log('🚀 Solicitud de compactación recibida...');
    
    // Ejecutamos en segundo plano para no hacer esperar al frontend
    optimizarNeon().catch(err => console.error('❌ Error en optimizarNeon:', err.message));
    realizarLimpiezaAutomatica().catch(err => console.error('❌ Error en limpiezaAutomatica:', err.message));

    res.json({ 
      ok: true, 
      msg: 'Proceso de compactación y limpieza iniciado en segundo plano. El espacio se liberará gradualmente.' 
    });
  } catch (err) {
    console.error('❌ Error al iniciar mantenimiento:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
