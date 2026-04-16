require('dotenv').config({ path: '../backend/.env' });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL + (process.env.DATABASE_URL?.includes('?') ? '&' : '?') + 'sslmode=require',
});

async function test() {
  try {
    const res = await pool.query('SELECT COUNT(*) as count FROM rechazos');
    console.log('TOTAL RECHAZOS EN DB:', res.rows[0].count);
    
    const sample = await pool.query('SELECT id, fecha, archivo, metadata_gz FROM rechazos LIMIT 1');
    console.log('MUESTRA:', JSON.stringify(sample.rows[0], null, 2));
    
    process.exit(0);
  } catch (err) {
    console.error('ERROR DB:', err.message);
    process.exit(1);
  }
}

test();
