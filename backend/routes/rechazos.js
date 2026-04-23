// routes/rechazos.js — CRUD completo de rechazos
// IMPORTANTE: rutas específicas SIEMPRE antes de /:id
const express = require("express");
const router = express.Router();
const { pool, query } = require("../db");
const { comprimir, descomprimirSafe } = require("../compress");
const storage = require("../storage");
const { actualizarKPIMensual } = require("../utils/kpi_utils");

function clasificarMotivo(motivo) {
  const m = String(motivo || "")
    .toUpperCase()
    .replace(/Á/g, "A").replace(/É/g, "E").replace(/Í/g, "I")
    .replace(/Ó/g, "O").replace(/Ú/g, "U").replace(/Ü/g, "U")
    .trim();
  const logistica   = ["CERRADO","ERROR DISTRIBUCION","NO HIZO PEDIDO","NO BAJO PEDIDO","SIN DINERO"];
  const facturacion = ["ERROR PREVENTA","ERROR ADMIN","DEVOLUCION INTERNA","SIN STOCK"];
  if (logistica.some((p) => m === p || m.includes(p)))   return "logistica";
  if (facturacion.some((p) => m === p || m.includes(p))) return "facturacion";
  return "otro";
}

async function filaARec(f) {
  let meta = {};
  if (f.metadata_gz) {
    meta = await descomprimirSafe(f.metadata_gz, {});
  }
  return {
    id:               Number(f.id),
    archivo:          f.archivo,
    fechaImport:      f.fecha_import,
    fecha:            f.fecha ? new Date(f.fecha).toISOString().substring(0, 10) : null,
    articulo:         f.articulo,
    articuloDesc:     (meta && meta.ad) || f.articulo_desc,
    bultos:           Number(f.bultos) || 0,
    bultosRechazados: Number(f.bultos_rechazados) || 0,
    hl:               Number(f.hl) || 0,
    hlRechazado:      Number(f.hl_rechazado) || 0,
    importeNeto:      Number(f.importe_neto) || 0,
    importeRechazado: Number(f.importe_rechazado) || 0,
    motivo:           f.motivo,
    motivoDesc:       (meta && meta.md) || f.motivo_desc,
    tipoMotivo:       f.tipo_motivo,
    clienteId:        f.cliente_id,
    clienteDesc:      (meta && meta.cd) || f.cliente_desc,
    domicilio:        (meta && meta.dm) || f.domicilio,
    canal:            f.canal,
    canalDesc:        f.canal_desc,
    chofer:           f.chofer,
    choferDesc:       f.chofer_desc,
    ruta:             f.ruta,
    rutaDesc:         (meta && meta.rd) || f.ruta_desc,
    rechazoTotal:     f.rechazo_total,
    transporteId:     f.transporte_id,
  };
}

// ── GET /api/rechazos ─────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const { desde, hasta, chofer, tipo, mes } = req.query;
    let q = "SELECT * FROM rechazos WHERE 1=1";
    const params = [];
    let i = 1;

    if (mes) {
      q += ` AND TO_CHAR(fecha, 'YYYY-MM') = $${i++}`;
      params.push(mes);
    } else {
      if (desde)  { q += ` AND fecha >= $${i++}`; params.push(desde); }
      if (hasta)  { q += ` AND fecha <= $${i++}`; params.push(hasta); }
    }
    
    if (chofer) { q += ` AND chofer_desc ILIKE $${i++}`;     params.push(`%${chofer}%`); }
    if (tipo)   { q += ` AND tipo_motivo = $${i++}`;         params.push(tipo); }
    q += " ORDER BY fecha DESC, id DESC LIMIT 10000";
    console.log("[GET /api/rechazos] Q:", q, "P:", params);
    const result = await query(q, params);
    const data = [];
    const logs = [];
    logs.push(`Query: ${q}`);
    logs.push(`Params: ${JSON.stringify(params)}`);
    logs.push(`Rows found: ${result.rowCount}`);

    for (const r of result.rows) {
      try {
        data.push(await filaARec(r));
      } catch (e) {
        logs.push(`Error in row ${r.id}: ${e.message}`);
      }
    }

    // --- FALLBACK R2 ---
    if (data.length === 0 && mes) {
      try {
        const archived = await storage.download(`rechazos/detalle_${mes}.json`);
        if (archived && Array.isArray(archived)) {
          logs.push(`📦 Cargado desde R2 (mes ${mes})`);
          for (const r of archived) {
            // Adaptar nombres de campos si vienen de la tabla (S3 guarda el JSON de la fila SQL)
            data.push(await filaARec(r));
          }
        }
      } catch (err) {
        logs.push(`⚠ Error buscando en R2: ${err.message}`);
      }
    }

    res.json({ ok: true, data, debug: logs });
  } catch (err) {
    console.error("GET /api/rechazos ERROR:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /api/rechazos/bultos-por-mes ─────────────────────────────────────────
// Calcula bultos PEDIDOS agrupados por mes y chofer desde los datos ya en BD.
// Excluye artículos 2776, 2705, 2731 igual que el frontend.
// No requiere reimportar — usa lo que ya está en Neon.
router.get("/bultos-por-mes", async (req, res) => {
  try {
    // 1. Intentar obtener datos de la tabla de KPIs (mucho más rápido)
    const kpiRes = await query(`
      SELECT mes, chofer, (datos_json->>'bultos_pedidos')::numeric as bultos
      FROM kpis_mensuales
      WHERE source = 'rechazos'
      ORDER BY mes, chofer
    `);

    const xMes = {};
    
    // Poblar con lo que ya tenemos resumido
    kpiRes.rows.forEach(row => {
      const mes = row.mes;
      const cId = String(row.chofer || '').trim();
      const b   = Number(row.bultos) || 0;
      if (!xMes[mes]) xMes[mes] = { total: 0, porChofer: {} };
      xMes[mes].total += b;
      xMes[mes].porChofer[cId] = (xMes[mes].porChofer[cId] || 0) + b;
    });

    // 2. Para los meses que NO están en KPIs (probablemente los más recientes),
    // consultamos la tabla real.
    const mesesYaResumidos = Object.keys(xMes);
    let condMeses = "";
    if (mesesYaResumidos.length > 0) {
      condMeses = `AND TO_CHAR(fecha, 'YYYY-MM') NOT IN (${mesesYaResumidos.map((_,idx)=>`$${idx+1}`).join(',')})`;
    }

    const result = await query(`
      SELECT
        TO_CHAR(fecha, 'YYYY-MM') AS mes,
        chofer                     AS chofer_id,
        SUM(bultos)                AS bultos_pedidos
      FROM rechazos
      WHERE articulo NOT IN ('2776', '2705', '2731')
        AND fecha IS NOT NULL
        AND bultos > 0
        ${condMeses}
      GROUP BY TO_CHAR(fecha, 'YYYY-MM'), chofer
      ORDER BY mes, chofer
    `, mesesYaResumidos);

    result.rows.forEach(row => {
      const mes = row.mes;
      const cId = String(row.chofer_id || '').trim();
      const b   = Number(row.bultos_pedidos) || 0;
      if (!xMes[mes]) xMes[mes] = { total: 0, porChofer: {} };
      xMes[mes].total += b;
      if (cId) xMes[mes].porChofer[cId] = (xMes[mes].porChofer[cId] || 0) + b;
    });

    // Redondear
    Object.keys(xMes).forEach(m => {
      xMes[m].total = Math.round(xMes[m].total);
      Object.keys(xMes[m].porChofer).forEach(id => {
        xMes[m].porChofer[id] = Math.round(xMes[m].porChofer[id]);
      });
    });

    console.log('[bultos-por-mes] meses calculados:', Object.keys(xMes));
    res.json({ ok: true, data: xMes });
  } catch (err) {
    if (err.message.includes("does not exist")) return res.json({ ok: true, data: {} });
    console.error('GET /rechazos/bultos-por-mes:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /api/rechazos/archivos ────────────────────────────────────────────────
router.get("/archivos", async (req, res) => {
  try {
    const result = await query(`
      SELECT
        COALESCE(NULLIF(TRIM(archivo), ''), '(sin nombre)') AS archivo,
        COUNT(*)::int                             AS cantidad,
        MAX(fecha_import)                         AS fecha_import,
        MIN(fecha)                                AS fecha_desde,
        MAX(fecha)                                AS fecha_hasta,
        SUM(bultos_rechazados)::numeric           AS bultos_total,
        SUM(importe_rechazado)::numeric           AS importe_total,
        SUM(COALESCE(hl,0))::numeric              AS hl_total,
        SUM(COALESCE(hl_rechazado,0))::numeric    AS hl_rech_total,
        COUNT(CASE WHEN tipo_motivo='logistica'   THEN 1 END)::int AS log_n,
        COUNT(CASE WHEN tipo_motivo='facturacion' THEN 1 END)::int AS fact_n
      FROM rechazos
      GROUP BY COALESCE(NULLIF(TRIM(archivo), ''), '(sin nombre)')
      ORDER BY MAX(fecha_import) DESC NULLS LAST
    `);
    res.json({
      ok: true,
      data: result.rows.map(r => ({
        archivo:     r.archivo,
        cantidad:    r.cantidad,
        fechaImport: r.fecha_import,
        fechaDesde:  r.fecha_desde ? new Date(r.fecha_desde).toISOString().split("T")[0] : null,
        fechaHasta:  r.fecha_hasta ? new Date(r.fecha_hasta).toISOString().split("T")[0] : null,
        bultos:      Number(r.bultos_total)    || 0,
        importe:     Number(r.importe_total)   || 0,
        hlTotal:     Number(r.hl_total)        || 0,
        hlRechTotal: Number(r.hl_rech_total)   || 0,
        logistica:   r.log_n,
        facturacion: r.fact_n,
      })),
    });
  } catch (err) {
    if (err.message.includes("does not exist")) return res.json({ ok: true, data: [] });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /api/rechazos/verificar/:archivo ─────────────────────────────────────
router.get("/verificar/:archivo", async (req, res) => {
  try {
    const archivo = decodeURIComponent(req.params.archivo);
    const result = await query(
      `SELECT COUNT(*) AS cantidad, MAX(fecha_import) AS primera
       FROM rechazos
       WHERE COALESCE(NULLIF(TRIM(archivo),''),'(sin nombre)') = $1`,
      [archivo],
    );
    const row = result.rows[0];
    res.json({ ok: true, existe: Number(row.cantidad) > 0, cantidad: Number(row.cantidad), primera: row.primera });
  } catch (err) {
    if (err.message.includes("does not exist")) return res.json({ ok: true, existe: false, cantidad: 0 });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /api/rechazos/importar ───────────────────────────────────────────────
router.post("/importar", async (req, res) => {
  const { rows = [], archivo = "sin nombre" } = req.body;
  if (!Array.isArray(rows) || rows.length === 0)
    return res.status(400).json({ ok: false, error: "No se enviaron filas" });

  console.log(`[rechazos/importar] archivo="${archivo}" rows=${rows.length}`);

  // Respaldar en Cloudflare R2 (Asíncrono para no bloquear la respuesta)
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  storage.upload(`rechazos/backup_${timestamp}_${archivo.replace(/\s+/g, '_')}.json`, rows)
    .catch(err => console.error("⚠ Falló el backup en R2:", err.message));

  function parseFecha(f) {
    if (!f) return null;
    const s = String(f).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const dt = new Date(s);
    if (!isNaN(dt.getTime())) {
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, "0");
      const d = String(dt.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
    return null;
  }

  const cols = {
    archivo:[], fecha:[], articulo:[], articuloDesc:[],
    bultos:[], bultosR:[], hl:[], hlRech:[],
    impNeto:[], impRech:[], motivo:[], motivoDesc:[], tipo: [],
    clienteId:[], clienteDesc:[], domicilio:[],
    canal:[], canalDesc:[], chofer:[], choferDesc:[],
    transporteId:[], ruta:[], rutaDesc:[], recTotal:[],
    metadata_gz: [],
  };

  for (const r of rows) {
    cols.archivo.push(archivo);
    cols.fecha.push(parseFecha(r.fecha));
    cols.articulo.push(String(r.articulo || ""));
    cols.articuloDesc.push(String(r.articuloDesc || ""));
    cols.bultos.push(isNaN(Number(r.bultos)) ? 0 : Number(r.bultos));
    cols.bultosR.push(isNaN(Number(r.bultosRechazados)) ? 0 : Number(r.bultosRechazados));
    cols.hl.push(isNaN(Number(r.hl)) ? 0 : Number(r.hl));
    cols.hlRech.push(isNaN(Number(r.hlRechazado)) ? 0 : Number(r.hlRechazado));
    cols.impNeto.push(isNaN(Number(r.importeNeto)) ? 0 : Number(r.importeNeto));
    cols.impRech.push(isNaN(Number(r.importeRechazado)) ? 0 : Number(r.importeRechazado));
    cols.motivo.push(String(r.motivo || ""));
    cols.motivoDesc.push(String(r.motivoDesc || ""));
    cols.tipo.push(clasificarMotivo(r.motivoDesc || r.motivo));
    cols.clienteId.push(String(r.clienteId || ""));
    cols.clienteDesc.push(String(r.clienteDesc || ""));
    cols.domicilio.push(String(r.domicilio || ""));
    cols.canal.push(String(r.canal || ""));
    cols.canalDesc.push(String(r.canalDesc || ""));
    cols.chofer.push(String(r.chofer || ""));
    cols.choferDesc.push(String(r.choferDesc || ""));
    cols.transporteId.push(String(r.transporteId || ""));
    cols.ruta.push(String(r.ruta || ""));
    cols.rutaDesc.push(String(r.rutaDesc || ""));
    cols.recTotal.push(r.rechazoTotal === true || r.rechazoTotal === "true" || r.rechazoTotal === "SI");

    // Compresión de detalles
    const meta = {
      ad: String(r.articuloDesc || ""),
      md: String(r.motivoDesc || ""),
      cd: String(r.clienteDesc || ""),
      dm: String(r.domicilio || ""),
      rd: String(r.rutaDesc || "")
    };
    const gz = await comprimir(meta);
    cols.metadata_gz.push(gz);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      INSERT INTO rechazos
        (archivo, fecha_import, fecha, articulo, articulo_desc, bultos, bultos_rechazados,
         hl, hl_rechazado, importe_neto, importe_rechazado, motivo, motivo_desc, tipo_motivo,
         cliente_id, cliente_desc, domicilio, canal, canal_desc,
         chofer, chofer_desc, transporte_id, ruta, ruta_desc, rechazo_total, metadata_gz)
      SELECT
        unnest($1::text[]), NOW(), unnest($2::date[]), unnest($3::text[]), 
        '(comprimido)', -- Vaciamos original
        unnest($4::numeric[]), unnest($5::numeric[]), unnest($6::numeric[]), unnest($7::numeric[]),
        unnest($8::numeric[]), unnest($9::numeric[]), unnest($10::text[]), 
        '(comprimido)', -- Vaciamos original
        unnest($11::text[]), unnest($12::text[]), 
        '(comprimido)', '(comprimido)', -- Vaciamos original
        unnest($13::text[]), unnest($14::text[]),
        unnest($15::text[]), unnest($16::text[]), unnest($17::text[]), unnest($18::text[]), 
        '(comprimido)', -- Vaciamos original
        unnest($19::boolean[]), unnest($20::bytea[])
    `, [
      cols.archivo, cols.fecha, cols.articulo,
      cols.bultos, cols.bultosR, cols.hl, cols.hlRech,
      cols.impNeto, cols.impRech, cols.motivo, cols.tipo,
      cols.clienteId, cols.canal, cols.canalDesc,
      cols.chofer, cols.choferDesc, cols.transporteId, cols.ruta,
      cols.recTotal, cols.metadata_gz
    ]);
    await client.query("COMMIT");
    console.log(`[rechazos/importar] OK=${rows.length}`);
    
    // Calcular KPIs resumidos para este mes/choferes (Asíncrono)
    const choferesUnicos = [...new Set(rows.map(r => String(r.choferDesc || '').trim()))].filter(Boolean);
    const mes = rows[0]?.fecha ? rows[0].fecha.slice(0, 7) : null;
    if (mes) {
      Promise.all(choferesUnicos.map(c => actualizarKPIMensual(mes, c, 'rechazos')))
        .catch(err => console.error("⚠ Falló actualización de KPIs Rechazos:", err.message));
    }

    res.status(201).json({ ok: true, resultado: { ok: rows.length, fail: 0, errores: [] } });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[rechazos/importar] ROLLBACK:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

// ── DELETE /api/rechazos/archivo/:nombre ─────────────────────────────────────
router.delete("/archivo/:nombre", async (req, res) => {
  try {
    const archivo = decodeURIComponent(req.params.nombre);
    const result = await query("DELETE FROM rechazos WHERE archivo = $1 RETURNING id", [archivo]);
    res.json({ ok: true, eliminados: result.rowCount });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── PUT /api/rechazos/:id ─────────────────────────────────────────────────────
router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });
  const r = req.body;
  try {
    const tipo = clasificarMotivo(r.motivoDesc || r.motivo);
    const result = await query(
      `UPDATE rechazos SET
        fecha=$1, articulo=$2, articulo_desc=$3,
        bultos=$4, bultos_rechazados=$5,
        importe_neto=$6, importe_rechazado=$7,
        motivo=$8, motivo_desc=$9, tipo_motivo=$10,
        cliente_desc=$11, domicilio=$12, chofer_desc=$13
      WHERE id=$14 RETURNING *`,
      [
        r.fecha || null, r.articulo || "", r.articuloDesc || "",
        r.bultos || 0, r.bultosRechazados || 0,
        r.importeNeto || 0, r.importeRechazado || 0,
        r.motivo || "", r.motivoDesc || "", tipo,
        r.clienteDesc || "", r.domicilio || "", r.choferDesc || "",
        id,
      ],
    );
    if (result.rowCount === 0) return res.status(404).json({ ok: false, error: "No encontrado" });
    res.json({ ok: true, data: filaARec(result.rows[0]) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── DELETE /api/rechazos/:id ──────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });
  try {
    await query("DELETE FROM rechazos WHERE id=$1", [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /api/rechazos/deduplicar ─────────────────────────────────────────────
router.post("/deduplicar", async (req, res) => {
  try {
    const result = await query(`
      DELETE FROM rechazos
      WHERE id NOT IN (
        SELECT MIN(id) FROM rechazos
        GROUP BY fecha, cliente_id, COALESCE(cliente_desc,''), articulo,
                 bultos_rechazados, motivo, COALESCE(chofer,'')
      ) RETURNING id
    `);
    res.json({ ok: true, eliminados: result.rowCount, mensaje: `Se eliminaron ${result.rowCount} registros duplicados` });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = { router };