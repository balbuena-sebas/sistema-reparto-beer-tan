// src/utils/exportXLSX.js
// Exportación Excel completa para Reportes — SheetJS (xlsx)
// Hojas: Resumen, Registros, Choferes, Clientes, Ausencias

import * as XLSX from 'xlsx';

// ── helpers internos ──────────────────────────────────────────────────────────
const num = (v) => parseFloat(String(v || 0).replace(/[^0-9.-]/g, '')) || 0;
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function mesLabel(mesStr) {
  if (!mesStr) return '';
  const [y, m] = mesStr.split('-');
  return `${MESES[+m - 1]} ${y}`;
}

// ── Estilo de encabezado (SheetJS solo soporta estilos en xlsx pro, usamos
//    autoWch + freezeRow para mejorar legibilidad sin librería extra) ──────────

function setColWidths(ws, widths) {
  ws['!cols'] = widths.map(w => ({ wch: w }));
}

function addSheet(wb, nombre, rows, colWidths) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  if (colWidths) setColWidths(ws, colWidths);
  // Congelar primera fila
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, ws, nombre);
}

// ══════════════════════════════════════════════════════════════════════════════
export function exportarReporteXLSX({ rM, aM, K, cfg, mes, regsAll, ausAll }) {
  const wb = XLSX.utils.book_new();
  const label = mesLabel(mes);
  const ahora = new Date().toLocaleString('es-AR');

  // ── HOJA 1: RESUMEN DEL MES ─────────────────────────────────────────────
  const resumenRows = [
    [`REPORTE DE REPARTO — ${label.toUpperCase()}`],
    [`Empresa: ${cfg.empresa || '—'}`, '', `Generado: ${ahora}`],
    [],
    ['INDICADORES GENERALES DEL MES'],
    ['Métrica', 'Valor'],
    ['Mes', label],
    ['Total Repartos', rM.length],
    ['Total Bultos', K.bultos || 0],
    ['Promedio Bultos/Reparto', rM.length ? Math.round((K.bultos || 0) / rM.length) : 0],
    ['Total Recargas', K.recargas || 0],
    ['Repartos con Recarga', K.recSI || 0],
    ['Bultos Tandil', K.tandilB || 0],
    ['Bultos Las Flores', K.floresB || 0],
    ['Ausencias registradas', aM.length],
    ['Personas afectadas', [...new Set(aM.map(a => a.persona))].length],
    [],
    ['COSTOS'],
    ['Costo Chofer (config)', cfg.costoChofer || 0],
    ['Costo Ayudante (config)', cfg.costoAyudante || 0],
    ['Costo Total Registrado', rM.reduce((s, r) => s + num(r.costoReparto), 0)],
    [],
    ['OBJETIVOS DE BULTOS'],
    ['Zona', 'Bultos entregados', 'Objetivo diario (config)', '% cumplimiento'],
    ['Tandil', K.tandilB || 0, cfg.objTandil || 0, cfg.objTandil ? pct(K.tandilB || 0, cfg.objTandil * 26) + '%' : '—'],
    ['Las Flores', K.floresB || 0, cfg.objFlores || 0, cfg.objFlores ? pct(K.floresB || 0, cfg.objFlores * 26) + '%' : '—'],
  ];
  addSheet(wb, 'Resumen', resumenRows, [32, 20, 24, 16]);

  // ── HOJA 2: REGISTROS DEL MES ───────────────────────────────────────────
  const regHeaders = ['Fecha', 'Chofer', 'Localidad', 'Destino', 'Bultos', 'Patente', 'Ayudante 1', 'Ayudante 2', 'FTE', 'N° Recargas', 'Recarga S/N', 'Costo Reparto', 'Observaciones'];
  const regRows = [
    [`REGISTROS DEL MES — ${label}`],
    regHeaders,
    ...rM.map(r => [
      r.fecha || '',
      r.chofer || '',
      r.localidad || '',
      r.destino || '',
      num(r.bultos),
      r.patente || '',
      r.ay1 || '',
      r.ay2 || '',
      r.fte || '',
      r.nRecargas || 0,
      r.recSN || 'NO',
      num(r.costoReparto),
      r.obs || '',
    ]),
    [],
    ['TOTAL', '', '', '', rM.reduce((s, r) => s + num(r.bultos), 0), '', '', '', '', rM.reduce((s, r) => s + (r.nRecargas || 0), 0), '', rM.reduce((s, r) => s + num(r.costoReparto), 0)],
  ];
  addSheet(wb, 'Registros del Mes', regRows, [12, 22, 20, 22, 10, 12, 22, 22, 8, 12, 12, 16, 30]);

  // ── HOJA 3: TODOS LOS REGISTROS HISTÓRICOS ─────────────────────────────
  const histHeaders = ['Fecha', 'Mes', 'Chofer', 'Localidad', 'Destino', 'Bultos', 'Patente', 'N° Recargas', 'Recarga S/N', 'Costo Reparto'];
  const histRows = [
    ['HISTÓRICO DE REGISTROS — TODOS LOS MESES'],
    histHeaders,
    ...regsAll.map(r => [
      r.fecha || '',
      r.fecha ? mesLabel(r.fecha.slice(0, 7)) : '',
      r.chofer || '',
      r.localidad || '',
      r.destino || '',
      num(r.bultos),
      r.patente || '',
      r.nRecargas || 0,
      r.recSN || 'NO',
      num(r.costoReparto),
    ]),
  ];
  addSheet(wb, 'Histórico Registros', histRows, [12, 16, 22, 20, 22, 10, 12, 12, 12, 16]);

  // ── HOJA 4: ANÁLISIS POR CHOFER ─────────────────────────────────────────
  const choferMap = {};
  rM.forEach(r => {
    if (!r.chofer) return;
    if (!choferMap[r.chofer]) choferMap[r.chofer] = { repartos: 0, bultos: 0, recargas: 0, costo: 0 };
    choferMap[r.chofer].repartos++;
    choferMap[r.chofer].bultos += num(r.bultos);
    choferMap[r.chofer].recargas += r.nRecargas || 0;
    choferMap[r.chofer].costo += num(r.costoReparto);
  });
  const choferList = Object.entries(choferMap).sort((a, b) => b[1].bultos - a[1].bultos);
  const maxBultosChofer = choferList[0]?.[1]?.bultos || 1;

  const choferRows = [
    [`ANÁLISIS POR CHOFER — ${label}`],
    ['Ranking', 'Chofer', 'Repartos', 'Bultos', '% del total', 'Prom. Bultos/Rep.', 'Recargas', 'Costo Total'],
    ...choferList.map(([name, d], i) => [
      i + 1,
      name,
      d.repartos,
      Math.round(d.bultos),
      pct(d.bultos, K.bultos || 1) + '%',
      d.repartos ? Math.round(d.bultos / d.repartos) : 0,
      d.recargas,
      Math.round(d.costo),
    ]),
    [],
    ['TOTAL', '', rM.length, Math.round(K.bultos || 0), '100%', '', K.recargas || 0, Math.round(rM.reduce((s, r) => s + num(r.costoReparto), 0))],
  ];
  addSheet(wb, 'Choferes', choferRows, [10, 24, 12, 12, 14, 18, 12, 16]);

  // ── HOJA 5: ANÁLISIS POR CLIENTE/DESTINO ────────────────────────────────
  const destMap = {};
  rM.forEach(r => {
    if (!r.destino) return;
    if (!destMap[r.destino]) destMap[r.destino] = { repartos: 0, bultos: 0, costo: 0, localidades: new Set() };
    destMap[r.destino].repartos++;
    destMap[r.destino].bultos += num(r.bultos);
    destMap[r.destino].costo += num(r.costoReparto);
    if (r.localidad) destMap[r.destino].localidades.add(r.localidad.split(' (')[0]);
  });
  const destList = Object.entries(destMap).sort((a, b) => b[1].bultos - a[1].bultos);

  const clienteRows = [
    [`ANÁLISIS POR CLIENTE — ${label}`],
    ['Ranking', 'Cliente', 'Zona(s)', 'Repartos', 'Bultos', '% del total', 'Prom. Bultos/Rep.', 'Costo Total'],
    ...destList.map(([dest, d], i) => [
      i + 1,
      dest,
      [...d.localidades].join(', '),
      d.repartos,
      Math.round(d.bultos),
      pct(d.bultos, K.bultos || 1) + '%',
      d.repartos ? Math.round(d.bultos / d.repartos) : 0,
      Math.round(d.costo),
    ]),
  ];
  addSheet(wb, 'Clientes', clienteRows, [10, 28, 20, 12, 12, 14, 18, 16]);

  // ── HOJA 6: AUSENCIAS ───────────────────────────────────────────────────
  const ausRows = [
    [`AUSENCIAS — ${label}`],
    ['Persona', 'Motivo', 'Desde', 'Hasta', 'Días', 'Observaciones'],
    ...aM.map(a => [
      a.persona || '',
      a.motivo || '',
      a.fechaDesde || '',
      a.fechaHasta || '',
      a.dias || 1,
      a.observaciones || '',
    ]),
    [],
    ['RESUMEN POR MOTIVO'],
    ['Motivo', 'Total días'],
    ...(() => {
      const m = {};
      aM.forEach(a => { m[a.motivo] = (m[a.motivo] || 0) + (a.dias || 1); });
      return Object.entries(m).sort((a, b) => b[1] - a[1]);
    })(),
  ];
  addSheet(wb, 'Ausencias', ausRows, [24, 20, 14, 14, 10, 40]);

  // ── HOJA 7: RESUMEN MENSUAL HISTÓRICO ───────────────────────────────────
  const histMensual = {};
  regsAll.forEach(r => {
    const m = (r.fecha || '').slice(0, 7);
    if (!m) return;
    if (!histMensual[m]) histMensual[m] = { repartos: 0, bultos: 0, recargas: 0, costo: 0 };
    histMensual[m].repartos++;
    histMensual[m].bultos += num(r.bultos);
    histMensual[m].recargas += r.nRecargas || 0;
    histMensual[m].costo += num(r.costoReparto);
  });
  const mesesOrdenados = Object.keys(histMensual).sort((a, b) => b.localeCompare(a));

  const histMensualRows = [
    ['RESUMEN HISTÓRICO POR MES'],
    ['Mes', 'Repartos', 'Bultos', 'Recargas', 'Costo Total', 'Prom. Bultos/Rep.'],
    ...mesesOrdenados.map(m => {
      const d = histMensual[m];
      return [
        mesLabel(m),
        d.repartos,
        Math.round(d.bultos),
        d.recargas,
        Math.round(d.costo),
        d.repartos ? Math.round(d.bultos / d.repartos) : 0,
      ];
    }),
  ];
  addSheet(wb, 'Histórico Mensual', histMensualRows, [20, 12, 14, 12, 16, 18]);

  // ── Generar y descargar ─────────────────────────────────────────────────
  const fileName = `Reporte_Reparto_${mes}_${cfg.empresa ? cfg.empresa.replace(/\s/g,'_') : 'BeerTan'}.xlsx`;
  XLSX.writeFile(wb, fileName);
}