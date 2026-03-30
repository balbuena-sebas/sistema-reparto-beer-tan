// src/utils/helpers.js

export const fp = (n) =>
  n || n === 0 ? "$" + Math.round(n).toLocaleString("es-AR") : "—";

export const fn = (n) => (n || 0).toLocaleString("es-AR");

export const recN = (t) =>
  t === "1 recarga" ? 1 : t === "3 recargas" ? 3 : 0;

export const cFTE = (c, a1, a2) => (c ? 1 : 0) + (a1 ? 1 : 0) + (a2 ? 1 : 0);

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

export const isT = (l) => l && l.includes("Tandil");

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

export const diasH = (ms) => {
  const [y, m] = ms.split("-").map(Number);
  let h = 0;
  for (let i = 1; i <= new Date(y, m, 0).getDate(); i++) {
    if (new Date(y, m - 1, i).getDay() !== 0) h++;
  }
  return h;
};

export const diasT = (ms) => {
  const hoy = new Date();
  const [y, m] = ms.split("-").map(Number);
  if (hoy.getFullYear() !== y || hoy.getMonth() + 1 !== m) return diasH(ms);
  let h = 0;
  for (let i = 1; i <= hoy.getDate(); i++) {
    if (new Date(y, m - 1, i).getDay() !== 0) h++;
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