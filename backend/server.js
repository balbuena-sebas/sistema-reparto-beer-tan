require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { initDB } = require('./db');

const app = express();
const PORT = process.env.PORT || 3001;

// ========== CORS - DEBE IR ANTES DE TODO ==========
app.use((req, res, next) => {
  const origin = req.headers.origin;
  res.header('Access-Control-Allow-Origin', origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-api-key, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Vary', 'Origin');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});
// ===================================================

app.use(helmet({ 
  crossOriginResourcePolicy: false,
  crossOriginOpenerPolicy: false,
}));
app.use(compression());
app.use(express.json({ limit: '20mb' }));

const limiter = rateLimit({ windowMs: 60 * 1000, max: 200 });
app.use('/api/', limiter);

const autenticar = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== process.env.API_SECRET_KEY) {
    return res.status(401).json({ ok: false, error: 'No autorizado' });
  }
  next();
};

// Rutas
const registrosRouter = require('./routes/registros');
const ausenciasRouter = require('./routes/ausencias');
const configRouter = require('./routes/config');
const migracionRouter = require('./routes/migracion');
const { router: rechazosRouter } = require('./routes/rechazos');
const notasRouter = require('./routes/notas');
const foxtrotRouter = require('./routes/foxtrot');
const checklistsRouter = require('./routes/checklists');

app.use('/api/registros', autenticar, registrosRouter);
app.use('/api/ausencias', autenticar, ausenciasRouter);
app.use('/api/config', autenticar, configRouter);
app.use('/api/migracion', autenticar, migracionRouter);
app.use('/api/rechazos', autenticar, rechazosRouter);
app.use('/api/notas', autenticar, notasRouter);
app.use('/api/foxtrot', autenticar, foxtrotRouter);
app.use('/api/checklists', autenticar, checklistsRouter);

const { optimizarNeon } = require('./scripts/optimize');
app.post('/api/mantenimiento/optimizar', autenticar, async (req, res) => {
  try {
    // Ejecutar de forma asíncrona para no bloquear
    optimizarNeon();
    res.json({ ok: true, msg: 'Optimización iniciada en segundo plano' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/health', (req, res) => res.json({ ok: true, status: 'online' }));
app.get('/', (req, res) => res.json({ ok: true, msg: 'API Sistema de Reparto' }));

app.use((err, req, res, next) => {
  console.error('Error global:', err.message);
  res.status(500).json({ ok: false, error: 'Error interno' });
});

async function iniciar() {
  try {
    await initDB();
    app.listen(PORT, () => console.log(`🚛 API corriendo en puerto ${PORT}`));
  } catch (err) {
    console.error('No se pudo iniciar:', err.message);
    process.exit(1);
  }
}
iniciar();