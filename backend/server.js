// server.js — Servidor principal de la API de reparto
require('dotenv').config();

const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const compression = require('compression');
const rateLimit   = require('express-rate-limit');
const { initDB }  = require('./db');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(helmet());

const origenesPermitidos = [
  process.env.FRONTEND_URL,
  'https://beer-tan.netlify.app',
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin && process.env.NODE_ENV !== 'production') return callback(null, true);
    if (origenesPermitidos.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origen no permitido → ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'x-api-key'],
}));

app.use(compression());
app.use(express.json({ limit: '20mb' }));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  message: { ok: false, error: 'Demasiados requests. Esperá un momento.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

const autenticar = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== process.env.API_SECRET_KEY) {
    return res.status(401).json({ ok: false, error: 'No autorizado' });
  }
  next();
};

// ── Rutas ─────────────────────────────────────────────────────────────────────
const registrosRouter            = require('./routes/registros');
const ausenciasRouter            = require('./routes/ausencias');
const configRouter               = require('./routes/config');
const migracionRouter            = require('./routes/migracion');
const { router: rechazosRouter } = require('./routes/rechazos');
const notasRouter                = require('./routes/notas');
const foxtrotRouter              = require('./routes/foxtrot');

app.use('/api/registros', autenticar, registrosRouter);
app.use('/api/ausencias', autenticar, ausenciasRouter);
app.use('/api/config',    autenticar, configRouter);
app.use('/api/migracion', autenticar, migracionRouter);
app.use('/api/rechazos',  autenticar, rechazosRouter);
app.use('/api/notas',     autenticar, notasRouter);
app.use('/api/foxtrot',   autenticar, foxtrotRouter);

app.get('/health', (req, res) => {
  res.json({ ok: true, status: 'online', ts: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.json({ ok: true, msg: 'API Sistema de Reparto', version: '1.0.0' });
});

app.use((err, req, res, next) => {
  console.error('Error global:', err.message);
  res.status(500).json({ ok: false, error: 'Error interno del servidor' });
});

async function iniciar() {
  try {
    await initDB();
    app.listen(PORT, () => {
      console.log(`🚛 API corriendo en http://localhost:${PORT}`);
      console.log(`   Frontend permitido: ${origenesPermitidos.join(', ')}`);
    });
  } catch (err) {
    console.error('No se pudo iniciar el servidor:', err.message);
    process.exit(1);
  }
}

iniciar();