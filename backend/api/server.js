require('dotenv').config();

const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const compression = require('compression');
const rateLimit   = require('express-rate-limit');
const { initDB }  = require('./db');

const app  = express();
const PORT = process.env.PORT || 3001;

/* ================= SECURITY ================= */

app.use(helmet());

/* ================= CORS ================= */

const origenesPermitidos = [
  'https://beer-tan.netlify.app',
  'https://beer-tan-backend.onrender.com',
  'http://localhost:3000'
];

const corsOptions = {
  origin: function (origin, callback) {

    if (!origin) return callback(null, true);

    if (origenesPermitidos.includes(origin)) {
      return callback(null, true);
    }

    return callback(null, true);
  },
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','x-api-key'],
  credentials: true
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

/* =========================================== */

app.use(compression());
app.use(express.json({ limit: '20mb' }));

/* ================= RATE LIMIT =============== */

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api/', (req, res, next) => {

  if (req.method === 'OPTIONS') return next();

  limiter(req, res, next);

});

/* =============== API KEY ==================== */

const autenticar = (req, res, next) => {

  if (req.method === 'OPTIONS') {
    return next();
  }

  const apiKey = req.headers['x-api-key'];

  if (!apiKey || apiKey !== process.env.API_SECRET_KEY) {
    return res.status(401).json({
      ok: false,
      error: 'No autorizado'
    });
  }

  next();
};

/* =============== RUTAS ====================== */

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

/* =============== HEALTH ===================== */

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    status: 'online',
    ts: new Date().toISOString()
  });
});

app.get('/', (req, res) => {
  res.json({
    ok: true,
    msg: 'API Sistema de Reparto',
    version: '1.0.0'
  });
});

/* =============== ERROR ====================== */

app.use((err, req, res, next) => {

  console.error('Error global:', err.message);

  if (err.message.includes('CORS')) {
    return res.status(403).json({
      ok: false,
      error: 'CORS bloqueado'
    });
  }

  res.status(500).json({
    ok: false,
    error: 'Error interno del servidor'
  });
});

/* =============== START ====================== */

async function iniciar() {
  try {

    await initDB();

    app.listen(PORT, () => {
      console.log(`🚛 API corriendo en puerto ${PORT}`);
      console.log(`🌐 Frontend permitido: ${origenesPermitidos.join(', ')}`);
    });

  } catch (err) {

    console.error('No se pudo iniciar el servidor:', err.message);
    process.exit(1);

  }
}

iniciar();