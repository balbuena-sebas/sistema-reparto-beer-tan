require('dotenv').config();
const { Pool } = require('pg');
const { comprimir } = require('../compress');

const NEON_URL = process.env.NEON_DATABASE_URL;
const SUPABASE_URL = process.env.DATABASE_URL;

if (!NEON_URL || !SUPABASE_URL) {
  console.error('❌ Falta NEON_DATABASE_URL o DATABASE_URL en .env');
  process.exit(1);
}

const neonPool = new Pool({
  connectionString: NEON_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
});

const supabasePool = new Pool({
  connectionString: SUPABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
});

async function sync() {
  console.log('🔄 Iniciando sincronización Neon → Supabase...');
  let neonClient, supabaseClient;

  try {
    neonClient = await neonPool.connect();
    supabaseClient = await supabasePool.connect();

    // Verificar conexiones
    await neonClient.query('SELECT 1');
    await supabaseClient.query('SELECT 1');
    console.log('✅ Conexiones establecidas');

    // 1. Obtener estructura actual en Neon
    const neonCols = await neonClient.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'registros'
      ORDER BY ordinal_position
    `);
    console.log('\n📋 Estructura en Neon:');
    neonCols.rows.forEach(r => console.log(`  - ${r.column_name}: ${r.data_type}`));

    // 2. Obtener datos de Neon
    const neonRows = await neonClient.query('SELECT * FROM registros ORDER BY fecha DESC LIMIT 10000');
    console.log(`\n📥 Obtenidas ${neonRows.rows.length} filas de Neon`);

    // 3. Reconstruir tabla en Supabase (CUIDADO: Esto borra los datos actuales)
    console.log('\n⚠️  Reconstruyendo tabla registros en Supabase...');
    await supabaseClient.query('DROP TABLE IF EXISTS registros_old CASCADE');
    console.log('  ✓ Tabla antigua movida');

    await supabaseClient.query(`
      CREATE TABLE registros (
        id                BIGSERIAL PRIMARY KEY,
        fecha             DATE NOT NULL,
        chofer            TEXT NOT NULL,
        ay1               TEXT DEFAULT '',
        ay2               TEXT DEFAULT '',
        patente           TEXT DEFAULT '',
        localidad         TEXT NOT NULL,
        destino           TEXT DEFAULT '',
        bultos            INTEGER DEFAULT 0,
        costo_reparto     NUMERIC DEFAULT 0,
        rec_sn            TEXT DEFAULT 'NO',
        n_recargas        INTEGER DEFAULT 0,
        rec_cant          TEXT DEFAULT '',
        fte               INTEGER DEFAULT 1,
        bultos_clark      INTEGER DEFAULT 0,
        bultos_rec        INTEGER DEFAULT 0,
        destinos_gz       BYTEA,
        created_by_dni    TEXT DEFAULT '',
        created_by_nombre TEXT DEFAULT '',
        created_at        TIMESTAMPTZ DEFAULT NOW(),
        updated_at        TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('  ✓ Tabla registros creada con estructura correcta');

    // 4. Migrar datos con mapeo de campos
    console.log('\n📤 Migrando datos a Supabase...');
    let migrados = 0, errores = 0;

    for (const fila of neonRows.rows) {
      try {
        // Mapear campos viejos a nuevos
        // Si la fila vieja tiene 'metadata_gz' o 'destinos_gz', usarla
        // Si viene sin comprimir, comprimir la lista de destinos si existe
        let destinosGz = fila.destinos_gz;
        if (!destinosGz && Array.isArray(fila.destinos)) {
          destinosGz = await comprimir(fila.destinos);
        } else if (!destinosGz) {
          destinosGz = await comprimir([]);
        }

        const fecha = fila.fecha ? (typeof fila.fecha === 'string' ? fila.fecha : fila.fecha.toISOString().split('T')[0]) : null;

        await supabaseClient.query(`
          INSERT INTO registros
            (id, fecha, chofer, ay1, ay2, patente, localidad, destino,
             bultos, costo_reparto, rec_sn, n_recargas, rec_cant, fte,
             bultos_clark, bultos_rec, destinos_gz, created_by_dni, created_by_nombre)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
        `, [
          fila.id,
          fecha,
          fila.chofer || '',
          fila.ay1 || '',
          fila.ay2 || '',
          fila.patente || '',
          fila.localidad || '',
          fila.destino || '',
          fila.bultos || 0,
          fila.costo_reparto || 0,
          fila.rec_sn || 'NO',
          fila.n_recargas || 0,
          fila.rec_cant || '',
          fila.fte || 1,
          fila.bultos_clark || 0,
          fila.bultos_rec || 0,
          destinosGz,
          fila.created_by_dni || '',
          fila.created_by_nombre || '',
        ]);
        migrados++;

        if (migrados % 100 === 0) {
          console.log(`  ⏳ Migrando... ${migrados}/${neonRows.rows.length}`);
        }
      } catch (err) {
        errores++;
        console.error(`  ❌ Error en fila ${fila.id}:`, err.message);
      }
    }

    console.log(`\n✅ Migración de REGISTROS completada: ${migrados} registros, ${errores} errores`);

    // 4b. Sincronizar AUSENCIAS
    console.log('\n🔄 Sincronizando tabla AUSENCIAS...');
    const ausenciasNeon = await neonClient.query('SELECT * FROM ausencias');
    console.log(`  📥 ${ausenciasNeon.rows.length} ausencias en Neon`);

    let ausOk = 0, ausErr = 0;
    for (const aus of ausenciasNeon.rows) {
      try {
        const fechaDesde = aus.fecha_desde ? (typeof aus.fecha_desde === 'string' ? aus.fecha_desde : aus.fecha_desde.toISOString().split('T')[0]) : null;
        const fechaHasta = aus.fecha_hasta ? (typeof aus.fecha_hasta === 'string' ? aus.fecha_hasta : aus.fecha_hasta.toISOString().split('T')[0]) : null;

        await supabaseClient.query(`
          INSERT INTO ausencias
            (id, persona, motivo, fecha_desde, fecha_hasta, observations, dias, created_by_dni, created_by_nombre)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          ON CONFLICT (id) DO UPDATE SET
            persona=EXCLUDED.persona, motivo=EXCLUDED.motivo,
            fecha_desde=EXCLUDED.fecha_desde, updated_at=NOW()
        `, [
          aus.id,
          aus.persona || '',
          aus.motivo || '',
          fechaDesde,
          fechaHasta,
          aus.observations || '',
          aus.dias || 1,
          aus.created_by_dni || '',
          aus.created_by_nombre || '',
        ]);
        ausOk++;
      } catch (err) {
        ausErr++;
        console.error(`  ❌ Error en ausencia ${aus.id}:`, err.message);
      }
    }
    console.log(`  ✅ Ausencias: ${ausOk} migraron, ${ausErr} errores`);

    // 4c. Sincronizar CONFIGURACION
    console.log('\n🔄 Sincronizando tabla CONFIGURACION...');
    const configNeon = await neonClient.query('SELECT * FROM configuracion WHERE id = 1');
    if (configNeon.rows.length > 0) {
      const cfg = configNeon.rows[0];
      try {
        await supabaseClient.query(`
          INSERT INTO configuracion
            (id, empresa, costo_chofer, costo_ayudante, costo_operario, costo_operario_ayudante,
             obj_tandil, obj_flores, alerta_recargas, listas_gz, driver_map_gz, dias_no_gz)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
          ON CONFLICT (id) DO UPDATE SET
            empresa=EXCLUDED.empresa, costo_chofer=EXCLUDED.costo_chofer,
            listas_gz=EXCLUDED.listas_gz, driver_map_gz=EXCLUDED.driver_map_gz,
            updated_at=NOW()
        `, [
          cfg.id,
          cfg.empresa || 'Sistema de Reparto',
          cfg.costo_chofer || 0,
          cfg.costo_ayudante || 0,
          cfg.costo_operario || 0,
          cfg.costo_operario_ayudante || 0,
          cfg.obj_tandil || 0,
          cfg.obj_flores || 0,
          cfg.alerta_recargas || 10,
          cfg.listas_gz,
          cfg.driver_map_gz,
          cfg.dias_no_gz,
        ]);
        console.log('  ✅ Configuración sincronizada');
      } catch (err) {
        console.error('  ❌ Error al sincronizar config:', err.message);
      }
    }

    // 5. Verificación final
    const countResult = await supabaseClient.query('SELECT COUNT(*) FROM registros');
    const countAusencias = await supabaseClient.query('SELECT COUNT(*) FROM ausencias');
    const totalRegistros = parseInt(countResult.rows[0].count);
    const totalAusencias = parseInt(countAusencias.rows[0].count);

    console.log(`\n📊 Resultados finales en Supabase:`);
    console.log(`  • Registros: ${totalRegistros}`);
    console.log(`  • Ausencias: ${totalAusencias}`);

    if (migrados === totalRegistros && ausOk === ausenciasNeon.rows.length) {
      console.log('\n✅ Sincronización EXITOSA - Todas las tablas están sincronizadas');
    } else {
      console.log('\n⚠️  Advertencia: Revisa los conteos anteriores');
    }

  } catch (err) {
    console.error('❌ Error en sincronización:', err.message);
    console.error(err);
    process.exit(1);
  } finally {
    neonClient?.release();
    supabaseClient?.release();
    await neonPool.end();
    await supabasePool.end();
  }
}

sync();
