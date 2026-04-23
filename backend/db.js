const { Pool } = require('pg');

const dbUrl = process.env.DATABASE_URL || '';

// Función para construir la URL de conexión de forma robusta
function buildFinalDbUrl(url) {
  if (!url) return '';
  const urlObj = new URL(url);
  
  // Forzamos sslmode=require para Supabase/Render
  urlObj.searchParams.set('sslmode', 'require');
  
  // Parámetro de compatibilidad para evitar el warning de seguridad de pg
  urlObj.searchParams.set('uselibpqcompat', 'true');
  
  return urlObj.toString();
}

const finalDbUrl = buildFinalDbUrl(dbUrl);

const pool = new Pool({
  connectionString: finalDbUrl,
  ssl: { rejectUnauthorized: false },
  max: 3,                         
  idleTimeoutMillis:  30000,
  connectionTimeoutMillis: 15000, 
  query_timeout: 20000,
});

pool.on('error', (err) => {
  console.error('Error inesperado en el pool de DB:', err.message);
});

// ── query con retry automático ───────────────────────────────────────────────
async function query(text, params, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await pool.query(text, params);
    } catch (err) {
      const esTimeout = err.message?.includes('timeout') ||
                        err.message?.includes('terminated') ||
                        err.message?.includes('ECONNRESET');
      if (esTimeout && i < retries) {
        console.log(`⚠ Timeout DB (intento ${i + 1}/${retries + 1}), reintentando en 2s...`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      throw err;
    }
  }
}

// ── Crear tablas si no existen ──────────────────────────────────────────────
async function initDB() {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    // 1. CREAR TODAS LAS TABLAS PRIMERO
    await client.query(`
      CREATE TABLE IF NOT EXISTS registros (
        id           BIGSERIAL PRIMARY KEY,
        chofer       TEXT NOT NULL,
        localidad    TEXT NOT NULL,
        fecha        DATE NOT NULL,
        bultos       INTEGER DEFAULT 0,
        hl           NUMERIC DEFAULT 0,
        recarga      BOOLEAN DEFAULT false,
        ayudante     TEXT,
        chofer_dni   TEXT,
        ayudante_dni TEXT,
        created_at   TIMESTAMPTZ DEFAULT NOW(),
        metadata_gz  BYTEA
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ausencias (
        id            BIGSERIAL PRIMARY KEY,
        persona       TEXT NOT NULL,
        motivo        TEXT DEFAULT '',
        fecha_desde   DATE NOT NULL,
        fecha_hasta   DATE,
        observations TEXT DEFAULT '',
        dias          INTEGER DEFAULT 1,
        created_by_dni TEXT DEFAULT '',
        created_by_nombre TEXT DEFAULT '',
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        updated_at    TIMESTAMPTZ DEFAULT NOW(),
        metadata_gz   BYTEA
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS configuracion (
        id              INTEGER PRIMARY KEY DEFAULT 1,
        empresa         TEXT DEFAULT 'Sistema de Reparto',
        costo_chofer    INTEGER DEFAULT 0,
        costo_ayudante  INTEGER DEFAULT 0,
        costo_operario  INTEGER DEFAULT 0,
        costo_operario_ayudante INTEGER DEFAULT 0,
        costo_temporada INTEGER DEFAULT 0,
        obj_tandil      INTEGER DEFAULT 0,
        obj_flores      INTEGER DEFAULT 0,
        param1          INTEGER DEFAULT 0,
        param2          INTEGER DEFAULT 0,
        param3          INTEGER DEFAULT 0,
        alerta_recargas INTEGER DEFAULT 10,
        listas_gz       BYTEA,
        driver_map_gz   BYTEA,
        dias_no_gz      BYTEA,
        updated_at      TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS rechazos (
        id                BIGSERIAL PRIMARY KEY,
        archivo           TEXT,
        fecha_import      TIMESTAMPTZ DEFAULT NOW(),
        fecha             DATE,
        articulo          TEXT,
        articulo_desc     TEXT,
        bultos            NUMERIC DEFAULT 0,
        bultos_rechazados NUMERIC DEFAULT 0,
        hl                NUMERIC DEFAULT 0,
        hl_rechazado      NUMERIC DEFAULT 0,
        importe_neto      NUMERIC DEFAULT 0,
        importe_rechazado NUMERIC DEFAULT 0,
        motivo            TEXT,
        motivo_desc       TEXT,
        tipo_motivo       TEXT,
        cliente_id        TEXT,
        cliente_desc      TEXT,
        domicilio         TEXT,
        canal             TEXT,
        canal_desc        TEXT,
        chofer            TEXT,
        chofer_desc       TEXT,
        transporte_id     TEXT,
        ruta              TEXT,
        ruta_desc         TEXT,
        rechazo_total     BOOLEAN DEFAULT false,
        metadata_gz       BYTEA
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS notas (
        id         BIGSERIAL PRIMARY KEY,
        persona    TEXT NOT NULL,
        mes        TEXT NOT NULL,
        fecha      DATE NOT NULL DEFAULT CURRENT_DATE,
        categoria  TEXT DEFAULT 'Nota libre',
        texto      TEXT NOT NULL,
        prioridad  TEXT DEFAULT 'normal',
        estado     TEXT DEFAULT 'activa',
        creado_en  TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        metadata_gz BYTEA
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS checklists (
        id          BIGSERIAL PRIMARY KEY,
        fecha       DATE NOT NULL DEFAULT CURRENT_DATE,
        chofer      TEXT NOT NULL,
        dni         TEXT NOT NULL,
        estado      TEXT DEFAULT 'completado',
        creado_en   TIMESTAMPTZ DEFAULT NOW(),
        metadata_gz BYTEA
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS foxtrot_rutas (
        id                            BIGSERIAL PRIMARY KEY,
        archivo                       TEXT,
        fecha_import                  TIMESTAMPTZ DEFAULT NOW(),
        dc_id                         TEXT,
        dc_name                       TEXT,
        route_id                      TEXT,
        route_name                    TEXT,
        fecha                         DATE,
        driver_id                     TEXT,
        driver_name                   TEXT,
        chofer_mapeado                TEXT,
        imported_customers            NUMERIC DEFAULT 0,
        successful_customers          NUMERIC DEFAULT 0,
        failed_customers              NUMERIC DEFAULT 0,
        total_visited_customers       NUMERIC DEFAULT 0,
        total_unvisited_customers     NUMERIC DEFAULT 0,
        planned_driving_meters        NUMERIC DEFAULT 0,
        total_driven_meters           NUMERIC DEFAULT 0,
        planned_driving_seconds       NUMERIC DEFAULT 0,
        total_driven_seconds          NUMERIC DEFAULT 0,
        planned_journey_seconds       NUMERIC DEFAULT 0,
        total_journey_seconds         NUMERIC DEFAULT 0,
        sequence_adherence            NUMERIC DEFAULT 0,
        seq_adhered_clicks            NUMERIC DEFAULT 0,
        seq_not_adhered_clicks        NUMERIC DEFAULT 0,
        seq_forgiven_clicks           NUMERIC DEFAULT 0,
        seq_no_decision_clicks        NUMERIC DEFAULT 0,
        total_unauthorized_stops      NUMERIC DEFAULT 0,
        total_unauthorized_stops_secs NUMERIC DEFAULT 0,
        total_authorized_stops        NUMERIC DEFAULT 0,
        total_authorized_stops_secs   NUMERIC DEFAULT 0,
        driver_click_score            NUMERIC DEFAULT 0,
        is_digital_route              BOOLEAN DEFAULT false,
        metadata_gz                   BYTEA
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS foxtrot_intentos (
        id                        BIGSERIAL PRIMARY KEY,
        archivo                   TEXT,
        fecha_import              TIMESTAMPTZ DEFAULT NOW(),
        dc_name                   TEXT,
        route_id                  TEXT,
        driver_id                 TEXT,
        driver_name               TEXT,
        chofer_mapeado            TEXT,
        fecha                     DATE,
        customer_id               TEXT,
        customer_name             TEXT,
        location_confidence       TEXT,
        visit_start_ts            TEXT,
        visit_duration_secs       NUMERIC DEFAULT 0,
        visit_meters_from_cust    NUMERIC DEFAULT 0,
        aggregate_visit_status    TEXT,
        sequence_adherence_status TEXT,
        suspicious_drive_by       BOOLEAN DEFAULT false,
        inferred_service_secs     NUMERIC DEFAULT 0,
        metadata_gz               BYTEA
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS kpis_mensuales (
        id                BIGSERIAL PRIMARY KEY,
        mes               TEXT NOT NULL,
        chofer            TEXT NOT NULL,
        source            TEXT NOT NULL,
        datos_json        JSONB,
        updated_at        TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(mes, chofer, source)
      )
    `);

    // 2. APLICAR MIGRACIONES (ALTER TABLE) DESPUÉS DE CREARLAS
    await client.query(`ALTER TABLE ausencias ADD COLUMN IF NOT EXISTS created_by_dni TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE ausencias ADD COLUMN IF NOT EXISTS created_by_nombre TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE ausencias ADD COLUMN IF NOT EXISTS metadata_gz BYTEA`);
    
    await client.query(`ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS costo_operario_ayudante INTEGER DEFAULT 0`);
    await client.query(`ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS costo_temporada INTEGER DEFAULT 0`);
    await client.query(`ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS dias_no_gz BYTEA`);

    await client.query(`ALTER TABLE rechazos ADD COLUMN IF NOT EXISTS hl NUMERIC DEFAULT 0`);
    await client.query(`ALTER TABLE rechazos ADD COLUMN IF NOT EXISTS hl_rechazado NUMERIC DEFAULT 0`);
    await client.query(`ALTER TABLE rechazos ADD COLUMN IF NOT EXISTS transporte_id TEXT`);
    await client.query(`ALTER TABLE rechazos ADD COLUMN IF NOT EXISTS metadata_gz BYTEA`);

    await client.query(`ALTER TABLE registros ADD COLUMN IF NOT EXISTS metadata_gz BYTEA`);
    await client.query(`ALTER TABLE notas ADD COLUMN IF NOT EXISTS metadata_gz BYTEA`);
    await client.query(`ALTER TABLE checklists ADD COLUMN IF NOT EXISTS metadata_gz BYTEA`);
    await client.query(`ALTER TABLE foxtrot_intentos ADD COLUMN IF NOT EXISTS metadata_gz BYTEA`);
    await client.query(`ALTER TABLE foxtrot_rutas ADD COLUMN IF NOT EXISTS metadata_gz BYTEA`);

    // 3. ÍNDICES E INSERCIONES INICIALES
    await client.query(`CREATE INDEX IF NOT EXISTS idx_regs_fecha     ON registros(fecha)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_aus_fecha      ON ausencias(fecha_desde)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_rec_fecha      ON rechazos(fecha)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_fox_rutas_fecha ON foxtrot_rutas(fecha)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_fox_int_fecha   ON foxtrot_intentos(fecha)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_chk_fecha       ON checklists(fecha)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_kpis_mes        ON kpis_mensuales(mes)`);

    await client.query(`INSERT INTO configuracion (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);

    await client.query('COMMIT');
    console.log('✅ Base de datos inicializada correctamente');
  } catch (err) {
    if (client) await client.query('ROLLBACK');
    console.error('⚠ Error en inicialización de DB:', err.message);
  } finally {
    if (client) client.release();
  }
}

module.exports = { pool, query, initDB };