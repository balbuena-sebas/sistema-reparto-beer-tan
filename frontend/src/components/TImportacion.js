import React, { useState, useRef, useMemo } from 'react';
import { fn, tod } from '../utils/helpers';
import * as XLSX from 'xlsx';
import { TRechazos as VistaRechazosCompleta } from './TRechazos';
import { getArchivosRechazos, eliminarArchivoRechazos, deduplicarRechazos } from '../api/client';

// ─── Parsear CSV Foxtrot ──────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  // Parseo seguro de CSV con campos entre comillas
  const parseLine = (line) => {
    const cols = [];
    let cur = '', inQ = false;
    for (let ch of line) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    cols.push(cur.trim());
    return cols;
  };
  const headers = parseLine(lines[0]);
  return lines.slice(1)
    .map(l => { const c = parseLine(l); const o = {}; headers.forEach((h, i) => { o[h] = c[i] || ''; }); return o; })
    .filter(r => r['Nombre del Cliente'] || r['Nombre(s) del Producto']);
}

// ─── Agrupar CSV por ruta/driver ──────────────────────────────────────────────
function agruparPorRuta(rows, driverMap = []) {
  const map = {};
  const driverById = {};
  driverMap.forEach(d => { driverById[String(d.id)] = { nombre: d.nombre, zona: d.zona || null }; });

  rows.forEach(r => {
    const rutaId  = r['ID de las rutas'] || '?';
    const driverId = r['Driver id'] || '';
    const driverInfo = driverById[driverId] || null;
    if (!map[rutaId]) {
      map[rutaId] = {
        rutaId,
        driverId,
        choferNombre: driverInfo?.nombre || null,
        zonaDriver:   driverInfo?.zona   || null,
        clientes: {},
        totalBultos: 0,
        totalClientes: 0,
      };
    }
    const cliente  = r['Nombre del Cliente'] || '—';
    const prod     = r['Nombre(s) del Producto'] || '—';
    const cant     = parseFloat(r['Cantidad de Producto']) || 0;
    const domicilio = r['Domicilio'] || '';
    const lat      = r['Latitud'];
    const lng      = r['Longitud'];

    if (!map[rutaId].clientes[cliente]) {
      map[rutaId].clientes[cliente] = { cliente, domicilio, lat, lng, productos: [], totalBultos: 0 };
      map[rutaId].totalClientes++;
    }
    map[rutaId].clientes[cliente].productos.push({ prod, cant });
    map[rutaId].clientes[cliente].totalBultos += cant;
    map[rutaId].totalBultos += cant;
  });

  return Object.values(map)
    .map(r => ({ ...r, clientes: Object.values(r.clientes).sort((a, b) => b.totalBultos - a.totalBultos) }))
    .sort((a, b) => b.totalBultos - a.totalBultos);
}

// ─── Parsear Excel rechazos (.xlsx o .xlsm) ──────────────────────────────────
// Estructura confirmada del archivo real (fila 1 vacía, encabezados en fila 2):
// Col 1:EMPRESA | 2:DOCUMENTO | 3:LETRA | 4:SERIE | 5:NÚMERO | 6:DETALLE DOCUMENTO
// Col 7:SIN CARGO | 8:ARTÍCULO | 9:DESCRIPCIÓN ARTÍCULO | 10:DESCRIPCIÓN DETALLADA ARTÍCULO
// Col 11:BULTOS | 12:BULTOS RECHAZADOS | 13:IMPORTE NETO | 14:IMPORTE NETO RECHAZADO
// Col 19:FECHA | 20:RECHAZO | 21:MOTIVO DE RECHAZO | 22:DESCRIPCIÓN DETALLADA MOTIVO
// Col 23:CLIENTE | 24:DESCRIPCIÓN CLIENTE | 26:DOMICILIO CLIENTE
// Col 27:CANAL | 28:DESCRIPCIÓN CANAL
// Col 33:RUTA | 34:DESCRIPCIÓN RUTA
// Col 39:CHOFER | 40:DESCRIPCIÓN CHOFER
// Col 50:RECHAZO\nTOTAL

// Normaliza: sin tildes, sin saltos de línea, sin espacios dobles, mayúsculas
const normStr = s => String(s || '').toUpperCase()
  .replace(/Á/g,'A').replace(/É/g,'E').replace(/Í/g,'I')
  .replace(/Ó/g,'O').replace(/Ú/g,'U').replace(/Ü/g,'U')
  .replace(/\n/g,' ').replace(/\r/g,' ').replace(/\s+/g,' ').trim();

// Busca valor de una celda probando múltiples nombres de columna (normalizados)
// eslint-disable-next-line no-unused-vars
function buscarCol(row, ...variantes) {
  // 1. Exacto primero
  for (const v of variantes) {
    if (row[v] !== undefined && row[v] !== null && row[v] !== '') return row[v];
  }
  // 2. Normalizado (sin tildes, mayúsculas, sin saltos de línea)
  const keysNorm = Object.keys(row).map(k => ({ k, n: normStr(k) }));
  for (const v of variantes) {
    const vn = normStr(v);
    const found = keysNorm.find(x => x.n === vn);
    if (found && row[found.k] !== undefined && row[found.k] !== null && row[found.k] !== '')
      return row[found.k];
  }
  return null;
}

// Convierte fecha de CUALQUIER formato a YYYY-MM-DD
function parseFecha(f) {
  if (!f) return null;

  // Si ya es un objeto Date (SheetJS con cellDates:true lo convierte)
  if (f instanceof Date) {
    if (isNaN(f.getTime())) return null;
    const y = f.getFullYear();
    const m = String(f.getMonth()+1).padStart(2,'0');
    const d = String(f.getDate()).padStart(2,'0');
    return `${y}-${m}-${d}`;
  }

  const s = String(f).trim();

  // ISO: "2026-03-02" o "2026-03-02T00:00:00"
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  // DD/MM/YYYY
  if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(s)) {
    const [d, m, y] = s.split('/');
    return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }

  // Número serial de Excel
  const n = Number(s);
  if (!isNaN(n) && n > 40000 && n < 60000) {
    const dt = new Date(Date.UTC(1899,11,30) + n * 86400000);
    return dt.toISOString().slice(0,10);
  }

  // Cualquier string parseable por Date (ej: "Mon Mar 02 2026 ...")
  try {
    const dt = new Date(s);
    if (!isNaN(dt.getTime())) {
      const y = dt.getFullYear();
      const m = String(dt.getMonth()+1).padStart(2,'0');
      const d = String(dt.getDate()).padStart(2,'0');
      return `${y}-${m}-${d}`;
    }
  } catch { /* ignorar */ }

  return null;
}

function parseExcelRechazos(arrayBuffer) {
  // ── 1. Leer el workbook ─────────────────────────────────────────────────
  let wb;
  try {
    wb = XLSX.read(arrayBuffer, { type: 'array', bookVBA: false, cellDates: true });
  } catch {
    try {
      wb = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array', bookVBA: false });
    } catch (e) {
      throw new Error(
        `No se pudo leer el archivo. Intentá abrirlo en Excel y guardarlo como .xlsx. Error: ${e.message}`
      );
    }
  }

  // ── 2. Buscar hoja BASE ─────────────────────────────────────────────────
  const nombreBase = wb.SheetNames.find(n => n.trim().toUpperCase() === 'BASE');
  if (!nombreBase) throw new Error(
    `No se encontró la hoja "BASE". Hojas disponibles: ${wb.SheetNames.join(', ')}`
  );
  const ws = wb.Sheets[nombreBase];

  // ── 3. Leer como array de arrays para detectar la fila de encabezados ──
  // Fila 1 está vacía, encabezados reales están en fila 2 (índice 1)
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  // Buscar la fila que tenga EXACTAMENTE "BULTOS RECHAZADOS" y "MOTIVO DE RECHAZO"
  // Estas dos columnas son únicas del reporte de rechazos
  let filaHeader = -1;
  for (let i = 0; i < Math.min(aoa.length, 20); i++) {
    const celdas = (aoa[i] || []).map(c => normStr(c));
    const tieneBR     = celdas.some(c => c === 'BULTOS RECHAZADOS');
    const tieneMotivo = celdas.some(c => c === 'MOTIVO DE RECHAZO');
    if (tieneBR && tieneMotivo) { filaHeader = i; break; }
  }

  if (filaHeader === -1) {
    const preview = aoa.slice(0,5).map((f,i) =>
      `Fila ${i+1}: ${(f||[]).slice(0,6).filter(Boolean).join(' | ')}`).join('\n');
    throw new Error(
      `No se encontraron los encabezados en la hoja BASE.\n\n` +
      `Se necesitan las columnas "BULTOS RECHAZADOS" y "MOTIVO DE RECHAZO".\n\n` +
      `Primeras filas:\n${preview}`
    );
  }

  // ── 4. Construir mapa col normalizado → índice ──────────────────────────
  const headerRow = (aoa[filaHeader] || []);
  // Construir índices por nombre normalizado
  const colIdx = {};
  headerRow.forEach((h, i) => { if (h) colIdx[normStr(h)] = i; });

  // Función para leer por nombre de columna (normalizado)
  const cel = (row, ...nombres) => {
    for (const n of nombres) {
      const idx = colIdx[normStr(n)];
      if (idx !== undefined && row[idx] !== null && row[idx] !== undefined && row[idx] !== '')
        return row[idx];
    }
    return null;
  };

  // ── 5. Leer filas de datos (después de la fila de headers) ─────────────
  const filas = aoa.slice(filaHeader + 1).filter(r => r && r.some(c => c !== null));

  const colsRelevantes = ['FECHA','BULTOS RECHAZADOS','MOTIVO DE RECHAZO','DESCRIPCION CLIENTE','DESCRIPCION CHOFER'];
  const colsEncontradas = colsRelevantes.filter(n => colIdx[n] !== undefined);
  console.log(`📊 Excel OK: fila ${filaHeader+1} encabezados, ${filas.length} filas totales`);
  console.log(`📊 Columnas clave encontradas: ${colsEncontradas.join(', ')}`);

  // ── 6. Filtrar solo filas con BULTOS RECHAZADOS > 0 ────────────────────
  const conRechazo = filas.filter(r => {
    const br = parseFloat(cel(r, 'BULTOS RECHAZADOS') ?? 0);
    return !isNaN(br) && br > 0;
  });

  if (conRechazo.length === 0) {
    throw new Error(
      `Se leyeron ${filas.length} filas pero ninguna tiene "BULTOS RECHAZADOS" > 0.\n` +
      `Verificá que el archivo tenga rechazos registrados.`
    );
  }

  console.log(`📊 Rechazos encontrados: ${conRechazo.length}`);

  // ── 7. Mapear a objetos con nombres de columna EXACTOS del archivo ──────
  // Totales del archivo completo (todas las filas, no solo rechazos)
  // Sirve para calcular bultos pedidos y HL — denominador de los % en TRechazos
  // Artículos excluidos del cálculo (igual que en TRechazos)
  const ARTS_EXCLUIDOS = new Set(['2776', '2705', '2731']);

  // Construir mapa chofer→transporteId desde filas CON rechazo
  // (en esas filas ambas columnas siempre tienen valor)
  // Se aplica luego a TODAS las filas para acumular bultos por transporte
  const choferATransporte = {};
  conRechazo.forEach(r => {
    const cId = String(cel(r, 'CHOFER') ?? '').trim();
    const tId = String(cel(r, 'TRANSPORTE') ?? '').trim();
    if (cId && cId !== '—' && tId && tId !== '—') {
      choferATransporte[cId] = tId;
    }
  });
  console.log('📊 Mapa chofer→transporte:', JSON.stringify(choferATransporte));

  const totalesArchivo = filas.reduce((acc, r) => {
    const artId = String(cel(r, 'ARTÍCULO', 'ARTICULO') ?? '').trim();
    if (ARTS_EXCLUIDOS.has(artId)) return acc;  // excluir igual que TRechazos
    const bultos = parseFloat(cel(r, 'BULTOS') ?? 0) || 0;
    acc.bultosTotal += bultos;
    acc.hlTotal     += parseFloat(cel(r, 'UNIDAD DE MEDIDA') ?? 0) || 0;
    acc.hlRechTotal += parseFloat(cel(r, 'UNIDAD DE MEDIDA RECHAZADO') ?? 0) || 0;
    const br = parseFloat(cel(r, 'BULTOS RECHAZADOS') ?? 0) || 0;
    if (br > 0) acc.bultosRechazadoTotal += br;
    // Acumular por transporteId (para referencia)
    const tId = String(cel(r, 'TRANSPORTE') ?? '').trim();
    if (tId && tId !== '—') {
      acc.bultosPorTransporte[tId] = (acc.bultosPorTransporte[tId] || 0) + bultos;
    }
    // Acumular por choferId — el driverMap usa IDs de chofer, no de transporte
    const cId = String(cel(r, 'CHOFER') ?? '').trim();
    if (cId && cId !== '—') {
      acc.bultosPorChofer[cId] = (acc.bultosPorChofer[cId] || 0) + bultos;
    }
    return acc;
  }, { bultosTotal: 0, bultosRechazadoTotal: 0, hlTotal: 0, hlRechTotal: 0, bultosPorTransporte: {}, bultosPorChofer: {} });

  const totalBxT = Object.values(totalesArchivo.bultosPorTransporte).reduce((s,v)=>s+v,0);
  const totalBxC = Object.values(totalesArchivo.bultosPorChofer).reduce((s,v)=>s+v,0);
  console.log(`📊 bultosTotal: ${Math.round(totalesArchivo.bultosTotal)} | porTransporte: ${Math.round(totalBxT)} | porChofer: ${Math.round(totalBxC)}`);
  console.log('📊 bultosPorChofer:', JSON.stringify(totalesArchivo.bultosPorChofer));

  const rows = conRechazo.map(r => ({
    fecha:            parseFecha(cel(r, 'FECHA')),
    articulo:         String(cel(r, 'ARTÍCULO', 'ARTICULO') ?? '—'),
    articuloDesc:     String(cel(r, 'DESCRIPCIÓN ARTÍCULO', 'DESCRIPCION ARTICULO') ?? '—'),
    bultos:           parseFloat(cel(r, 'BULTOS') ?? 0) || 0,
    bultosRechazados: parseFloat(cel(r, 'BULTOS RECHAZADOS') ?? 0) || 0,
    hl:               parseFloat(cel(r, 'UNIDAD DE MEDIDA') ?? 0) || 0,
    hlRechazado:      parseFloat(cel(r, 'UNIDAD DE MEDIDA RECHAZADO') ?? 0) || 0,
    importeNeto:      parseFloat(cel(r, 'IMPORTE NETO') ?? 0) || 0,
    importeRechazado: parseFloat(cel(r, 'IMPORTE NETO RECHAZADO') ?? 0) || 0,
    motivo:           String(cel(r, 'MOTIVO DE RECHAZO') ?? '—'),
    motivoDesc:       String(cel(r, 'DESCRIPCIÓN DETALLADA MOTIVO', 'DESCRIPCION DETALLADA MOTIVO', 'MOTIVO DE RECHAZO') ?? '—'),
    clienteId:        String(cel(r, 'CLIENTE') ?? '—'),
    clienteDesc:      String(cel(r, 'DESCRIPCIÓN CLIENTE', 'DESCRIPCION CLIENTE') ?? '—'),
    domicilio:        String(cel(r, 'DOMICILIO CLIENTE', 'DOMICILIO') ?? '—'),
    canal:            String(cel(r, 'CANAL') ?? '—'),
    canalDesc:        String(cel(r, 'DESCRIPCIÓN CANAL', 'DESCRIPCION CANAL') ?? '—'),
    chofer:           String(cel(r, 'CHOFER') ?? '—'),
    transporteId:     String(cel(r, 'TRANSPORTE') ?? '—'),
    choferDesc:       String(cel(r, 'DESCRIPCIÓN CHOFER', 'DESCRIPCION CHOFER') ?? '—'),
    ruta:             String(cel(r, 'RUTA') ?? '—'),
    rutaDesc:         String(cel(r, 'DESCRIPCIÓN RUTA', 'DESCRIPCION RUTA') ?? '—'),
    rechazoTotal:     normStr(cel(r, 'RECHAZO\nTOTAL', 'RECHAZO TOTAL') ?? '') === 'SI',
  }));

  rows._totalesArchivo = totalesArchivo;
  return rows;
}

// ─── Zona de drop genérica ────────────────────────────────────────────────────
const DropZone = ({ label, accept, icon, desc, onFile, loading, color }) => {
  const ref = useRef();
  const [drag, setDrag] = useState(false);
  return (
    <div
      style={{ border: `2px dashed ${drag ? color : 'var(--border)'}`, borderRadius: 'var(--radius-lg)', padding: '28px 20px', textAlign: 'center', background: drag ? color + '10' : 'var(--bg3)', transition: 'all .15s', cursor: 'pointer' }}
      onClick={() => ref.current.click()}
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]); }}
    >
      <input ref={ref} type="file" accept={accept} style={{ display: 'none' }} onChange={e => e.target.files[0] && onFile(e.target.files[0])} />
      <div style={{ fontSize: 36, marginBottom: 8 }}>{loading ? '⏳' : icon}</div>
      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 13, color: 'var(--text3)', fontWeight: 600 }}>{loading ? 'Procesando...' : 'Click o arrastrá el archivo'}</div>
      <div style={{ fontSize: 12, color, marginTop: 6, fontWeight: 700 }}>{accept}</div>
      {desc && <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 8, lineHeight: 1.5 }}>{desc}</div>}
    </div>
  );
};

// ─── Card de borrador de reparto ──────────────────────────────────────────────
const BorradorCard = ({ ruta, cfg, aus = [], onCrearRegistro }) => {
  const [expandido, setExpandido] = useState(false);
  const [clienteAbierto, setClienteAbierto] = useState(null);
  const sinMapear = !ruta.choferNombre;

  return (
    <div style={{ border: `2px solid ${sinMapear ? '#f59e0b' : 'var(--border)'}`, borderRadius: 'var(--radius-lg)', background: 'var(--bg2)', overflow: 'hidden', marginBottom: 12 }}>
      {/* Header de ruta */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: expandido ? '2px solid var(--border)' : 'none' }}>
        {/* Info principal */}
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>Ruta {ruta.rutaId}</span>
            <span style={{ fontSize: 12, padding: '2px 10px', borderRadius: 12, background: '#e8f3ff', color: '#1e40af', fontWeight: 700 }}>Driver {ruta.driverId}</span>
            {ruta.zonaDriver && (
              <span style={{ fontSize: 12, padding: '2px 10px', borderRadius: 12, background: ruta.zonaDriver === 'Tandil' ? '#fff7e0' : '#e8f3ff', color: ruta.zonaDriver === 'Tandil' ? '#78350f' : '#1e40af', fontWeight: 700, border: `1px solid ${ruta.zonaDriver === 'Tandil' ? '#f59e0b' : '#60a5fa'}` }}>
                📍 {ruta.zonaDriver}
              </span>
            )}
            {sinMapear && <span style={{ fontSize: 12, padding: '2px 10px', borderRadius: 12, background: '#fff7e0', color: '#78350f', fontWeight: 700, border: '1px solid #f59e0b' }}>⚠ Sin nombre de chofer</span>}
          </div>
          <div style={{ fontSize: 15, fontWeight: 900, color: 'var(--text)' }}>
            {ruta.choferNombre || <span style={{ color: '#b87c00', fontStyle: 'italic' }}>Driver ID: {ruta.driverId} — configurar en Config → Mapeo</span>}
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 900, fontFamily: 'var(--font-mono)', color: '#b87c00' }}>{fn(Math.round(ruta.totalBultos))}</div>
            <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 700 }}>bultos</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 900, fontFamily: 'var(--font-mono)', color: '#005fa3' }}>{ruta.totalClientes}</div>
            <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 700 }}>clientes</div>
          </div>
        </div>

        {/* Botón crear borrador */}
        <button
          className="btn-action btn-primary-action"
          onClick={() => onCrearRegistro(ruta)}
          style={{ flexShrink: 0 }}
        >
          + Crear Borrador
        </button>

        {/* Expandir */}
        <button onClick={() => setExpandido(e => !e)}
          style={{ background: 'none', border: '2px solid var(--border)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 14, color: 'var(--text3)', fontWeight: 700 }}>
          {expandido ? '▲' : '▼'}
        </button>
      </div>

      {/* Lista de clientes expandida */}
      {expandido && (
        <div style={{ padding: '10px 0', maxHeight: 360, overflowY: 'auto' }}>
          {ruta.clientes.map((c, i) => (
            <div key={i} style={{ borderBottom: '1px solid var(--border)' }}>
              <div
                style={{ display: 'flex', gap: 12, padding: '10px 18px', cursor: 'pointer', background: clienteAbierto === i ? '#f0f9ff' : 'transparent' }}
                onClick={() => setClienteAbierto(clienteAbierto === i ? null : i)}
              >
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', width: 22 }}>{i + 1}.</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{c.cliente}</div>
                  <div style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600 }}>{c.domicilio}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: 14, fontWeight: 900, fontFamily: 'var(--font-mono)', color: '#b87c00' }}>{fn(Math.round(c.totalBultos))}</span>
                  <span style={{ fontSize: 11, color: 'var(--text3)', display: 'block' }}>{c.productos.length} prod.</span>
                </div>
                <span style={{ fontSize: 12, color: 'var(--text3)', marginLeft: 4 }}>{clienteAbierto === i ? '▲' : '▼'}</span>
              </div>
              {clienteAbierto === i && (
                <div style={{ padding: '8px 18px 12px 52px', background: '#f8fafc' }}>
                  {c.productos.map((p, j) => (
                    <div key={j} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13, borderBottom: j < c.productos.length - 1 ? '1px solid var(--border)' : 'none' }}>
                      <span style={{ color: 'var(--text2)', fontWeight: 600 }}>{p.prod}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#005fa3' }}>× {p.cant % 1 === 0 ? p.cant : p.cant.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Modal borrador → completar para crear registro ──────────────────────────
const ModalBorrador = ({ ruta, cfg, aus = [], onGuardar, onCerrar }) => {
  // Pre-seleccionar localidad según zona del driver
  const localidadPreset = useMemo(() => {
    if (!ruta.zonaDriver || !cfg.localidades?.length) return cfg.localidades?.[0] || '';
    const zona = ruta.zonaDriver.toLowerCase();
    const match = cfg.localidades.find(l => l.toLowerCase().includes(zona));
    return match || cfg.localidades[0] || '';
  }, [ruta.zonaDriver, cfg.localidades]);

  const [form, setForm] = useState({
    fecha: tod(),
    chofer: ruta.choferNombre || '',
    ay1: '', ay2: '',
    patente: '',
    localidad: localidadPreset,
    destino: '',
    bultos: Math.round(ruta.totalBultos),
    costoReparto: '',
  });
  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // No disponibles para la fecha
  const noDisp = useMemo(() => {
    const map = {};
    (aus || []).forEach(a => {
      if (!a.persona || !a.fechaDesde) return;
      const hasta = a.fechaHasta || a.fechaDesde;
      if (form.fecha >= a.fechaDesde && form.fecha <= hasta)
        map[a.persona] = { motivo: a.motivo };
    });
    return map;
  }, [form.fecha, aus]);

  const clientes = ruta.clientes || [];

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onCerrar()}>
      <div className="modal-box" style={{ maxWidth: 640 }}>
        <div className="modal-header">
          <h3 className="modal-title">Completar borrador — Ruta {ruta.rutaId}</h3>
          <button className="modal-close" onClick={onCerrar}>×</button>
        </div>

        <div className="modal-body">
          {/* Resumen del CSV */}
          <div style={{ background: '#e8f3ff', border: '2px solid #60a5fa', borderRadius: 10, padding: '12px 16px', marginBottom: 16, fontSize: 13 }}>
            <div style={{ fontWeight: 800, color: '#1e40af', marginBottom: 6 }}>📋 Datos del CSV para esta ruta:</div>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              <span style={{ color: '#1e3a8a', fontWeight: 600 }}>🏪 {ruta.totalClientes} clientes</span>
              <span style={{ color: '#1e3a8a', fontWeight: 600 }}>📦 {fn(Math.round(ruta.totalBultos))} bultos estimados</span>
              <span style={{ color: '#1e3a8a', fontWeight: 600 }}>🚛 Driver {ruta.driverId}{ruta.choferNombre ? ` — ${ruta.choferNombre}` : ' (sin mapear)'}</span>
            </div>
            {/* Top 3 clientes */}
            <div style={{ marginTop: 8, fontSize: 12, color: '#1e40af', fontWeight: 600 }}>
              Principales: {clientes.slice(0, 3).map(c => `${c.cliente} (${fn(Math.round(c.totalBultos))} bultos)`).join(' · ')}
              {clientes.length > 3 && ` · +${clientes.length - 3} más`}
            </div>
          </div>

          {/* Alertas de disponibilidad */}
          {Object.keys(noDisp).length > 0 && (
            <div style={{ background: '#fff7e0', border: '2px solid #f59e0b', borderRadius: 10, padding: '10px 14px', marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#78350f', marginBottom: 4 }}>⚠ Personal con ausencia en esta fecha:</div>
              {Object.entries(noDisp).map(([n, i]) => (
                <div key={n} style={{ fontSize: 13, color: '#92400e', fontWeight: 600 }}>• <strong>{n}</strong> — {i.motivo}</div>
              ))}
            </div>
          )}

          {/* Formulario */}
          <div className="modal-grid">
            <div className="modal-field">
              <label>Fecha <span style={{ color: 'var(--red)' }}>*</span></label>
              <input type="date" className="filter-input" value={form.fecha} onChange={e => setF('fecha', e.target.value)} />
            </div>
            <div className="modal-field">
              <label>Patente</label>
              <select className="filter-select" style={{ width: '100%' }} value={form.patente} onChange={e => setF('patente', e.target.value)}>
                <option value="">— Seleccionar —</option>
                {(cfg.patentes || []).map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="modal-field" style={{ gridColumn: '1 / -1' }}>
              <label>Chofer {ruta.choferNombre ? '' : <span style={{ color: '#b87c00', fontWeight: 600, fontSize: 12 }}>(configurá el Driver ID en Config → Mapeo)</span>}</label>
              <select className="filter-select" style={{ width: '100%', borderColor: noDisp[form.chofer] ? '#f59e0b' : '' }} value={form.chofer} onChange={e => setF('chofer', e.target.value)}>
                <option value="">— Seleccionar —</option>
                {(cfg.choferes || []).map(c => (
                  <option key={c} value={c} disabled={!!noDisp[c]}>
                    {noDisp[c] ? `⚠ ${c} — ${noDisp[c].motivo}` : c}
                  </option>
                ))}
              </select>
            </div>
            <div className="modal-field">
              <label>Ayudante 1</label>
              <select className="filter-select" style={{ width: '100%' }} value={form.ay1} onChange={e => setF('ay1', e.target.value)}>
                <option value="">— Ninguno —</option>
                {(cfg.ayudantes || []).map(a => (
                  <option key={a} value={a} disabled={!!noDisp[a]}>{noDisp[a] ? `⚠ ${a} — ${noDisp[a].motivo}` : a}</option>
                ))}
              </select>
            </div>
            <div className="modal-field">
              <label>Ayudante 2</label>
              <select className="filter-select" style={{ width: '100%' }} value={form.ay2} onChange={e => setF('ay2', e.target.value)}>
                <option value="">— Ninguno —</option>
                {(cfg.ayudantes || []).map(a => (
                  <option key={a} value={a} disabled={!!noDisp[a]}>{noDisp[a] ? `⚠ ${a} — ${noDisp[a].motivo}` : a}</option>
                ))}
              </select>
            </div>
            <div className="modal-field">
              <label>Localidad</label>
              <select className="filter-select" style={{ width: '100%' }} value={form.localidad} onChange={e => setF('localidad', e.target.value)}>
                <option value="">— Seleccionar —</option>
                {(cfg.localidades || []).map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div className="modal-field">
              <label>Destino</label>
              <select className="filter-select" style={{ width: '100%' }} value={form.destino} onChange={e => setF('destino', e.target.value)}>
                <option value="">— Seleccionar —</option>
                {(cfg.destinos || []).map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="modal-field">
              <label>Bultos <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600 }}>(pre-cargado del CSV)</span></label>
              <input type="number" className="filter-input" value={form.bultos} onChange={e => setF('bultos', e.target.value)} />
            </div>
            <div className="modal-field">
              <label>Costo Reparto ($) <span style={{ fontSize: 11, color: 'var(--text3)' }}>(a completar)</span></label>
              <input type="number" className="filter-input" value={form.costoReparto} onChange={e => setF('costoReparto', e.target.value)} placeholder="0" />
            </div>
          </div>

          {/* Detalle de clientes del CSV como referencia */}
          {clientes.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 700, color: 'var(--text2)', padding: '8px 0' }}>
                📋 Ver los {clientes.length} clientes de esta ruta (referencia)
              </summary>
              <div style={{ maxHeight: 200, overflowY: 'auto', border: '2px solid var(--border)', borderRadius: 8, marginTop: 8 }}>
                {clientes.map((c, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 14px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                    <div>
                      <div style={{ fontWeight: 700, color: 'var(--text)' }}>{c.cliente}</div>
                      <div style={{ fontSize: 12, color: 'var(--text3)' }}>{c.domicilio}</div>
                    </div>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#b87c00' }}>{fn(Math.round(c.totalBultos))} btos.</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-action btn-ghost" onClick={onCerrar}>Cancelar</button>
          <button className="btn-action btn-primary-action" onClick={() => {
            if (!form.fecha) return alert('La fecha es obligatoria');
            onGuardar({ ...form, id: Date.now(), rutaOrigen: ruta.rutaId, driverIdOrigen: ruta.driverId, clientesCSV: clientes });
          }}>
            + Crear Registro
          </button>
        </div>
      </div>
    </div>
  );
};

// VistaRechazos — usa el componente completo de TRechazos con cards clickeables

// ══════════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ══════════════════════════════════════════════════════════════════════════════
export const TImportacion = ({ cfg = {}, aus = [], onSaveReg, onSaveRechazos }) => {
  const [rutas,        setRutas]        = useState([]);
  const [rechazos,     setRechazos]     = useState(null);  // { nombre, rows }
  const [cargandoCSV,  setCargandoCSV]  = useState(false);
  const [cargandoXLS,  setCargandoXLS]  = useState(false);
  const [guardando,    setGuardando]    = useState(false);
  const [tab,          setTab]          = useState('csv');
  const [borradorRuta, setBorradorRuta] = useState(null);
  const [toast,        setToast]        = useState(null);
  const [csvNombre,    setCsvNombre]    = useState('');
  const [errorExcel,   setErrorExcel]   = useState(null);
  const [yaGuardado,   setYaGuardado]   = useState(false);
  const [historial,    setHistorial]    = useState([]);
  const [cargandoHist, setCargandoHist] = useState(false);
  const [eliminando,   setEliminando]   = useState(null); // nombre del archivo que se está eliminando

  const notify = (msg, tipo = 'ok') => { setToast({ msg, tipo }); setTimeout(() => setToast(null), 3500); };
  const driverMap = cfg.driverMap || [];

  // Cargar historial cuando se monta o cuando se cambia a tab historial
  const cargarHistorial = async () => {
    setCargandoHist(true);
    try {
      const arr = await getArchivosRechazos();
      console.log('📋 Historial recibido:', arr);
      setHistorial(Array.isArray(arr) ? arr : []);
    } catch(e) {
      console.error('📋 Historial ERROR:', e.message);
      setHistorial([]);
    }
    setCargandoHist(false);
  };

  // Eliminar archivo del historial
  const eliminarArchivo = async (nombre) => {
    if (!window.confirm(`¿Eliminar TODOS los rechazos del archivo "${nombre}"?\n\nEsta acción no se puede deshacer.`)) return;
    setEliminando(nombre);
    try {
      await eliminarArchivoRechazos(nombre);
      setHistorial(prev => prev.filter(h => h.archivo !== nombre));
      notify(`✓ Archivo "${nombre}" eliminado — ${nombre} removido del sistema`);
    } catch (err) {
      notify('❌ Error al eliminar: ' + err.message, 'err');
    }
    setEliminando(null);
  };

  // Cargar historial al montar
  React.useEffect(() => { cargarHistorial(); }, []);

  // ── Cargar CSV
  const cargarCSV = (file) => {
    setCargandoCSV(true);
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const rows  = parseCSV(e.target.result);
        const rutas = agruparPorRuta(rows, driverMap);
        setRutas(rutas);
        setCsvNombre(file.name);
        setTab('csv');
        notify(`✓ ${file.name} — ${rutas.length} rutas, ${fn(Math.round(rutas.reduce((s,r)=>s+r.totalBultos,0)))} bultos totales`);
      } catch (err) {
        notify('❌ Error al procesar el CSV: ' + err.message, 'err');
      }
      setCargandoCSV(false);
    };
    reader.readAsText(file, 'UTF-8');
  };

  // ── Cargar Excel
  // ── Cargar Excel (.xlsx o .xlsm — las macros VBA se ignoran automáticamente)
  const cargarExcel = (file) => {
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['xlsx', 'xlsm'].includes(ext)) {
      notify('❌ Solo se aceptan archivos .xlsx o .xlsm', 'err');
      return;
    }
    setCargandoXLS(true);
    setErrorExcel(null); // limpiar error anterior
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const rows = parseExcelRechazos(e.target.result);
        setRechazos({ nombre: file.name, rows });
        setYaGuardado(false);
        setYaGuardado(false); // resetear para el nuevo archivo
        setTab('rechazos');
        notify(`✓ ${file.name} — ${rows.length} rechazos encontrados`);
        cargarHistorial(); // refrescar historial para comparar
        setErrorExcel(null);
      } catch (err) {
        console.error('Error Excel:', err);
        setErrorExcel(err.message); // mostrar error detallado en pantalla
      }
      setCargandoXLS(false);
    };
    reader.onerror = () => {
      setErrorExcel('No se pudo leer el archivo. Intentá arrastrarlo o seleccionarlo de nuevo.');
      setCargandoXLS(false);
    };
    reader.readAsArrayBuffer(file);
  };

  // ── Guardar borrador como registro
  const guardarBorrador = (datosForm) => {
    if (onSaveReg) onSaveReg(datosForm);
    setBorradorRuta(null);
    notify(`✓ Registro creado para Ruta ${datosForm.rutaOrigen}`);
  };

  return (
    <div className="dash-container">
      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, background: toast.tipo === 'err' ? '#b91c1c' : '#166534', color: '#fff', padding: '13px 22px', borderRadius: 14, fontSize: 14, fontWeight: 700, boxShadow: '0 8px 32px rgba(0,0,0,.2)', maxWidth: 420, animation: 'fadeIn .2s' }}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="dash-header">
        <div>
          <h2 className="dash-title">Importar Datos</h2>
          <p className="dash-sub">CSV de pedidos del día · Excel de rechazos (.xlsx o .xlsm)</p>
        </div>
      </div>

      {/* Zonas de carga */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <DropZone label="Pedido del día" accept=".csv" icon="📋" color="#005fa3"
          desc="CSV Foxtrot con productos por cliente y ruta"
          onFile={cargarCSV} loading={cargandoCSV} />
        <DropZone label="Rechazos" accept=".xlsx,.xlsm" icon="❌" color="#b91c1c"
          desc="Excel de rechazos — hoja BASE (.xlsx o .xlsm)"
          onFile={cargarExcel} loading={cargandoXLS} />
      </div>

      {/* Error detallado del Excel */}
      {errorExcel && (
        <div style={{ background: '#fee2e2', border: '2px solid #b91c1c', borderRadius: 14, padding: '16px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#7f1d1d', marginBottom: 8 }}>❌ Error al leer el archivo Excel</div>
            <button onClick={() => setErrorExcel(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#b91c1c', fontWeight: 900 }}>×</button>
          </div>
          <div style={{ fontSize: 14, color: '#7f1d1d', fontWeight: 600, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
            {errorExcel}
          </div>
          <div style={{ marginTop: 12, fontSize: 13, color: '#991b1b', fontWeight: 600, background: '#fecaca', padding: '10px 14px', borderRadius: 8 }}>
            💡 <strong>Tip:</strong> Si el archivo sigue fallando, abrilo en Excel y guardalo como <strong>.xlsx</strong> (Archivo → Guardar como → Libro de Excel .xlsx). Esto elimina las macros y generalmente resuelve el problema.
          </div>
        </div>
      )}

      {/* Info Excel */}
      <div style={{ background: '#f0fdf4', border: '2px solid #4ade80', borderRadius: 'var(--radius)', padding: '14px 18px', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <span style={{ fontSize: 24, flexShrink: 0 }}>✅</span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#166534', marginBottom: 4 }}>Ahora acepta tanto .xlsx como .xlsm</div>
          <div style={{ fontSize: 13, color: '#14532d', fontWeight: 600, lineHeight: 1.7 }}>
            Podés subir el archivo directamente como viene sin necesidad de convertirlo. Las macros de Excel se ignoran automáticamente y solo se leen los datos de la hoja <strong>BASE</strong>.
          </div>
        </div>
      </div>

      {/* Tabs de resultados */}
      {/* ── Barra de tabs — SIEMPRE visible ── */}
      <div style={{ display:'flex', gap:8, background:'var(--bg2)', padding:'10px 14px', borderRadius:'var(--radius-lg)', border:'2px solid var(--border)', flexWrap:'wrap' }}>
        {rutas.length > 0 && (
          <button onClick={() => setTab('csv')}
            style={{ padding:'8px 18px', borderRadius:10, border:'none', cursor:'pointer', fontFamily:'var(--font-head)', fontSize:14, fontWeight:700, background:tab==='csv'?'#005fa3':'var(--bg3)', color:tab==='csv'?'#fff':'var(--text2)' }}>
            📋 Pedido del día ({rutas.length} rutas)
          </button>
        )}
        {rechazos && (
          <button onClick={() => setTab('rechazos')}
            style={{ padding:'8px 18px', borderRadius:10, border:'none', cursor:'pointer', fontFamily:'var(--font-head)', fontSize:14, fontWeight:700, background:tab==='rechazos'?'#b91c1c':'var(--bg3)', color:tab==='rechazos'?'#fff':'var(--text2)' }}>
            ❌ Rechazos ({rechazos.rows.length})
          </button>
        )}
        {/* Historial SIEMPRE visible — no depende de haber cargado archivos */}
        <button onClick={() => { setTab('historial'); cargarHistorial(); }}
          style={{ padding:'8px 18px', borderRadius:10, border:'none', cursor:'pointer', fontFamily:'var(--font-head)', fontSize:14, fontWeight:700, background:tab==='historial'?'#5b21b6':'var(--bg3)', color:tab==='historial'?'#fff':'var(--text2)', marginLeft:'auto', display:'flex', alignItems:'center', gap:6 }}>
          📋 Historial
          {historial.length > 0 && <span style={{ background:'#5b21b6', color:'#fff', borderRadius:10, padding:'1px 8px', fontSize:12 }}>{historial.length}</span>}
        </button>
        {rutas.some(r => !r.choferNombre) && (
          <div style={{ fontSize:13, color:'#78350f', fontWeight:700, display:'flex', alignItems:'center', gap:6, background:'#fff7e0', padding:'6px 14px', borderRadius:10, border:'1px solid #f59e0b' }}>
            ⚠ {rutas.filter(r=>!r.choferNombre).length} rutas sin chofer mapeado
          </div>
        )}
      </div>

      {/* ── Tab CSV ── */}
      {tab === 'csv' && rutas.length > 0 && (
        <div className="dash-card">
          <div className="card-header">
            <span className="card-title">Rutas del día — {csvNombre}</span>
            <span className="card-badge">{rutas.length} rutas · {fn(Math.round(rutas.reduce((s,r)=>s+r.totalBultos,0)))} bultos</span>
          </div>
          <div style={{ fontSize:13, color:'var(--text3)', fontWeight:600, marginBottom:16 }}>
            Hacé click en <strong>"+ Crear Borrador"</strong> para abrir el formulario pre-cargado.
          </div>
          {rutas.map((r, i) => (
            <BorradorCard key={i} ruta={r} cfg={cfg} aus={aus} onCrearRegistro={setBorradorRuta} />
          ))}
        </div>
      )}

      {/* ── Tab Rechazos ── */}
      {tab === 'rechazos' && rechazos && (
        <div className="dash-card">
          <div className="card-header">
            <span className="card-title">Rechazos — {rechazos.nombre}</span>
            <div style={{ display:'flex', gap:10, alignItems:'center' }}>
              <span className="card-badge">{rechazos.rows.length} registros</span>
              {onSaveRechazos && (() => {
                // Buscar si este archivo ya está en el historial
                // Comparar normalizando (sin extensión, lowercase)
                const normNombre = n => String(n||'').toLowerCase().trim();
                const yaExiste = historial.find(h => normNombre(h.archivo) === normNombre(rechazos.nombre));
                if (yaExiste) {
                  // BLOQUEADO — ya fue guardado
                  return (
                    <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                      <div style={{ padding:'6px 14px', background:'#fff7e0', border:'2px solid #f59e0b', borderRadius:8, fontSize:13, fontWeight:700, color:'#78350f' }}>
                        ⚠ Ya importado ({yaExiste.cantidad} registros el {new Date(yaExiste.fechaImport).toLocaleDateString('es-AR')})
                      </div>
                      <button
                        disabled={guardando}
                        onClick={async () => {
                          if (!window.confirm(`⚠️ "${rechazos.nombre}" ya tiene ${yaExiste.cantidad} registros guardados.

Si guardás de nuevo se DUPLICARÁN los datos.

¿Querés continuar de todas formas?`)) return;
                          setGuardando(true);
                          await onSaveRechazos(rechazos.rows, rechazos.nombre, rechazos.rows._totalesArchivo);
                          setGuardando(false);
                          cargarHistorial();
                        }}
                        style={{ padding:'6px 14px', background:'#fee2e2', color:'#b91c1c', border:'2px solid #fca5a5', borderRadius:8, fontSize:13, fontWeight:700, cursor:'pointer' }}>
                        {guardando ? '⏳' : '⚠ Guardar igual (duplica)'}
                      </button>
                    </div>
                  );
                }
                // NO existe — botón normal
                return (
                  <button
                    disabled={guardando || yaGuardado}
                    onClick={async () => {
                      setGuardando(true);
                      await onSaveRechazos(rechazos.rows, rechazos.nombre, rechazos.rows._totalesArchivo);
                      setGuardando(false);
                      setYaGuardado(true);
                      cargarHistorial();
                    }}
                    style={{ padding:'6px 18px', background: guardando?'#64748b': yaGuardado?'#0369a1':'#166534', color:'#fff', border:'none', borderRadius:8, fontSize:13, fontWeight:700, cursor: (guardando||yaGuardado)?'not-allowed':'pointer', transition:'background .2s' }}>
                    {guardando ? '⏳ Guardando...' : yaGuardado ? '✅ Guardado' : '💾 Guardar Rechazos'}
                  </button>
                );
              })()}
            </div>
          </div>
          <VistaRechazosCompleta rechazos={rechazos.rows} cfg={cfg} embebido={true} />
        </div>
      )}
      {/* ── Tab Historial — SIEMPRE disponible independiente de archivos cargados ── */}
      {tab === 'historial' && (
            <div className="dash-card">
              <div className="card-header">
                <span className="card-title">📋 Historial de importaciones</span>
                <div style={{ display:'flex', gap:10, alignItems:'center' }}>
                  {historial.length > 0 && <span className="card-badge">{historial.length} archivos · {historial.reduce((s,h)=>s+h.cantidad,0)} registros total</span>}
                  <button onClick={async () => {
                    if (!window.confirm('¿Eliminar todos los registros DUPLICADOS?\n\nSe mantiene solo una copia de cada rechazo único. Esta acción no se puede deshacer.')) return;
                    try {
                      const r = await deduplicarRechazos();
                      notify(r?.mensaje || '✓ Deduplicación completada');
                      cargarHistorial();
                    } catch(e) { notify('❌ ' + e.message, 'err'); }
                  }} style={{ padding:'5px 14px', background:'#fff7e0', border:'2px solid #f59e0b', borderRadius:7, fontSize:12, fontWeight:700, cursor:'pointer', color:'#78350f' }}>
                    🧹 Limpiar duplicados
                  </button>
                  <button onClick={cargarHistorial} disabled={cargandoHist}
                    style={{ padding:'5px 12px', background:'#f1f5f9', border:'2px solid #e2e8f0', borderRadius:7, fontSize:12, fontWeight:700, cursor:'pointer', color:'#475569' }}>
                    {cargandoHist ? '⏳' : '🔄 Actualizar'}
                  </button>
                </div>
              </div>

              {cargandoHist && (
                <div style={{ textAlign:'center', padding:'32px', color:'#94a3b8', fontSize:14 }}>⏳ Cargando historial...</div>
              )}

              {!cargandoHist && historial.length === 0 && (
                <div style={{ textAlign:'center', padding:'40px 24px', color:'#94a3b8' }}>
                  <div style={{ fontSize:40, marginBottom:12 }}>📂</div>
                  <div style={{ fontSize:15, fontWeight:700, color:'#475569', marginBottom:6 }}>No hay archivos importados todavía</div>
                  <div style={{ fontSize:13 }}>Subí un Excel de rechazos y hacé click en <strong>Guardar Rechazos</strong></div>
                </div>
              )}

              {!cargandoHist && historial.length > 0 && (
                <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                  {historial.map((h, i) => {
                    const pctLog  = h.cantidad > 0 ? Math.round((h.logistica  / h.cantidad) * 100) : 0;
                    const pctFact = h.cantidad > 0 ? Math.round((h.facturacion / h.cantidad) * 100) : 0;
                    const fechaImp = h.fechaImport ? new Date(h.fechaImport).toLocaleString('es-AR', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';
                    const esReciente = i === 0;
                    return (
                      <div key={h.archivo} style={{
                        border: `2px solid ${esReciente ? '#86efac' : '#e2e8f0'}`,
                        borderRadius: 14, padding: '16px 20px', background: esReciente ? '#f0fdf4' : '#fff',
                        position: 'relative'
                      }}>
                        {esReciente && (
                          <div style={{ position:'absolute', top:12, right:56, fontSize:11, padding:'2px 10px', background:'#166534', color:'#fff', borderRadius:8, fontWeight:700 }}>
                            ÚLTIMO
                          </div>
                        )}

                        {/* Header */}
                        <div style={{ display:'flex', alignItems:'flex-start', gap:12, marginBottom:12 }}>
                          <div style={{ fontSize:28, flexShrink:0 }}>📊</div>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontSize:14, fontWeight:800, color:'#1e293b', marginBottom:3, wordBreak:'break-word' }}>
                              {h.archivo}
                            </div>
                            <div style={{ fontSize:12, color:'#64748b', fontWeight:600 }}>
                              📅 Importado el {fechaImp}
                              {h.fechaDesde && h.fechaHasta && (
                                <span style={{ marginLeft:12 }}>
                                  · Datos del {h.fechaDesde} al {h.fechaHasta}
                                </span>
                              )}
                            </div>
                          </div>
                          <button
                            onClick={() => eliminarArchivo(h.archivo)}
                            disabled={eliminando === h.archivo}
                            title="Eliminar todos los rechazos de este archivo"
                            style={{ flexShrink:0, padding:'6px 14px', background: eliminando===h.archivo?'#94a3b8':'#fee2e2', color: eliminando===h.archivo?'#fff':'#b91c1c', border:'2px solid', borderColor: eliminando===h.archivo?'#94a3b8':'#fca5a5', borderRadius:8, fontSize:13, fontWeight:700, cursor: eliminando===h.archivo?'not-allowed':'pointer', transition:'all .15s' }}>
                            {eliminando === h.archivo ? '⏳ Eliminando...' : '🗑 Eliminar'}
                          </button>
                        </div>

                        {/* KPIs */}
                        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:12 }}>
                          {[
                            { icon:'❌', label:'Registros',    value: h.cantidad,                       color:'#b91c1c', bg:'#fee2e2' },
                            { icon:'📦', label:'Bultos',       value: Math.round(h.bultos).toLocaleString('es-AR'), color:'#b87c00', bg:'#fff7e0' },
                            { icon:'🚛', label:'Logística',    value: `${h.logistica} (${pctLog}%)`,    color:'#b91c1c', bg:'#fff1f1' },
                            { icon:'🧾', label:'Facturación',  value: `${h.facturacion} (${pctFact}%)`, color:'#b87c00', bg:'#fffbeb' },
                          ].map(k => (
                            <div key={k.label} style={{ background:k.bg, borderRadius:10, padding:'10px 12px', textAlign:'center' }}>
                              <div style={{ fontSize:16 }}>{k.icon}</div>
                              <div style={{ fontSize:13, fontWeight:900, fontFamily:'monospace', color:k.color, margin:'3px 0' }}>{k.value}</div>
                              <div style={{ fontSize:10, color:'#64748b', fontWeight:700, textTransform:'uppercase' }}>{k.label}</div>
                            </div>
                          ))}
                        </div>

                        {/* Barra logística/facturación */}
                        <div style={{ height:10, borderRadius:5, overflow:'hidden', display:'flex', border:'1px solid #e2e8f0' }}>
                          {pctLog  > 0 && <div style={{ width:`${pctLog}%`,  background:'#b91c1c', transition:'width .3s' }} title={`Logística: ${pctLog}%`} />}
                          {pctFact > 0 && <div style={{ width:`${pctFact}%`, background:'#b87c00', transition:'width .3s' }} title={`Facturación: ${pctFact}%`} />}
                          {(100-pctLog-pctFact) > 0 && <div style={{ flex:1, background:'#e2e8f0' }} title="Sin clasificar" />}
                        </div>
                        <div style={{ display:'flex', gap:16, marginTop:5, fontSize:11, fontWeight:700 }}>
                          <span style={{ color:'#b91c1c' }}>🚛 Logística {pctLog}%</span>
                          <span style={{ color:'#b87c00' }}>🧾 Facturación {pctFact}%</span>
                          {(100-pctLog-pctFact) > 0 && <span style={{ color:'#94a3b8' }}>❓ Sin clasificar {100-pctLog-pctFact}%</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
      {/* Estado vacío */}
      {rutas.length === 0 && !rechazos && (
        <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text3)' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📂</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text2)', marginBottom: 8 }}>Todavía no cargaste ningún archivo</div>
          <div style={{ fontSize: 14, fontWeight: 600, maxWidth: 440, margin: '0 auto', lineHeight: 1.7 }}>
            Cargá el <strong>CSV de pedidos</strong> para ver las rutas del día y crear borradores de registro, o el <strong>Excel de rechazos</strong> (.xlsx) para analizar los bultos rechazados por cliente y motivo.
          </div>
        </div>
      )}

      {/* Modal borrador */}
      {borradorRuta && (
        <ModalBorrador
          ruta={borradorRuta}
          cfg={cfg}
          aus={aus}
          onGuardar={guardarBorrador}
          onCerrar={() => setBorradorRuta(null)}
        />
      )}
    </div>
  );
};