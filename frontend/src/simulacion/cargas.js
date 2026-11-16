// simulacion/cargas.js — Carga de archivos de ruteo (romaneo del ruteador y maestra de clientes).
// Se usa desde la pestaña Importar; la pestaña Simulación se actualiza sola por el canal en vivo.
import * as XLSX from 'xlsx';
import { apiFetch } from '../api/client';
import { parseRomaneo, parseMaestra } from './engine';

const leer = (file) => new Promise((ok, mal) => {
  const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => mal(r.error); r.readAsArrayBuffer(file);
});
const cede = () => new Promise((r) => setTimeout(r, 0));

export async function cargarRomaneos(files, hdr, progreso = () => {}) {
  let nDias = 0; const ubic = new Map();
  for (const file of files) {
    progreso(`Leyendo ${file.name}…`); await cede();
    // Sirve el Excel del ruteador (hoja "Romaneiro") o el Excel de entrega diaria (hoja "Datos", con todos los días juntos).
    const wb = XLSX.read(await leer(file), { type: 'array', sheets: ['Romaneiro', 'Datos'] });
    const hoja = wb.Sheets.Romaneiro || wb.Sheets.Datos;
    if (!hoja) throw new Error(`${file.name}: no tiene la hoja "Romaneiro" ni la hoja "Datos".`);
    const dias = parseRomaneo(XLSX.utils.sheet_to_json(hoja));
    if (!Object.keys(dias).length) throw new Error(`${file.name}: no encontré entregas con coordenadas.`);
    for (const d of Object.values(dias)) {
      progreso(`Guardando ${d.fecha}…`);
      await apiFetch(`/api/ruteo/dia/${d.fecha}`, { method: 'PUT', headers: hdr,
        body: JSON.stringify({ rutas: d.rutas, paradas: d.paradas, resumen: d.resumen }) });
      nDias++;
      d.paradas.forEach((p) => ubic.set(p[2], [p[2], p[4], p[5], p[3], '']));
    }
  }
  if (ubic.size) await apiFetch('/api/ruteo/ubicaciones', { method: 'PUT', headers: hdr, body: JSON.stringify({ items: [...ubic.values()] }) });
  return nDias;
}

export async function cargarMaestra(file, hdr, progreso = () => {}) {
  progreso('Leyendo maestra de clientes…'); await cede();
  const wb = XLSX.read(await leer(file), { type: 'array' });
  const items = parseMaestra(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]));
  if (!items.length) throw new Error('No encontré clientes con coordenadas (columnas Cliente, Coord X, Coord Y).');
  progreso(`Guardando ${items.length} clientes…`);
  await apiFetch('/api/ruteo/ubicaciones', { method: 'PUT', headers: hdr, body: JSON.stringify({ items, reemplazar: true }) });
  return items.length;
}
