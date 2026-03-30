// ── helpers/diasTrabajados.js ─────────────────────────────────────────────────
// Calcula días trabajados en un rango: lunes a sábado,
// descontando feriados nacionales argentinos y días extra ingresados en Config.

// Feriados nacionales Argentina 2025-2026 (inamovibles + puentes oficiales)
const FERIADOS_AR = new Set([
  // 2025
  '2025-01-01','2025-02-24','2025-02-25',
  '2025-03-24','2025-04-02','2025-04-18',
  '2025-05-01','2025-05-25','2025-06-20',
  '2025-07-09','2025-08-17','2025-10-12',
  '2025-11-20','2025-12-08','2025-12-25',
  // 2026
  '2026-01-01','2026-02-16','2026-02-17',
  '2026-03-23','2026-03-24','2026-04-02','2026-04-03',
  '2026-05-01','2026-05-25','2026-06-15','2026-06-20',
  '2026-07-09','2026-08-17','2026-10-12',
  '2026-11-20','2026-12-08','2026-12-25',
]);

export function calcDiasTrabajados(desde, hasta, diasExtra = []) {
  // desde/hasta: 'YYYY-MM-DD'
  if (!desde || !hasta) return null;
  const extra = new Set(diasExtra || []);
  let count = 0;
  const d = new Date(desde + 'T12:00:00');
  const h = new Date(hasta  + 'T12:00:00');
  while (d <= h) {
    const dow  = d.getDay(); // 0=dom, 6=sab
    const iso  = d.toISOString().slice(0, 10);
    const esLaboral = dow >= 1 && dow <= 6; // lun-sab
    const esFeriado = FERIADOS_AR.has(iso) || extra.has(iso);
    if (esLaboral && !esFeriado) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

// Devuelve rango del mes a partir de un array de fechas (strings YYYY-MM-DD)
export function rangoMes(fechas) {
  if (!fechas || fechas.length === 0) return { desde: null, hasta: null };
  const sorted = [...fechas].sort();
  return { desde: sorted[0], hasta: sorted[sorted.length - 1] };
}