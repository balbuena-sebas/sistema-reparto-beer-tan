// db.js — Conexión a Neon PostgreSQL y creación de tablas
require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const { Pool } = require('pg');

const dbUrl = process.env.DATABASE_URL || '';
// Supabase y la mayoría de proveedores funcionan bien con sslmode=require
const finalDbUrl = dbUrl.includes('sslmode=') 
  ? dbUrl 
  : (dbUrl.includes('?') ? `${dbUrl}&sslmode=require` : `${dbUrl}?sslmode=require`);

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
  for (let intento = 1; intento <= 3; intento++) {
    try {
      client = await pool.connect();
      break;
    } catch (err) {
      console.warn(`⚠ La base de datos no responde (intento ${intento}/3): ${err.message}`);
      if (intento === 3) throw err;
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS registros (
        id            BIGINT PRIMARY KEY,
        fecha         DATE NOT NULL,
        chofer        TEXT NOT NULL,
        ay1           TEXT DEFAULT '',
        ay2           TEXT DEFAULT '',
        patente       TEXT DEFAULT '',
        localidad     TEXT DEFAULT '',
        destino       TEXT DEFAULT '',
        bultos        INTEGER DEFAULT 0,
        costo_reparto INTEGER DEFAULT 0,
        rec_sn        TEXT DEFAULT 'NO',
        n_recargas    INTEGER DEFAULT 0,
        rec_cant      TEXT DEFAULT '',
        fte           INTEGER DEFAULT 1,
        bultos_clark  INTEGER DEFAULT 0,
        bultos_rec    INTEGER DEFAULT 0,
        destinos_gz   BYTEA,
        created_by_dni TEXT DEFAULT '',
        created_by_nombre TEXT DEFAULT '',
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        updated_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`ALTER TABLE registros ADD COLUMN IF NOT EXISTS created_by_dni TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE registros ADD COLUMN IF NOT EXISTS created_by_nombre TEXT DEFAULT ''`);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_regs_fecha     ON registros(fecha)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_regs_chofer    ON registros(chofer)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_regs_localidad ON registros(localidad)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ausencias (
        id            BIGINT PRIMARY KEY,
        persona       TEXT NOT NULL,
        motivo        TEXT DEFAULT '',
        fecha_desde   DATE NOT NULL,
        fecha_hasta   DATE,
        observations TEXT DEFAULT '',
        dias          INTEGER DEFAULT 1,
        created_by_dni TEXT DEFAULT '',
        created_by_nombre TEXT DEFAULT '',
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        updated_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`ALTER TABLE ausencias ADD COLUMN IF NOT EXISTS created_by_dni TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE ausencias ADD COLUMN IF NOT EXISTS created_by_nombre TEXT DEFAULT ''`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_aus_persona ON ausencias(persona)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_aus_fecha   ON ausencias(fecha_desde)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS configuracion (
        id              INTEGER PRIMARY KEY DEFAULT 1,
        empresa         TEXT DEFAULT 'Sistema de Reparto',
        costo_chofer    INTEGER DEFAULT 0,
        costo_ayudante  INTEGER DEFAULT 0,
        costo_operario  INTEGER DEFAULT 0,
        costo_operario_ayudante INTEGER DEFAULT 0,
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
      ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS costo_operario_ayudante INTEGER DEFAULT 0
    `);

    await client.query(`
      ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS costo_temporada INTEGER DEFAULT 0
    `);

    await client.query(`
      ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS dias_no_gz BYTEA
    `);

    await client.query(`
      INSERT INTO configuracion (id) VALUES (1)
      ON CONFLICT (id) DO NOTHING
    `);

    // Tabla rechazos
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
    await client.query(`CREATE INDEX IF NOT EXISTS idx_rec_fecha   ON rechazos(fecha)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_rec_chofer  ON rechazos(chofer)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_rec_archivo ON rechazos(archivo)`);

    // Columnas nuevas por si las tablas ya existían
    await client.query(`ALTER TABLE rechazos ADD COLUMN IF NOT EXISTS hl            NUMERIC DEFAULT 0`);
    await client.query(`ALTER TABLE rechazos ADD COLUMN IF NOT EXISTS hl_rechazado  NUMERIC DEFAULT 0`);
    await client.query(`ALTER TABLE rechazos ADD COLUMN IF NOT EXISTS transporte_id TEXT`);
    await client.query(`ALTER TABLE rechazos ADD COLUMN IF NOT EXISTS metadata_gz   BYTEA`);
    
    await client.query(`ALTER TABLE foxtrot_intentos ADD COLUMN IF NOT EXISTS metadata_gz BYTEA`);
    await client.query(`ALTER TABLE foxtrot_rutas    ADD COLUMN IF NOT EXISTS metadata_gz BYTEA`);
    await client.query(`ALTER TABLE notas            ADD COLUMN IF NOT EXISTS metadata_gz BYTEA`);
    await client.query(`ALTER TABLE ausencias        ADD COLUMN IF NOT EXISTS metadata_gz BYTEA`);
    await client.query(`ALTER TABLE checklists       ADD COLUMN IF NOT EXISTS metadata_gz BYTEA`);
    
    // Tabla checklists (por si no existía)
    await client.query(`
      CREATE TABLE IF NOT EXISTS checklists (
        id         BIGSERIAL PRIMARY KEY,
        fecha      DATE NOT NULL,
        chofer     TEXT NOT NULL,
        dni        TEXT NOT NULL,
        estado     TEXT DEFAULT 'completado',
        creado_en  TIMESTAMPTZ DEFAULT NOW(),
        metadata_gz BYTEA
      )
    `);

    // Tabla notas — por persona, mes, categoría
    await client.query(`
      CREATE TABLE IF NOT EXISTS notas (
        id         BIGSERIAL PRIMARY KEY,
        persona    TEXT NOT NULL,
        mes        TEXT NOT NULL,           -- 'YYYY-MM'
        fecha      DATE NOT NULL DEFAULT CURRENT_DATE,
        categoria  TEXT DEFAULT 'Nota libre',
        texto      TEXT NOT NULL,
        prioridad  TEXT DEFAULT 'normal',   -- normal | urgente
        estado     TEXT DEFAULT 'activa',   -- activa | resuelta | eliminada
        creado_en  TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_notas_mes     ON notas(mes)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_notas_persona ON notas(persona)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_notas_estado  ON notas(estado)`);

    // ── Tablas Foxtrot ────────────────────────────────────────────────────────

    // Tabla rutas Foxtrot (Route Analytics)
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
        is_digital_route              BOOLEAN DEFAULT false
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_fox_rutas_fecha   ON foxtrot_rutas(fecha)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_fox_rutas_driver  ON foxtrot_rutas(driver_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_fox_rutas_archivo ON foxtrot_rutas(archivo)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_fox_rutas_dc      ON foxtrot_rutas(dc_name)`);

    // Tabla intentos Foxtrot (Attempt Analytics)
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
    await client.query(`CREATE INDEX IF NOT EXISTS idx_fox_int_fecha   ON foxtrot_intentos(fecha)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_fox_int_driver  ON foxtrot_intentos(driver_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_fox_int_archivo ON foxtrot_intentos(archivo)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_fox_int_status  ON foxtrot_intentos(aggregate_visit_status)`);

    // Tabla checklists diaria (para control de chóferes)
    await client.query(`
      CREATE TABLE IF NOT EXISTS checklists (
        id          BIGSERIAL PRIMARY KEY,
        fecha       DATE NOT NULL DEFAULT CURRENT_DATE,
        chofer      TEXT NOT NULL,
        dni         TEXT NOT NULL,
        estado      TEXT DEFAULT 'completado', -- 'completado' | 'sin_ruta'
        creado_en   TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_chk_fecha ON checklists(fecha)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_chk_dni   ON checklists(dni)`);
    
    // Migración: Asegurar que existe la columna 'estado' si la tabla ya existía
    await client.query(`ALTER TABLE checklists ADD COLUMN IF NOT EXISTS estado TEXT DEFAULT 'completado'`);

    // ── Tabla KPIs Mensuales (Resumen Lite para Neon) ─────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS kpis_mensuales (
        id                BIGSERIAL PRIMARY KEY,
        mes               TEXT NOT NULL, -- 'YYYY-MM'
        chofer            TEXT NOT NULL,
        source            TEXT NOT NULL, -- 'foxtrot' | 'rechazos'
        datos_json        JSONB,
        updated_at        TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(mes, chofer, source)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_kpis_mes    ON kpis_mensuales(mes)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_kpis_chofer ON kpis_mensuales(chofer)`);

    await client.query('COMMIT');
    console.log('✅ Base de datos inicializada correctamente');
  } catch (err) {
    if (client) await client.query('ROLLBACK');
    console.error('⚠ ATENCIÓN: No se pudo inicializar la DB (Posible bloqueo por espacio):', err.message);
    console.log('🚀 Iniciando en MODO SEGURO (App limitada pero activa para mantenimiento)');
    // No lanzamos el error para permitir que el servidor arranque y podamos operar
  } finally {
    if (client) client.release();
  }
}

module.exports = { pool, query, initDB };