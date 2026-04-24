const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://postgres.axxupnbtfqzcxglrkqxg:Beertan2026@aws-1-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require',
  ssl: { rejectUnauthorized: false }
});
async function query(t, p) { return pool.query(t, p); }

async function check() {
  try {
    const res = await query("SELECT TO_CHAR(fecha, 'YYYY-MM') as mes, count(*) as cant FROM rechazos GROUP BY 1 ORDER BY 1 DESC");
    console.log("Meses en tabla rechazos:", res.rows);
    
    const kpis = await query("SELECT mes, count(*) as cant FROM kpis_mensuales WHERE source = 'rechazos' GROUP BY 1 ORDER BY 1 DESC");
    console.log("Meses en kpis_mensuales:", kpis.rows);
  } catch (e) {
    console.error(e);
  } finally {
    process.exit();
  }
}

check();
