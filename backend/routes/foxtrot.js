// routes/foxtrot.js — Importación y consulta de datos Foxtrot (Route + Attempt Analytics)
const express = require('express');
const router  = express.Router();
const { pool, query } = require('../db');

// ── Mapper fila → objeto limpio ───────────────────────────────────────────────
function filaARuta(f) {
  return {
    id:                         Number(f.id),
    archivo:                    f.archivo,
    fechaImport:                f.fecha_import,
    dcId:                       f.dc_id,
    dcName:                     f.dc_name,
    routeId:                    f.route_id,
    routeName:                  f.route_name,
    fecha:                      f.fecha ? new Date(f.fecha).toISOString().split('T')[0] : null,
    driverId:                   f.driver_id,
    driverName:                 f.driver_name,
    choferMapeado:              f.chofer_mapeado || null,
    importedCustomers:          Number(f.imported_customers)        || 0,
    successfulCustomers:        Number(f.successful_customers)      || 0,
    failedCustomers:            Number(f.failed_customers)          || 0,
    totalVisitedCustomers:      Number(f.total_visited_customers)   || 0,
    totalUnvisitedCustomers:    Number(f.total_unvisited_customers) || 0,
    plannedDrivingMeters:       Number(f.planned_driving_meters)    || 0,
    totalDrivenMeters:          Number(f.total_driven_meters)       || 0,
    plannedDrivingSeconds:      Number(f.planned_driving_seconds)   || 0,
    totalDrivenSeconds:         Number(f.total_driven_seconds)      || 0,
    plannedJourneySeconds:      Number(f.planned_journey_seconds)   || 0,
    totalJourneySeconds:        Number(f.total_journey_seconds)     || 0,
    sequenceAdherence:          Number(f.sequence_adherence)        || 0,
    seqAdheredClicks:           Number(f.seq_adhered_clicks)        || 0,
    seqNotAdheredClicks:        Number(f.seq_not_adhered_clicks)    || 0,
    totalUnauthorizedStops:     Number(f.total_unauthorized_stops)  || 0,
    totalUnauthorizedStopsSecs: Number(f.total_unauthorized_stops_secs) || 0,
    totalAuthorizedStops:       Number(f.total_authorized_stops)    || 0,
    driverClickScore:           Number(f.driver_click_score)        || 0,
    isDigitalRoute:             f.is_digital_route,
  };
}

function filaAIntento(f) {
  return {
    id:                   Number(f.id),
    routeId:              f.route_id,
    driverId:             f.driver_id,
    driverName:           f.driver_name,
    choferMapeado:        f.chofer_mapeado || null,
    fecha:                f.fecha ? new Date(f.fecha).toISOString().split('T')[0] : null,
    customerId:           f.customer_id,
    customerName:         f.customer_name,
    locationConfidence:   f.location_confidence,
    visitStartTs:         f.visit_start_ts,
    visitDurationSecs:    Number(f.visit_duration_secs)  || 0,
    visitMetersFromCust:  Number(f.visit_meters_from_cust) || 0,
    aggregateVisitStatus: f.aggregate_visit_status,
    sequenceAdherenceStatus: f.sequence_adherence_status,
    suspiciousDriveBy:    f.suspicious_drive_by,
    inferredServiceSecs:  Number(f.inferred_service_secs) || 0,
    archivo:              f.archivo,
    dcName:               f.dc_name,
  };
}

// ── Helper: convierte "YYYY-MM" al rango completo del mes ────────────────────
function mesARango(mes) {
  const [y, m] = mes.split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return null;
  const desde = `${y}-${String(m).padStart(2, '0')}-01`;
  const ultimoDia = new Date(y, m, 0).getDate();
  const hasta  = `${y}-${String(m).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;
  return { desde, hasta };
}

// ── GET /api/foxtrot/rutas — listar rutas con filtros ────────────────────────
router.get('/rutas', async (req, res) => {
  try {
    const { desde, hasta, driverId, dcName, archivo } = req.query;
    let q = 'SELECT * FROM foxtrot_rutas WHERE 1=1';
    const params = [];
    let i = 1;
    if (desde)    { q += ` AND fecha >= $${i++}`;                    params.push(desde); }
    if (hasta)    { q += ` AND fecha <= $${i++}`;                    params.push(hasta); }
    if (driverId) { q += ` AND driver_id = $${i++}`;                 params.push(driverId); }
    if (dcName)   { q += ` AND dc_name ILIKE $${i++}`;               params.push(`%${dcName}%`); }
    if (archivo)  { q += ` AND archivo = $${i++}`;                   params.push(archivo); }
    q += ' ORDER BY fecha DESC, driver_id ASC LIMIT 5000';
    const result = await query(q, params);
    res.json({ ok: true, data: result.rows.map(filaARuta) });
  } catch (err) {
    if (err.message.includes('does not exist')) return res.json({ ok: true, data: [] });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /api/foxtrot/intentos — listar intentos con filtros ─────────────────
router.get('/intentos', async (req, res) => {
  try {
    const { desde, hasta, driverId, archivo } = req.query;
    let q = 'SELECT * FROM foxtrot_intentos WHERE 1=1';
    const params = [];
    let i = 1;
    if (desde)    { q += ` AND fecha >= $${i++}`; params.push(desde); }
    if (hasta)    { q += ` AND fecha <= $${i++}`; params.push(hasta); }
    if (driverId) { q += ` AND driver_id = $${i++}`; params.push(driverId); }
    if (archivo)  { q += ` AND archivo = $${i++}`; params.push(archivo); }
    q += ' ORDER BY fecha DESC, driver_id ASC LIMIT 20000';
    const result = await query(q, params);
    res.json({ ok: true, data: result.rows.map(filaAIntento) });
  } catch (err) {
    if (err.message.includes('does not exist')) return res.json({ ok: true, data: [] });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /api/foxtrot/archivos — historial de importaciones ──────────────────
router.get('/archivos', async (req, res) => {
  try {
    const result = await query(`
      SELECT
        archivo,
        MAX(fecha_import)  AS fecha_import,
        MIN(fecha)         AS fecha_desde,
        MAX(fecha)         AS fecha_hasta,
        COUNT(*)::int      AS rutas,
        SUM(successful_customers)::int AS exitosos,
        SUM(failed_customers)::int     AS fallidos,
        SUM(imported_customers)::int   AS total_clientes,
        COUNT(DISTINCT driver_id)::int AS total_choferes,
        AVG(sequence_adherence)        AS seq_adherence_avg
      FROM foxtrot_rutas
      GROUP BY archivo
      ORDER BY MAX(fecha_import) DESC
    `);
    res.json({
      ok: true,
      data: result.rows.map(r => ({
        archivo:         r.archivo,
        fechaImport:     r.fecha_import,
        fechaDesde:      r.fecha_desde ? new Date(r.fecha_desde).toISOString().split('T')[0] : null,
        fechaHasta:      r.fecha_hasta ? new Date(r.fecha_hasta).toISOString().split('T')[0] : null,
        rutas:           r.rutas,
        exitosos:        r.exitosos,
        fallidos:        r.fallidos,
        totalClientes:   r.total_clientes,
        totalChoferes:   r.total_choferes,
        seqAdherenceAvg: Number(r.seq_adherence_avg) || 0,
      })),
    });
  } catch (err) {
    if (err.message.includes('does not exist')) return res.json({ ok: true, data: [] });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /api/foxtrot/kpis-por-chofer — acumulado agrupado por driver ─────────
// Acepta:
//   ?mes=YYYY-MM         → filtra exactamente ese mes (preferido)
//   ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD → rango manual
//   ?archivo=nombre      → filtrar por archivo específico
// Si no se pasa ningún filtro de fecha, devuelve TODOS los datos (útil para el
// historial global pero NO para el dashboard mensual — siempre pasá `mes`).
router.get('/kpis-por-chofer', async (req, res) => {
  try {
    let { desde, hasta, archivo, mes } = req.query;

    // Si viene "mes=YYYY-MM", lo convertimos a rango y sobreescribimos desde/hasta
    if (mes) {
      const rango = mesARango(mes);
      if (rango) {
        desde = rango.desde;
        hasta = rango.hasta;
      }
    }

    let cond = '1=1';
    const params = [];
    let i = 1;
    if (desde)   { cond += ` AND r.fecha >= $${i++}`;  params.push(desde); }
    if (hasta)   { cond += ` AND r.fecha <= $${i++}`;  params.push(hasta); }
    if (archivo) { cond += ` AND r.archivo = $${i++}`; params.push(archivo); }

    const result = await query(`
      SELECT
        r.driver_id,
        r.driver_name,
        MAX(r.chofer_mapeado)                           AS chofer_mapeado,
        COUNT(r.id)::int                                AS rutas,
        SUM(r.imported_customers)::int                  AS clientes_total,
        SUM(r.successful_customers)::int                AS exitosos,
        SUM(r.failed_customers)::int                    AS fallidos,
        SUM(r.planned_driving_meters)                   AS km_plan_metros,
        SUM(r.total_driven_meters)                      AS km_real_metros,
        SUM(r.planned_driving_seconds)                  AS seg_conduccion_plan,
        SUM(r.total_driven_seconds)                     AS seg_conduccion_real,
        SUM(r.planned_journey_seconds)                  AS seg_jornada_plan,
        SUM(r.total_journey_seconds)                    AS seg_jornada_real,
        AVG(r.sequence_adherence)                       AS seq_adherence_avg,
        SUM(r.seq_adhered_clicks)::int                  AS seq_adhered,
        SUM(r.seq_not_adhered_clicks)::int              AS seq_not_adhered,
        SUM(r.total_unauthorized_stops)::int            AS paradas_no_auth,
        SUM(r.total_unauthorized_stops_secs)            AS paradas_no_auth_secs,
        AVG(r.driver_click_score)                       AS click_score_avg
      FROM foxtrot_rutas r
      WHERE ${cond}
      GROUP BY r.driver_id, r.driver_name
      ORDER BY rutas DESC
    `, params);

    // Si no hay filas, devolvemos array vacío sin error
    if (result.rows.length === 0) {
      return res.json({ ok: true, data: [] });
    }

    // Cruzar con intentos para tasa de éxito real — misma condición de fechas
    // Reemplazamos el alias "r." en la condición para la tabla de intentos
    const condIntentos = cond.replace(/r\./g, '');
    const intentosRes = await query(`
      SELECT
        driver_id,
        COUNT(*)::int                                                   AS total_visitas,
        COUNT(*) FILTER (WHERE aggregate_visit_status = 'SUCCESSFUL')::int AS visitas_ok,
        COUNT(*) FILTER (WHERE aggregate_visit_status = 'FAILED')::int     AS visitas_fail,
        COUNT(*) FILTER (WHERE sequence_adherence_status = 'ADHERED')::int AS seq_adheridas,
        COUNT(*) FILTER (WHERE sequence_adherence_status = 'NOT_ADHERED')::int AS seq_no_adheridas,
        COUNT(*) FILTER (WHERE sequence_adherence_status = 'FORGIVEN')::int    AS seq_perdonadas
      FROM foxtrot_intentos
      WHERE ${condIntentos}
      GROUP BY driver_id
    `, params);

    const intentosMap = {};
    intentosRes.rows.forEach(r => { intentosMap[r.driver_id] = r; });

    let data = result.rows.map(r => {
      const att = intentosMap[r.driver_id] || {};
      return {
        driverId:           r.driver_id,
        driverName:         r.driver_name,
        choferMapeado:      r.chofer_mapeado,
        rutas:              r.rutas,
        clientesTotal:      r.clientes_total,
        exitosos:           r.exitosos,
        fallidos:           r.fallidos,
        kmPlanMetros:       Number(r.km_plan_metros)         || 0,
        kmRealMetros:       Number(r.km_real_metros)         || 0,
        segConduccionPlan:  Number(r.seg_conduccion_plan)    || 0,
        segConduccionReal:  Number(r.seg_conduccion_real)    || 0,
        segJornadaPlan:     Number(r.seg_jornada_plan)       || 0,
        segJornadaReal:     Number(r.seg_jornada_real)       || 0,
        seqAdhered:         r.seq_adhered,
        seqNotAdhered:      r.seq_not_adhered,
        paradasNoAuth:      r.paradas_no_auth,
        paradasNoAuthSecs:  Number(r.paradas_no_auth_secs)   || 0,
        clickScoreSum:      (Number(r.click_score_avg) || 0) * r.rutas,
        // De intentos
        totalVisitas:       Number(att.total_visitas)     || 0,
        visitasOk:          Number(att.visitas_ok)        || 0,
        visitasFail:        Number(att.visitas_fail)      || 0,
        seqAdheridas:       Number(att.seq_adheridas)     || 0,
        seqNoAdheridas:     Number(att.seq_no_adheridas)  || 0,
        seqPerdonadas:      Number(att.seq_perdonadas)    || 0,
      };
    });

    // Unificar choferes que coinciden por nombre/apellido (o mapeo manual) para no mostrarlos duplicados
    const unificados = {};
    data.forEach(ch => {
      const label = (ch.choferMapeado || ch.driverName || `Driver ${ch.driverId}`).trim();
      const clave = label.toLowerCase();

      if (!unificados[clave]) {
        unificados[clave] = {
          ...ch,
          driverId: ch.driverId,
          driverName: ch.driverName,
          choferMapeado: ch.choferMapeado || ch.driverName,
        };
      } else {
        const exist = unificados[clave];
        exist.rutas += ch.rutas;
        exist.clientesTotal += ch.clientesTotal;
        exist.exitosos += ch.exitosos;
        exist.fallidos += ch.fallidos;
        exist.kmPlanMetros += ch.kmPlanMetros;
        exist.kmRealMetros += ch.kmRealMetros;
        exist.segConduccionPlan += ch.segConduccionPlan;
        exist.segConduccionReal += ch.segConduccionReal;
        exist.segJornadaPlan += ch.segJornadaPlan;
        exist.segJornadaReal += ch.segJornadaReal;
        exist.seqAdhered += ch.seqAdhered;
        exist.seqNotAdhered += ch.seqNotAdhered;
        exist.paradasNoAuth += ch.paradasNoAuth;
        exist.paradasNoAuthSecs += ch.paradasNoAuthSecs;
        exist.clickScoreSum += ch.clickScoreSum;
        exist.totalVisitas += ch.totalVisitas;
        exist.visitasOk += ch.visitasOk;
        exist.visitasFail += ch.visitasFail;
        exist.seqAdheridas += ch.seqAdheridas;
        exist.seqNoAdheridas += ch.seqNoAdheridas;
        exist.seqPerdonadas += ch.seqPerdonadas;
      }
    });

    const mergedData = Object.values(unificados).map(ch => {
      const totalSeq = ch.seqAdhered + ch.seqNotAdhered;
      return {
        driverId: ch.driverId,
        driverName: ch.driverName,
        choferMapeado: ch.choferMapeado,
        rutas: ch.rutas,
        clientesTotal: ch.clientesTotal,
        exitosos: ch.exitosos,
        fallidos: ch.fallidos,
        tasaExito: ch.clientesTotal > 0 ? Math.round((ch.exitosos / ch.clientesTotal) * 100) : 0,
        kmPlanMetros: ch.kmPlanMetros,
        kmRealMetros: ch.kmRealMetros,
        segConduccionPlan: ch.segConduccionPlan,
        segConduccionReal: ch.segConduccionReal,
        segJornadaPlan: ch.segJornadaPlan,
        segJornadaReal: ch.segJornadaReal,
        seqAdherenceAvg: totalSeq > 0 ? ch.seqAdhered / totalSeq : 0,
        seqAdhered: ch.seqAdhered,
        seqNotAdhered: ch.seqNotAdhered,
        paradasNoAuth: ch.paradasNoAuth,
        paradasNoAuthSecs: ch.paradasNoAuthSecs,
        clickScoreAvg: ch.rutas > 0 ? Number((ch.clickScoreSum / ch.rutas).toFixed(2)) : 0,
        totalVisitas: ch.totalVisitas,
        visitasOk: ch.visitasOk,
        visitasFail: ch.visitasFail,
        seqAdheridas: ch.seqAdheridas,
        seqNoAdheridas: ch.seqNoAdheridas,
        seqPerdonadas: ch.seqPerdonadas,
      };
    });

    // Ordenar por rutas descendente para mantener la lógica de ranking
    mergedData.sort((a, b) => b.rutas - a.rutas);

    res.json({ ok: true, data: mergedData });
  } catch (err) {
    if (err.message.includes('does not exist')) return res.json({ ok: true, data: [] });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /api/foxtrot/importar ────────────────────────────────────────────────
// Body: { rutasRows: [...], intentosRows: [...], archivo: string, driverMap: [...] }
router.post('/importar', async (req, res) => {
  const { rutasRows = [], intentosRows = [], archivo = 'sin nombre', driverMap = [] } = req.body;

  if (!Array.isArray(rutasRows) || rutasRows.length === 0) {
    return res.status(400).json({ ok: false, error: 'No se enviaron rutas' });
  }

  // Construir mapa driverId → nombre/zona del chofer mapeado
  const driverById = {};
  driverMap.forEach(d => { driverById[String(d.id)] = d.nombre || null; });

  const parseFecha = (f) => {
    if (!f) return null;
    const s = String(f).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const dt = new Date(s);
    if (!isNaN(dt.getTime())) return dt.toISOString().split('T')[0];
    return null;
  };

  const toNum = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
  const toBool = (v) => v === true || v === 'True' || v === 'true' || v === '1';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── Insertar rutas en batch usando unnest ────────────────────────────────
    if (rutasRows.length > 0) {
      const cols = {
        archivo:[], dcId:[], dcName:[], routeId:[], routeName:[], fecha:[],
        driverId:[], driverName:[], choferMapeado:[],
        importedCustomers:[], successfulCustomers:[], failedCustomers:[],
        totalVisited:[], totalUnvisited:[],
        plannedDrivingMeters:[], totalDrivenMeters:[],
        plannedDrivingSeconds:[], totalDrivenSeconds:[],
        plannedJourneySeconds:[], totalJourneySeconds:[],
        seqAdherence:[], seqAdheredClicks:[], seqNotAdheredClicks:[],
        seqForgiven:[], seqNoDecision:[],
        totalUnauthorizedStops:[], totalUnauthorizedStopsSecs:[],
        totalAuthorizedStops:[], totalAuthorizedStopsSecs:[],
        driverClickScore:[], isDigitalRoute:[],
      };

      for (const r of rutasRows) {
        const dId = String(r['Driver ID'] ?? r.driverId ?? '');
        cols.archivo.push(archivo);
        cols.dcId.push(String(r['DC ID'] ?? r.dcId ?? ''));
        cols.dcName.push(String(r['DC Name'] ?? r.dcName ?? ''));
        cols.routeId.push(String(r['Route ID'] ?? r.routeId ?? ''));
        cols.routeName.push(String(r['Route Name'] ?? r.routeName ?? ''));
        cols.fecha.push(parseFecha(r['Planned Route Start Date'] ?? r.fecha));
        cols.driverId.push(dId);
        cols.driverName.push(String(r['Driver Name'] ?? r.driverName ?? ''));
        cols.choferMapeado.push(driverById[dId] || null);
        cols.importedCustomers.push(toNum(r['Imported Customers Count'] ?? r.importedCustomers));
        cols.successfulCustomers.push(toNum(r['Successful Customers Count'] ?? r.successfulCustomers));
        cols.failedCustomers.push(toNum(r['Failed Customers Count'] ?? r.failedCustomers));
        cols.totalVisited.push(toNum(r['Total Visited Customers Count'] ?? r.totalVisited));
        cols.totalUnvisited.push(toNum(r['Total Unvisited Customers Count'] ?? r.totalUnvisited));
        cols.plannedDrivingMeters.push(toNum(r['Planned Foxtrot Driving Meters'] ?? r.plannedDrivingMeters));
        cols.totalDrivenMeters.push(toNum(r['Total Driven Meters'] ?? r.totalDrivenMeters));
        cols.plannedDrivingSeconds.push(toNum(r['Planned Foxtrot Driving Seconds'] ?? r.plannedDrivingSeconds));
        cols.totalDrivenSeconds.push(toNum(r['Total Driven Seconds'] ?? r.totalDrivenSeconds));
        cols.plannedJourneySeconds.push(toNum(r['Planned Foxtrot Journey Seconds'] ?? r.plannedJourneySeconds));
        cols.totalJourneySeconds.push(toNum(r['Total Journey Seconds'] ?? r.totalJourneySeconds));
        cols.seqAdherence.push(toNum(r['Sequence Adherence'] ?? r.seqAdherence));
        cols.seqAdheredClicks.push(toNum(r['Total Sequence Adhered Clicks'] ?? r.seqAdheredClicks));
        cols.seqNotAdheredClicks.push(toNum(r['Total Sequence Not Adhered Clicks'] ?? r.seqNotAdheredClicks));
        cols.seqForgiven.push(toNum(r['Total Sequence Forgiven Clicks'] ?? r.seqForgiven));
        cols.seqNoDecision.push(toNum(r['Total Sequence Adhered Clicks with No Decision'] ?? r.seqNoDecision));
        cols.totalUnauthorizedStops.push(toNum(r['Total Unauthorized Stops Count'] ?? r.totalUnauthorizedStops));
        cols.totalUnauthorizedStopsSecs.push(toNum(r['Total Unauthorized Stops Seconds'] ?? r.totalUnauthorizedStopsSecs));
        cols.totalAuthorizedStops.push(toNum(r['Total Authorized Stops Count'] ?? r.totalAuthorizedStops));
        cols.totalAuthorizedStopsSecs.push(toNum(r['Total Authorized Stops Seconds'] ?? r.totalAuthorizedStopsSecs));
        cols.driverClickScore.push(toNum(r['Driver Click Score'] ?? r.driverClickScore));
        cols.isDigitalRoute.push(toBool(r['Is Digital Route'] ?? r.isDigitalRoute));
      }

      await client.query(`
        INSERT INTO foxtrot_rutas (
          archivo, dc_id, dc_name, route_id, route_name, fecha,
          driver_id, driver_name, chofer_mapeado,
          imported_customers, successful_customers, failed_customers,
          total_visited_customers, total_unvisited_customers,
          planned_driving_meters, total_driven_meters,
          planned_driving_seconds, total_driven_seconds,
          planned_journey_seconds, total_journey_seconds,
          sequence_adherence, seq_adhered_clicks, seq_not_adhered_clicks,
          seq_forgiven_clicks, seq_no_decision_clicks,
          total_unauthorized_stops, total_unauthorized_stops_secs,
          total_authorized_stops, total_authorized_stops_secs,
          driver_click_score, is_digital_route
        )
        SELECT
          unnest($1::text[]), unnest($2::text[]), unnest($3::text[]),
          unnest($4::text[]), unnest($5::text[]), unnest($6::date[]),
          unnest($7::text[]), unnest($8::text[]), unnest($9::text[]),
          unnest($10::numeric[]), unnest($11::numeric[]), unnest($12::numeric[]),
          unnest($13::numeric[]), unnest($14::numeric[]),
          unnest($15::numeric[]), unnest($16::numeric[]),
          unnest($17::numeric[]), unnest($18::numeric[]),
          unnest($19::numeric[]), unnest($20::numeric[]),
          unnest($21::numeric[]), unnest($22::numeric[]), unnest($23::numeric[]),
          unnest($24::numeric[]), unnest($25::numeric[]),
          unnest($26::numeric[]), unnest($27::numeric[]),
          unnest($28::numeric[]), unnest($29::numeric[]),
          unnest($30::numeric[]), unnest($31::boolean[])
      `, [
        cols.archivo, cols.dcId, cols.dcName, cols.routeId, cols.routeName, cols.fecha,
        cols.driverId, cols.driverName, cols.choferMapeado,
        cols.importedCustomers, cols.successfulCustomers, cols.failedCustomers,
        cols.totalVisited, cols.totalUnvisited,
        cols.plannedDrivingMeters, cols.totalDrivenMeters,
        cols.plannedDrivingSeconds, cols.totalDrivenSeconds,
        cols.plannedJourneySeconds, cols.totalJourneySeconds,
        cols.seqAdherence, cols.seqAdheredClicks, cols.seqNotAdheredClicks,
        cols.seqForgiven, cols.seqNoDecision,
        cols.totalUnauthorizedStops, cols.totalUnauthorizedStopsSecs,
        cols.totalAuthorizedStops, cols.totalAuthorizedStopsSecs,
        cols.driverClickScore, cols.isDigitalRoute,
      ]);
    }

    // ── Insertar intentos en batch ───────────────────────────────────────────
    if (intentosRows.length > 0) {
      const ic = {
        archivo:[], dcName:[], routeId:[], driverId:[], driverName:[], choferMapeado:[],
        fecha:[], customerId:[], customerName:[], locationConfidence:[],
        visitStartTs:[], visitDurationSecs:[], visitMetersFromCust:[],
        aggregateVisitStatus:[], sequenceAdherenceStatus:[],
        suspiciousDriveBy:[], inferredServiceSecs:[],
      };

      for (const r of intentosRows) {
        const dId = String(r['Driver ID'] ?? r.driverId ?? '');
        ic.archivo.push(archivo);
        ic.dcName.push(String(r['DC Name'] ?? r.dcName ?? ''));
        ic.routeId.push(String(r['Route ID'] ?? r.routeId ?? ''));
        ic.driverId.push(dId);
        ic.driverName.push(String(r['Driver Name'] ?? r.driverName ?? ''));
        ic.choferMapeado.push(driverById[dId] || null);
        ic.fecha.push(parseFecha(r['Planned Route Start Date'] ?? r.fecha));
        ic.customerId.push(String(r['Customer ID'] ?? r.customerId ?? ''));
        ic.customerName.push(String(r['Customer Name'] ?? r.customerName ?? ''));
        ic.locationConfidence.push(String(r['Customer Location Confidence'] ?? r.locationConfidence ?? ''));
        ic.visitStartTs.push(r['Visit Start Timestamp'] ?? r.visitStartTs ?? null);
        ic.visitDurationSecs.push(toNum(r['Visit Duration Seconds'] ?? r.visitDurationSecs));
        ic.visitMetersFromCust.push(toNum(r['Visit Meters from Customer'] ?? r.visitMetersFromCust));
        ic.aggregateVisitStatus.push(String(r['Aggregate Visit Status'] ?? r.aggregateVisitStatus ?? ''));
        ic.sequenceAdherenceStatus.push(String(r['Sequence Adherence Status'] ?? r.sequenceAdherenceStatus ?? ''));
        ic.suspiciousDriveBy.push(toBool(r['Beta: Suspicious Drive By Attempt Flag'] ?? r.suspiciousDriveBy));
        ic.inferredServiceSecs.push(toNum(r['Beta: Inferred Service Duration Seconds'] ?? r.inferredServiceSecs));
      }

      await client.query(`
        INSERT INTO foxtrot_intentos (
          archivo, dc_name, route_id, driver_id, driver_name, chofer_mapeado,
          fecha, customer_id, customer_name, location_confidence,
          visit_start_ts, visit_duration_secs, visit_meters_from_cust,
          aggregate_visit_status, sequence_adherence_status,
          suspicious_drive_by, inferred_service_secs
        )
        SELECT
          unnest($1::text[]), unnest($2::text[]), unnest($3::text[]),
          unnest($4::text[]), unnest($5::text[]), unnest($6::text[]),
          unnest($7::date[]), unnest($8::text[]), unnest($9::text[]), unnest($10::text[]),
          unnest($11::text[]), unnest($12::numeric[]), unnest($13::numeric[]),
          unnest($14::text[]), unnest($15::text[]),
          unnest($16::boolean[]), unnest($17::numeric[])
      `, [
        ic.archivo, ic.dcName, ic.routeId, ic.driverId, ic.driverName, ic.choferMapeado,
        ic.fecha, ic.customerId, ic.customerName, ic.locationConfidence,
        ic.visitStartTs, ic.visitDurationSecs, ic.visitMetersFromCust,
        ic.aggregateVisitStatus, ic.sequenceAdherenceStatus,
        ic.suspiciousDriveBy, ic.inferredServiceSecs,
      ]);
    }

    await client.query('COMMIT');
    console.log(`[foxtrot/importar] OK rutas=${rutasRows.length} intentos=${intentosRows.length}`);
    res.status(201).json({ ok: true, resultado: { rutas: rutasRows.length, intentos: intentosRows.length } });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[foxtrot/importar] ROLLBACK:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

// ── DELETE /api/foxtrot/archivo/:nombre ──────────────────────────────────────
router.delete('/archivo/:nombre', async (req, res) => {
  try {
    const archivo = decodeURIComponent(req.params.nombre);
    const r1 = await query('DELETE FROM foxtrot_rutas    WHERE archivo = $1 RETURNING id', [archivo]);
    const r2 = await query('DELETE FROM foxtrot_intentos WHERE archivo = $1 RETURNING id', [archivo]);
    res.json({ ok: true, rutasEliminadas: r1.rowCount, intentosEliminados: r2.rowCount });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /api/foxtrot/verificar/:archivo ──────────────────────────────────────
router.get('/verificar/:archivo', async (req, res) => {
  try {
    const archivo = decodeURIComponent(req.params.archivo);
    const result = await query(
      'SELECT COUNT(*)::int AS cantidad FROM foxtrot_rutas WHERE archivo = $1',
      [archivo]
    );
    const cantidad = result.rows[0]?.cantidad || 0;
    res.json({ ok: true, existe: cantidad > 0, cantidad });
  } catch (err) {
    if (err.message.includes('does not exist')) return res.json({ ok: true, existe: false, cantidad: 0 });
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;