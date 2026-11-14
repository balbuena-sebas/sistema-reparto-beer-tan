// simulacion/mapa.js — Mapa MapLibre GL (gratis, sin clave): calle, satélite y 3D con relieve.
// Fuentes: OpenFreeMap (vectores + edificios 3D), Esri World Imagery (satélite), AWS Terrain Tiles (relieve).
import maplibregl from 'maplibre-gl/dist/maplibre-gl-csp';
import 'maplibre-gl/dist/maplibre-gl.css';

// Worker servido desde /public (evita problemas del bundler con workers embebidos).
maplibregl.setWorkerUrl(window.__MAPLIBRE_WORKER_URL__ || `${process.env.PUBLIC_URL || ''}/maplibre-gl-csp-worker.js`);

export const COLORES = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#0aa5a5',
  '#c2185b', '#8d6e00', '#1b5e20', '#37474f', '#ff6f00', '#6a1b9a'];

const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
const DEM = { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
  encoding: 'terrarium', tileSize: 256, maxzoom: 14, attribution: 'Terrain: Mapzen/AWS' };
const SAT = {
  version: 8, glyphs: GLYPHS,
  sources: {
    sat: { type: 'raster', tileSize: 256, maxzoom: 19,
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      attribution: 'Imágenes © Esri, Maxar, Earthstar Geographics' },
    dem: DEM,
  },
  layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
};
const CALLE = 'https://tiles.openfreemap.org/styles/liberty';

export const VISTAS = {
  calle:  { label: 'Calle',        style: CALLE, pitch: 0,  terrain: false },
  sat:    { label: 'Satélite',     style: SAT,   pitch: 0,  terrain: false },
  calle3d:{ label: 'Calle 3D',     style: CALLE, pitch: 62, terrain: true },
  sat3d:  { label: 'Satélite 3D',  style: SAT,   pitch: 65, terrain: true },
};

// Mapa base de respaldo: sin internet o con el servicio caído igual se ven puntos y rutas.
const RESPALDO = { version: 8, glyphs: GLYPHS, sources: {},
  layers: [{ id: 'fondo', type: 'background', paint: { 'background-color': '#e6edf4' } }] };

export function crearMapa(el, centro, onBaseFallo) {
  const map = new maplibregl.Map({
    container: el, style: VISTAS.calle.style, center: [centro.lon, centro.lat], zoom: 10.5,
    attributionControl: { compact: true }, maxPitch: 80,
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
  map.addControl(new maplibregl.FullscreenControl(), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
  map._vista = 'calle';
  const vigilar = () => {
    clearTimeout(map._vigia);
    map._vigia = setTimeout(() => {
      if (map._removed || map._respaldo) return;
      if (!map.isStyleLoaded()) {
        map._respaldo = true; map.setStyle(RESPALDO);
        map.once('style.load', () => { onBaseFallo && onBaseFallo(); map.fire('sim-respaldo'); });
      }
    }, 7000);
  };
  map._vigilar = vigilar; vigilar();
  return map;
}

function asegurarTerreno(map, activo) {
  try {
    if (activo) {
      if (!map.getSource('dem')) map.addSource('dem', DEM);
      map.setTerrain({ source: 'dem', exaggeration: 1.25 });
    } else if (map.getTerrain && map.getTerrain()) {
      map.setTerrain(null);
    }
  } catch { /* terreno opcional */ }
}

export function cambiarVista(map, clave, redibujar) {
  const v = VISTAS[clave]; if (!v) return;
  const mismoEstilo = map._vista && VISTAS[map._vista].style === v.style;
  map._vista = clave; map._respaldo = false;
  map._vigilar && map._vigilar();
  const aplicar = () => {
    asegurarTerreno(map, v.terrain);
    map.easeTo({ pitch: v.pitch, bearing: v.pitch ? -20 : 0, duration: 900 });
    redibujar && redibujar();
  };
  if (mismoEstilo) { aplicar(); return; }
  map.setStyle(v.style);
  map.once('style.load', aplicar);
}

// datos: { deposito, rutas:[{color,label,puntos:[{lat,lon,seq,titulo,detalle}], geom?:[[lon,lat]...]}], etiquetas:[{lat,lon,texto,color}], soloRuta }
export function pintar(map, datos, onClickPunto) {
  const lineas = [], puntos = [];
  (datos.rutas || []).forEach((r, i) => {
    if (datos.soloRuta != null && datos.soloRuta !== i) return;
    const coords = r.geom && r.geom.length > 1 ? r.geom : [[datos.deposito.lon, datos.deposito.lat], ...r.puntos.map((p) => [p.lon, p.lat])];
    lineas.push({ type: 'Feature', properties: { color: r.color }, geometry: { type: 'LineString', coordinates: coords } });
    r.puntos.forEach((p) => puntos.push({
      type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      properties: { color: r.color, seq: p.seq, titulo: p.titulo, detalle: p.detalle, ruta: r.label },
    }));
  });
  const etiquetas = (datos.etiquetas || []).filter((e) => datos.soloRuta == null || e.ruta === datos.soloRuta).map((e) => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: [e.lon, e.lat] }, properties: { texto: e.texto, color: e.color } }));
  puntos.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [datos.deposito.lon, datos.deposito.lat] },
    properties: { color: '#111', seq: '⌂', titulo: 'Depósito', detalle: 'Punto de salida', ruta: '' } });

  const poner = () => {
    const sl = map.getSource('sim-lineas'), sp = map.getSource('sim-puntos'), se = map.getSource('sim-etq');
    if (sl && sp && se) { sl.setData({ type: 'FeatureCollection', features: lineas });
      sp.setData({ type: 'FeatureCollection', features: puntos }); se.setData({ type: 'FeatureCollection', features: etiquetas }); return; }
    map.addSource('sim-lineas', { type: 'geojson', data: { type: 'FeatureCollection', features: lineas } });
    map.addSource('sim-puntos', { type: 'geojson', data: { type: 'FeatureCollection', features: puntos } });
    map.addSource('sim-etq', { type: 'geojson', data: { type: 'FeatureCollection', features: etiquetas } });
    map.addLayer({ id: 'sim-lineas', type: 'line', source: 'sim-lineas',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': 2.5, 'line-opacity': 0.75 } });
    map.addLayer({ id: 'sim-puntos', type: 'circle', source: 'sim-puntos',
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 3.5, 14, 8], 'circle-color': ['get', 'color'],
        'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } });
    map.addLayer({ id: 'sim-etq', type: 'symbol', source: 'sim-etq',
      layout: { 'text-field': ['get', 'texto'], 'text-size': 13, 'text-font': ['Noto Sans Bold'], 'text-offset': [0, -1.6], 'text-allow-overlap': true },
      paint: { 'text-color': ['get', 'color'], 'text-halo-color': '#fff', 'text-halo-width': 2 } });
    map.addLayer({ id: 'sim-seq', type: 'symbol', source: 'sim-puntos', minzoom: 13.5,
      layout: { 'text-field': ['to-string', ['get', 'seq']], 'text-size': 10, 'text-font': ['Noto Sans Bold'], 'text-allow-overlap': true },
      paint: { 'text-color': '#fff' } });
    if (map._simHandlers) return;
    map._simHandlers = true;
    map.on('click', 'sim-puntos', (e) => {
      const f = e.features && e.features[0]; if (!f) return;
      const p = f.properties;
      const html = `<div class="sim-pop"><b>${esc(p.titulo)}</b><br>${esc(p.detalle)}${p.ruta ? `<br><span style="color:${esc(p.color)}">● ${esc(p.ruta)}</span>` : ''}</div>`;
      new maplibregl.Popup({ offset: 10 }).setLngLat(f.geometry.coordinates).setHTML(html).addTo(map);
      onClickPunto && onClickPunto(p);
    });
    map.on('mouseenter', 'sim-puntos', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'sim-puntos', () => { map.getCanvas().style.cursor = ''; });
  };
  if (map.isStyleLoaded()) poner(); else map.once('idle', poner);
  return { lineas, puntos };
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function encuadrar(map, datos) {
  const b = new maplibregl.LngLatBounds();
  b.extend([datos.deposito.lon, datos.deposito.lat]);
  let n = 0;
  (datos.rutas || []).forEach((r, i) => {
    if (datos.soloRuta != null && datos.soloRuta !== i) return;
    r.puntos.forEach((p) => { b.extend([p.lon, p.lat]); n++; });
  });
  if (n) map.fitBounds(b, { padding: 60, duration: 800, maxZoom: 15 });
}
