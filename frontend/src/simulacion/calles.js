// simulacion/calles.js — Ruta real por calles con OSRM (servidor público gratuito, sin clave).
// Se pide una vez por camión y se guarda en memoria/localStorage. Si falla, la app sigue con líneas rectas.
const OSRM = 'https://router.project-osrm.org/route/v1/driving/';
const memoria = new Map();
const LS_KEY = 'sim_calles_v1';
let persistido = null;
const leerLS = () => { if (persistido) return persistido; try { persistido = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { persistido = {}; } return persistido; };
const guardarLS = (k, v) => { try { const p = leerLS(); p[k] = v; const ks = Object.keys(p); if (ks.length > 25) delete p[ks[0]];
  localStorage.setItem(LS_KEY, JSON.stringify(p)); } catch { /* sin almacenamiento */ } };

const fmt = (c) => `${c.lon.toFixed(5)},${c.lat.toFixed(5)}`;
export const claveRuta = (dep, pts) => [dep, ...pts, dep].map(fmt).join(';');

async function pedir(coords, ms = 12000) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(`${OSRM}${coords.map(fmt).join(';')}?overview=simplified&geometries=geojson&continue_straight=false`, { signal: ctrl.signal });
    if (!r.ok) throw new Error('OSRM ' + r.status);
    const d = await r.json();
    if (d.code !== 'Ok' || !d.routes?.[0]) throw new Error('OSRM sin ruta');
    return d.routes[0];
  } finally { clearTimeout(t); }
}

// Devuelve { coords:[[lon,lat]], km, min } o null si no se pudo
export async function rutaPorCalles(dep, pts) {
  if (!pts.length) return null;
  const k = claveRuta(dep, pts);
  if (memoria.has(k)) return memoria.get(k);
  const ls = leerLS()[k]; if (ls) { memoria.set(k, ls); return ls; }
  try {
    const todos = [dep, ...pts, dep]; const TAM = 90; let coords = [], m = 0, s = 0;
    for (let i = 0; i < todos.length - 1; i += TAM - 1) {
      const r = await pedir(todos.slice(i, i + TAM));
      coords = coords.concat(r.geometry.coordinates); m += r.distance; s += r.duration;
    }
    const res = { coords, km: m / 1000, min: Math.round(s / 60) };
    memoria.set(k, res); guardarLS(k, res); return res;
  } catch { return null; }
}
