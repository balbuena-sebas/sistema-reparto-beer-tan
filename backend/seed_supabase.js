require('dotenv').config();
const { pool } = require('./db');
const { comprimir } = require('./compress');

async function seed() {
  console.log('🌱 Iniciando siembra de datos en Supabase...');
  
  const usuarios = [
    { nombre: 'Administrador', dni: 'admin', pass: 'admin', rol: 'admin' }
  ];

  const driverMap = [
    { id: '7003', nombre: 'Romero Diego', zona: 'Tandil' },
    { id: '5904', nombre: 'Rodriguez Martin', zona: 'Tandil' },
    { id: '5843', nombre: 'Nuñez Gaston', zona: 'Tandil' },
    { id: '2195', nombre: 'Rodriguez Nicolas', zona: 'Tandil' },
    { id: '1546', nombre: 'Quiroga Luciano', zona: 'Tandil' },
    { id: '7004', nombre: 'Acosta Roberto', zona: 'Tandil' },
    { id: '211', nombre: 'Perez Fabian', zona: 'Tandil' },
    { id: '2016', nombre: 'Dealviso Guillermo', zona: 'Tandil' }
  ];

  const choferes = [...new Set(driverMap.map(d => d.nombre))];

  try {
    const listasGz = await comprimir({
      usuarios,
      choferes,
      ayudantes: [],
      patentes: [],
      localidades: ['Tandil', 'Las Flores'],
      destinos: [],
      motivosAusencia: ['Enfermedad', 'Vacaciones', 'Falta con aviso', 'Falta sin aviso'],
      operarios: []
    });

    const driverMapGz = await comprimir(driverMap);
    const diasNoGz = await comprimir([]);

    await pool.query(`
      INSERT INTO configuracion 
        (id, empresa, costo_chofer, costo_ayudante, costo_operario, costo_operario_ayudante,
         obj_tandil, obj_flores, alerta_recargas, listas_gz, driver_map_gz, dias_no_gz, updated_at)
      VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
      ON CONFLICT (id) DO UPDATE SET
        listas_gz = EXCLUDED.listas_gz,
        driver_map_gz = EXCLUDED.driver_map_gz,
        updated_at = NOW()
    `, [
      'Sistema de Reparto BEER-TAN',
      0, 0, 0, 0, 0, 0, 10,
      listasGz,
      driverMapGz,
      diasNoGz
    ]);

    console.log('✅ ¡Datos inyectados con éxito! Ya puedes entrar con admin/admin.');
  } catch (err) {
    console.error('❌ Error al inyectar datos:', err);
  } finally {
    process.exit();
  }
}

seed();
