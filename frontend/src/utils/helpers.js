// src/utils/helpers.js

// Feriados nacionales Argentina 2025-2026
const FERIADOS_AR = new Set([
  '2025-01-01','2025-02-24','2025-02-25','2025-03-24','2025-04-02','2025-04-18',
  '2025-05-01','2025-05-25','2025-06-20','2025-07-09','2025-08-17','2025-10-12',
  '2025-11-20','2025-12-08','2025-12-25',
  '2026-01-01','2026-02-16','2026-02-17','2026-03-23','2026-03-24','2026-04-02',
  '2026-04-03','2026-05-01','2026-05-25','2026-06-15','2026-06-20','2026-07-09',
  '2026-08-17','2026-10-12','2026-11-20','2026-12-08','2026-12-25',
]);

export const fp = (n) =>
  n || n === 0 ? "$" + Math.round(n).toLocaleString("es-AR") : "—";

export const fn = (n) => (n || 0).toLocaleString("es-AR");

export const recN = (t) =>
  t === "1 recarga" ? 1 : t === "3 recargas" ? 3 : 0;

export const cFTE = (c, a1, a2) => 
  ((c || '').trim() ? 1 : 0) + 
  ((a1 || '').trim() ? 1 : 0) + 
  ((a2 || '').trim() ? 1 : 0);

export function cRec(b, f, p1 = 450, p2 = 700, p3 = 900) {
  if (!f) return "Pendiente FTE";
  if (f === 1) return "Falta Ayudante";
  if (!b || isNaN(+b) || +b <= 0) return "Pendiente Bultos";
  b = +b;
  f = +f;
  if (f === 3 && b > 900 && b <= 1200) return "1 recarga";
  if (f === 3 && b > 1200) return "3 recargas";
  if (b <= p1) return "Sin recarga";
  if (b <= p2 && f === 2) return "1 recarga";
  if (b <= p2 && f >= 3) return "Sin recarga";
  if (b <= p3) return "1 recarga";
  return "3 recargas";
}

export const fd = (d) => {
  if (!d) return "";
  const dt = new Date(d + "T12:00:00");
  return dt.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
};

export const tod = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const mesN = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export const isT = (l) => {
  if (!l) return false;
  const s = String(l).toLowerCase();
  return (
    s.includes("tandil") ||
    s.includes("vela") ||
    s.includes("barker") ||
    s.includes("gardey") ||
    s.includes("juarez") ||
    s.includes("san manuel") ||
    s.includes("fernandez")
  );
};

export const cDias = (d1, d2) => {
  if (!d1) return 1;
  const a = new Date(d1 + "T12:00:00");
  const b = d2 ? new Date(d2 + "T12:00:00") : a;
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
};

export const semK = (f) => {
  if (!f) return "";
  const d = new Date(f + "T12:00:00");
  const l = new Date(d);
  l.setDate(d.getDate() - ((d.getDay() || 7) - 1));
  return `${l.getFullYear()}-${String(l.getMonth() + 1).padStart(2, "0")}-${String(l.getDate()).padStart(2, "0")}`;
};

export const semL = (k) => {
  if (!k) return "";
  const d = new Date(k + "T12:00:00");
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export const diasH = (ms, diasNo = []) => {
  const [y, m] = ms.split("-").map(Number);
  let h = 0;
  const holidays = new Set((diasNo || []).map(d => d.fecha || d));
  for (let i = 1; i <= new Date(y, m, 0).getDate(); i++) {
    const d = new Date(y, m - 1, i);
    const iso = `${y}-${String(m).padStart(2, "0")}-${String(i).padStart(2, "0")}`;
    if (d.getDay() !== 0 && !holidays.has(iso) && !FERIADOS_AR.has(iso)) h++;
  }
  return h;
};

export const diasT = (ms, diasNo = []) => {
  const hoy = new Date();
  const [y, m] = ms.split("-").map(Number);
  if (hoy.getFullYear() !== y || hoy.getMonth() + 1 !== m) return diasH(ms, diasNo);
  let h = 0;
  const holidays = new Set((diasNo || []).map(d => d.fecha || d));
  for (let i = 1; i <= hoy.getDate(); i++) {
    const d = new Date(y, m - 1, i);
    const iso = `${y}-${String(m).padStart(2, "0")}-${String(i).padStart(2, "0")}`;
    if (d.getDay() !== 0 && !holidays.has(iso) && !FERIADOS_AR.has(iso)) h++;
  }
  return Math.max(1, h);
};

export function genDemo() {
  const regs = [],
    aus = [];
  let id = 1;
  const now = new Date();
  const fechas = [];
  for (let i = 22; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    if (d.getDay() !== 0)
      fechas.push(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
      );
  }
  const T = [
    { ch: "Romero Diego", a1: "Ferreyra Sergio", a2: "", loc: "TANDIL (Tandil)", dest: "DIARCO S.A", pat: "AE 338 DR", bb: 820 },
    { ch: "Rodriguez Nicolas", a1: "Frutos Miguel", a2: "Lucas", loc: "LAS FLORES (Las Flores)", dest: "CAMION SERRANO", pat: "JBQ 192", bb: 1050 },
    { ch: "Nuñez Gaston", a1: "Guillermo Martin", a2: "", loc: "BENITO JUAREZ (Tandil)", dest: "COOPERATIVA JUAREZ", pat: "PAU 314", bb: 610 },
    { ch: "Quiroga Luciano", a1: "Salinas Valentino", a2: "Di Paolo Ezequiel", loc: "RAUCH (Las Flores)", dest: "INC 9 DE JULIO", pat: "AF 577 SM", bb: 940 },
    { ch: "Acosta Roberto", a1: "Rodriguez Alejandro", a2: "", loc: "CACHARI (Las Flores)", dest: "VEA", pat: "NDS 242", bb: 380 },
    { ch: "Rodriguez Martin", a1: "Ferreyra Sergio", a2: "", loc: "VELA-BARKER (Tandil)", dest: "INC DEL VALLE", pat: "PAU 320", bb: 750 }
  ];
  fechas.forEach((fecha, fi) => {
    const n = 2 + (fi % 3);
    for (let k = 0; k < Math.min(n, T.length); k++) {
      const t = T[(fi + k) % T.length];
      const bultos = Math.round(t.bb * (0.82 + Math.random() * 0.36));
      const fte = cFTE(t.ch, t.a1, t.a2);
      const recCant = cRec(bultos, fte);
      const nRec = recN(recCant);
      regs.push({
        id: id++,
        fecha,
        chofer: t.ch,
        ay1: t.a1,
        ay2: t.a2,
        patente: t.pat,
        localidad: t.loc,
        destino: t.dest,
        bultos,
        fte,
        recCant,
        recSN: nRec > 0 ? "SI" : "NO",
        nRecargas: nRec,
        costoReparto: 40000 + Math.floor(Math.random() * 36000)
      });
    }
    if (fi % 3 === 0)
      aus.push({
        id: id++,
        persona: "Perez Fabian",
        motivo: "Día Libre",
        fechaDesde: fecha,
        fechaHasta: fecha,
        observaciones: "",
        dias: 1
      });
    if (fi % 5 === 1)
      aus.push({
        id: id++,
        persona: "Dealviso Guillermo",
        motivo: "Sin Reparto",
        fechaDesde: fecha,
        fechaHasta: fecha,
        observaciones: "Mantenimiento",
        dias: 1
      });
    if (fi % 8 === 0)
      aus.push({
        id: id++,
        persona: "Suarez Jorge",
        motivo: "Enfermedad",
        fechaDesde: fecha,
        fechaHasta: fecha,
        observaciones: "",
        dias: 1
      });
  });
  return { regs, aus };
}

const SK = "repartov3";
export const sLoad = () => {
  try {
    const s = sessionStorage.getItem(SK);
    if (s) return JSON.parse(s);
  } catch {}
  return null;
};
export const sSave = (d) => {
  try {
    sessionStorage.setItem(SK, JSON.stringify(d));
  } catch {}
};