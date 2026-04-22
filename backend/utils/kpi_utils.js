// backend/utils/kpi_utils.js
const { query } = require('../db');

/**
 * Recalcula los KPIs resumidos para un mes y chofer específico.
 * Estos datos son livianos (JSONB) y permiten borrar las miles de filas detalladas sin perder los reportes.
 */
async function actualizarKPIMensual(mes, chofer, source) {
  console.log(`📊 Recalculando KPIs [${source}] para ${chofer} en ${mes}...`);
  
  let datosJson = {};

  if (source === 'foxtrot') {
    const res = await query(`
      SELECT 
        COUNT(id)::int AS rutas,
        SUM(imported_customers)::int AS clientes_total,
        SUM(successful_customers)::int AS exitosos,
        SUM(total_driven_meters) AS km_reales,
        AVG(sequence_adherence) AS seq_ad_avg,
        AVG(driver_click_score) AS score_avg
      FROM foxtrot_rutas
      WHERE TO_CHAR(fecha, 'YYYY-MM') = $1 AND chofer_mapeado = $2
    `, [mes, chofer]);
    
    // También cruzar con intentos para visitas reales
    const resInt = await query(`
      SELECT 
        COUNT(*)::int AS visitas_total,
        COUNT(*) FILTER (WHERE aggregate_visit_status = 'SUCCESSFUL')::int AS visitas_ok
      FROM foxtrot_intentos
      WHERE TO_CHAR(fecha, 'YYYY-MM') = $1 AND chofer_mapeado = $2
    `, [mes, chofer]);

    datosJson = {
      ...res.rows[0],
      ...resInt.rows[0]
    };
  } else if (source === 'rechazos') {
    const res = await query(`
      SELECT 
        SUM(bultos)::numeric AS bultos_pedidos,
        SUM(bultos_rechazados)::numeric AS bultos_rechazados,
        SUM(importe_rechazado)::numeric AS importe_rechazado,
        COUNT(*) FILTER (WHERE tipo_motivo = 'logistica')::int AS n_logistica,
        COUNT(*) FILTER (WHERE tipo_motivo = 'facturacion')::int AS n_facturacion
      FROM rechazos
      WHERE TO_CHAR(fecha, 'YYYY-MM') = $1 AND chofer_desc = $2
    `, [mes, chofer]);
    
    datosJson = res.rows[0];
  }

  if (Object.keys(datosJson).length > 0) {
    await query(`
      INSERT INTO kpis_mensuales (mes, chofer, source, datos_json, updated_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (mes, chofer, source) 
      DO UPDATE SET datos_json = EXCLUDED.datos_json, updated_at = NOW()
    `, [mes, chofer, source, datosJson]);
  }
}

module.exports = { actualizarKPIMensual };
