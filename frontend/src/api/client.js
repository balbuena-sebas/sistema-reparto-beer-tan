// src/api/client.js
const BASE_URL = process.env.REACT_APP_API_URL || "https://beer-tan-backend.onrender.com";
const API_KEY  = process.env.REACT_APP_API_KEY || "heavy-behind-blush-will";


async function apiFetch(path, options = {}) {
  const res  = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      ...(options.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || `Error ${res.status}`);
  return data; // devuelve { ok, data, resultado, ... } completo
}

// ── REGISTROS ────────────────────────────────────────────────────────────────
export async function getRegistros(mes = null) {
  const q = mes ? `?mes=${mes}` : '';
  const r = await apiFetch(`/api/registros${q}`);
  return r.data || [];
}
export async function crearRegistro(reg) {
  const r = await apiFetch('/api/registros', { method: 'POST', body: JSON.stringify(reg) });
  return r.data;
}
export async function actualizarRegistro(id, reg) {
  const r = await apiFetch(`/api/registros/${id}`, { method: 'PUT', body: JSON.stringify(reg) });
  return r.data;
}
export async function eliminarRegistro(id) {
  return apiFetch(`/api/registros/${id}`, { method: 'DELETE' });
}

// ── AUSENCIAS ────────────────────────────────────────────────────────────────
export async function getAusencias(mes = null) {
  const q = mes ? `?mes=${mes}` : '';
  const r = await apiFetch(`/api/ausencias${q}`);
  return r.data || [];
}
export async function crearAusencia(aus) {
  const r = await apiFetch('/api/ausencias', { method: 'POST', body: JSON.stringify(aus) });
  return r.data;
}
export async function actualizarAusencia(id, aus) {
  const r = await apiFetch(`/api/ausencias/${id}`, { method: 'PUT', body: JSON.stringify(aus) });
  return r.data;
}
export async function eliminarAusencia(id) {
  return apiFetch(`/api/ausencias/${id}`, { method: 'DELETE' });
}

// ── CONFIG ───────────────────────────────────────────────────────────────────
export async function getConfig() {
  const r = await apiFetch('/api/config');
  return r.data || r;
}
export async function guardarConfig(cfg) {
  const r = await apiFetch('/api/config', { method: 'PUT', body: JSON.stringify(cfg) });
  return r.data || r;
}

// ── RECHAZOS ─────────────────────────────────────────────────────────────────
export async function getRechazos(filtros = {}) {
  const q = new URLSearchParams(filtros).toString();
  const r = await apiFetch(`/api/rechazos${q ? '?' + q : ''}`);
  return r.data || [];
}

export async function importarRechazos(rows, archivo, totalesArchivo = null) {
  const r = await apiFetch('/api/rechazos/importar', {
    method: 'POST',
    body: JSON.stringify({ rows, archivo, totalesArchivo }),
  });
  return r;
}

export async function getArchivosRechazos() {
  // Devuelve array de archivos importados con stats
  const r = await apiFetch('/api/rechazos/archivos');
  return r.data || [];
}

export async function verificarArchivoRechazos(archivo) {
  // Devuelve { ok, existe, cantidad, primera }
  return apiFetch(`/api/rechazos/verificar/${encodeURIComponent(archivo)}`);
}

export async function eliminarArchivoRechazos(archivo) {
  // Elimina todos los registros de un archivo — devuelve { ok, eliminados }
  return apiFetch(`/api/rechazos/archivo/${encodeURIComponent(archivo)}`, { method: 'DELETE' });
}

export async function editarRechazo(id, datos) {
  const r = await apiFetch(`/api/rechazos/${id}`, { method: 'PUT', body: JSON.stringify(datos) });
  return r; // { ok, data: rechazoActualizado }
}

export async function eliminarRechazo(id) {
  return apiFetch(`/api/rechazos/${id}`, { method: 'DELETE' });
}

export async function deduplicarRechazos() {
  return apiFetch('/api/rechazos/deduplicar', { method: 'POST' });
}

export async function eliminarRechazosArchivo(nombre) {
  return apiFetch(`/api/rechazos/archivo/${encodeURIComponent(nombre)}`, { method: 'DELETE' });
}

// ── MIGRACIÓN ─────────────────────────────────────────────────────────────────
export async function migrarDesdeLocalStorage(regs, aus, cfg) {
  const r = await apiFetch('/api/migracion', {
    method: 'POST',
    body: JSON.stringify({ regs, aus, cfg }),
  });
  return r;
}


// ── BULTOS POR MES ───────────────────────────────────────────────────────────
export async function getBultosPorMes() {
  try {
    const r = await apiFetch('/api/rechazos/bultos-por-mes');
    return r.data || {};
  } catch {
    return {};
  }
}

// ── NOTAS ─────────────────────────────────────────────────────────────────────

// ── NOTAS ─────────────────────────────────────────────────────────────────────
export async function getNotas(filtros = {}) {
  const q = new URLSearchParams(filtros).toString();
  const r = await apiFetch(`/api/notas${q ? '?' + q : ''}`);
  return r.data || [];
}

export async function crearNota(nota) {
  const r = await apiFetch('/api/notas', { method: 'POST', body: JSON.stringify(nota) });
  return r.data;
}

export async function actualizarNota(id, datos) {
  const r = await apiFetch(`/api/notas/${id}`, { method: 'PUT', body: JSON.stringify(datos) });
  return r.data;
}

export async function eliminarNota(id) {
  return apiFetch(`/api/notas/${id}`, { method: 'DELETE' });
}

// ═══════════════════════════════════════════════════════════════════════════
// ADICIÓN client.js — Agregar al final del archivo src/api/client.js existente
// ═══════════════════════════════════════════════════════════════════════════

// ── FOXTROT ──────────────────────────────────────────────────────────────────

export async function getFoxtrotRutas(filtros = {}) {
  const q = new URLSearchParams(filtros).toString();
  const r = await apiFetch(`/api/foxtrot/rutas${q ? '?' + q : ''}`);
  return r.data || [];
}

export async function getFoxtrotIntentos(filtros = {}) {
  const q = new URLSearchParams(filtros).toString();
  const r = await apiFetch(`/api/foxtrot/intentos${q ? '?' + q : ''}`);
  return r.data || [];
}

export async function getFoxtrotArchivos() {
  const r = await apiFetch('/api/foxtrot/archivos');
  return r.data || [];
}

export async function getFoxtrotKpisPorChofer(filtros = {}) {
  const q = new URLSearchParams(filtros).toString();
  const r = await apiFetch(`/api/foxtrot/kpis-por-chofer${q ? '?' + q : ''}`);
  return r.data || [];
}

export async function importarFoxtrot(rutasRows, intentosRows, archivo, driverMap = []) {
  const r = await apiFetch('/api/foxtrot/importar', {
    method: 'POST',
    body: JSON.stringify({ rutasRows, intentosRows, archivo, driverMap }),
  });
  return r;
}

export async function verificarArchivoFoxtrot(archivo) {
  return apiFetch(`/api/foxtrot/verificar/${encodeURIComponent(archivo)}`);
}

export async function eliminarArchivoFoxtrot(archivo) {
  return apiFetch(`/api/foxtrot/archivo/${encodeURIComponent(archivo)}`, { method: 'DELETE' });
}