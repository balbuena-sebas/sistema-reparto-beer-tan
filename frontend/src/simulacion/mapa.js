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
const SAT_HIB = {
  ...SAT,
  sources: { ...SAT.sources,
    ref: { type: 'raster', tileSize: 256, maxzoom: 19,
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
      attribution: 'Etiquetas © Esri' } },
  layers: [...SAT.layers, { id: 'ref', type: 'raster', source: 'ref' }],
};
const CALLE = 'https://tiles.openfreemap.org/styles/liberty';

export const VISTAS = {
  calle:  { label: 'Calle',        style: CALLE, pitch: 0,  terrain: false },
  sat:    { label: 'Satélite',     style: SAT,   pitch: 0,  terrain: false },
  hib:    { label: 'Híbrido',      style: SAT_HIB, pitch: 0, terrain: false },
  calle3d:{ label: 'Calle 3D',     style: CALLE, pitch: 62, terrain: true },
  sat3d:  { label: 'Satélite 3D',  style: SAT,   pitch: 65, terrain: true },
};

// Mapa base de respaldo: sin internet o con el servicio caído igual se ven puntos y rutas.
const RESPALDO = { version: 8, glyphs: GLYPHS,
  sources: { base: { type: 'raster', tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap',
    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'] } },
  layers: [{ id: 'fondo', type: 'background', paint: { 'background-color': '#e6edf4' } },
    { id: 'base', type: 'raster', source: 'base' }] };

export function crearMapa(el, centro, onBaseFallo) {
  const map = new maplibregl.Map({
    container: el, style: VISTAS.calle.style, center: [centro.lon, centro.lat], zoom: 10.5,
    attributionControl: { compact: true }, maxPitch: 80,
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
  map.addControl(new maplibregl.FullscreenControl(), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
  map._vista = 'calle';
  // style.load = el estilo (JSON) llegó. No uso isStyleLoaded(): da false mientras se bajan teselas
  // y eso tiraba el mapa bueno al respaldo en conexiones lentas.
  map._estiloOk = false;
  map.on('style.load', () => { map._estiloOk = true; });
  const caer = (motivo) => {
    if (map._removed || map._respaldo || map._estiloOk) return;
    map._respaldo = true;
    // eslint-disable-next-line no-console
    console.warn('[mapa] no cargó el mapa base:', motivo);
    map.setStyle(RESPALDO);
    onBaseFallo && onBaseFallo(motivo);
    map.once('style.load', () => map.fire('sim-respaldo'));
  };
  // Si el estilo falla (bloqueo del navegador, sin internet, servicio caído) se ve el motivo y se pasa al respaldo ya.
  map.on('error', (e) => {
    const msg = (e && e.error && e.error.message) || String(e && e.error);
    map._ultimoError = msg;
    if (!map._estiloOk && !map._respaldo) caer(msg);
  });
  const vigilar = () => {
    clearTimeout(map._vigia);
    map._estiloOk = false;
    map._vigia = setTimeout(() => caer(map._ultimoError || 'tiempo de espera agotado (15 s)'), 15000);
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
  const veniaDeRespaldo = map._respaldo;
  const mismoEstilo = !veniaDeRespaldo && map._vista && VISTAS[map._vista].style === v.style;
  map._vista = clave; map._respaldo = false;
  const aplicar = () => {
    asegurarTerreno(map, v.terrain);
    map.easeTo({ pitch: v.pitch, bearing: v.pitch ? -20 : 0, duration: 900 });
    redibujar && redibujar();
  };
  if (mismoEstilo) { aplicar(); return; }
  map._vigilar && map._vigilar();
  map.setStyle(v.style);
  map.once('style.load', aplicar);
}

// datos: { deposito, rutas:[{color,label,puntos:[{lat,lon,seq,titulo,detalle}], geom?:[[lon,lat]...]}], etiquetas:[{lat,lon,texto,color}], soloRuta }
// Botones del cartelito de un cliente: pasarlo a otro camión con un solo clic (o marcarlo para mover varios)
function botonesMover(map, p) {
  const d = map._destinos || [];
  if (!p.cod || !d.length || !map._onMover) return '';
  return `<div class="sim-pop-mover"><span>Pasar a:</span>${d.map((x) => `<button type="button" data-dest="${esc(x.v)}" ${x.color && x.color === p.color ? 'disabled' : ''} title="${esc(x.t)}" style="--c:${esc(x.color || '#78909c')}">${esc(x.t)}</button>`).join('')}<button type="button" data-dest="marcar" class="marcar" title="Marcarlo para mover varios juntos">☑ Marcar</button></div>`;
}
function conectarBotones(map, pop, p) {
  const el = pop.getElement && pop.getElement();
  if (!el || !map._onMover) return;
  el.querySelectorAll('button[data-dest]').forEach((b) => b.addEventListener('click', () => { map._onMover(Number(p.cod), b.dataset.dest); pop.remove(); }));
}
export function conectarMover(map, fn) { if (map) map._onMover = fn; }

export function pintar(map, datos, onClickPunto) {
  if (onClickPunto) map._onPunto = onClickPunto;
  map._destinos = datos.destinos || [];
  const lineas = [], puntos = [];
  (datos.rutas || []).forEach((r, i) => {
    if (datos.soloRuta != null && datos.soloRuta !== i) return;
    const coords = r.geom && r.geom.length > 1 ? r.geom : [[datos.deposito.lon, datos.deposito.lat], ...r.puntos.map((p) => [p.lon, p.lat])];
    lineas.push({ type: 'Feature', properties: { color: r.color }, geometry: { type: 'LineString', coordinates: coords } });
    r.puntos.forEach((p) => puntos.push({
      type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      properties: { color: r.color, seq: p.seq, titulo: p.titulo, detalle: p.detalle, ruta: r.label, cod: p.cod || 0,
        grande: p.grande ? 1 : 0, marcado: p.cod && datos.marcados && datos.marcados.includes(p.cod) ? 1 : 0 },
    }));
  });
  // Clientes que quedan fuera del reparto (otro día / localidad que no sale): círculos huecos grises
  const fuera = (datos.fuera || []).map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    properties: { titulo: p.titulo, detalle: p.detalle, cod: p.cod || 0, marcado: p.cod && datos.marcados && datos.marcados.includes(p.cod) ? 1 : 0 } }));
  const etiquetas = (datos.etiquetas || []).filter((e) => datos.soloRuta == null || e.ruta === datos.soloRuta).map((e) => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: [e.lon, e.lat] }, properties: { texto: e.texto, color: e.color } }));
  puntos.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [datos.deposito.lon, datos.deposito.lat] },
    properties: { color: '#111', seq: '⌂', titulo: 'Depósito', detalle: 'Punto de salida', ruta: '' } });

  const poner = () => {
    const sl = map.getSource('sim-lineas'), sp = map.getSource('sim-puntos'), se = map.getSource('sim-etq'), sf = map.getSource('sim-fuera');
    if (sl && sp && se && sf) { sl.setData({ type: 'FeatureCollection', features: lineas });
      sp.setData({ type: 'FeatureCollection', features: puntos }); se.setData({ type: 'FeatureCollection', features: etiquetas });
      sf.setData({ type: 'FeatureCollection', features: fuera }); return; }
    map.addSource('sim-lineas', { type: 'geojson', data: { type: 'FeatureCollection', features: lineas } });
    map.addSource('sim-puntos', { type: 'geojson', data: { type: 'FeatureCollection', features: puntos } });
    map.addSource('sim-etq', { type: 'geojson', data: { type: 'FeatureCollection', features: etiquetas } });
    map.addSource('sim-fuera', { type: 'geojson', data: { type: 'FeatureCollection', features: fuera } });
    map.addLayer({ id: 'sim-lineas', type: 'line', source: 'sim-lineas',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': 2.5, 'line-opacity': 0.75 } });
    map.addLayer({ id: 'sim-fuera', type: 'circle', source: 'sim-fuera',
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 3.5, 14, 8], 'circle-color': 'rgba(255,255,255,0.55)',
        'circle-stroke-color': ['case', ['==', ['get', 'marcado'], 1], '#ff9800', '#78909c'], 'circle-stroke-width': ['case', ['==', ['get', 'marcado'], 1], 3.5, 2] } });
    map.addLayer({ id: 'sim-puntos', type: 'circle', source: 'sim-puntos',
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, ['case', ['==', ['get', 'grande'], 1], 6, 3.5], 14, ['case', ['==', ['get', 'grande'], 1], 12, 8]],
        'circle-color': ['get', 'color'],
        'circle-stroke-color': ['case', ['==', ['get', 'marcado'], 1], '#ff9800', ['==', ['get', 'grande'], 1], '#111', '#fff'],
        'circle-stroke-width': ['case', ['==', ['get', 'marcado'], 1], 4, ['==', ['get', 'grande'], 1], 2.5, 1.5] } });
    map.addLayer({ id: 'sim-etq', type: 'symbol', source: 'sim-etq',
      // Las etiquetas ya no se montan unas sobre otras: si no entran, se esconden (al acercar el zoom aparecen). Y se apagan de cerca, donde mandan los números de parada.
      maxzoom: 13.5,
      layout: { 'text-field': ['get', 'texto'], 'text-size': 12, 'text-font': ['Noto Sans Bold'], 'text-offset': [0, -1.4], 'text-allow-overlap': false, 'text-padding': 6, 'text-optional': true },
      paint: { 'text-color': ['get', 'color'], 'text-halo-color': '#fff', 'text-halo-width': 2 } });
    map.addLayer({ id: 'sim-seq', type: 'symbol', source: 'sim-puntos', minzoom: 13.5,
      layout: { 'text-field': ['to-string', ['get', 'seq']], 'text-size': 10, 'text-font': ['Noto Sans Bold'], 'text-allow-overlap': true },
      paint: { 'text-color': '#fff' } });
    if (map._simHandlers) return;
    map._simHandlers = true;
    map.on('click', 'sim-puntos', (e) => {
      const f = e.features && e.features[0]; if (!f) return;
      const p = f.properties;
      const html = `<div class="sim-pop"><b>${esc(p.titulo)}</b><br>${esc(p.detalle)}${p.ruta ? `<br><span style="color:${esc(p.color)}">● ${esc(p.ruta)}</span>` : ''}${botonesMover(map, p)}</div>`;
      const pop = new maplibregl.Popup({ offset: 10, maxWidth: '320px' }).setLngLat(f.geometry.coordinates).setHTML(html).addTo(map);
      conectarBotones(map, pop, p);
      map._onPunto && map._onPunto(p, !!(e.originalEvent && (e.originalEvent.shiftKey || e.originalEvent.ctrlKey)));
    });
    map.on('click', 'sim-fuera', (e) => {
      const f = e.features && e.features[0]; if (!f) return;
      const p = f.properties;
      const pop = new maplibregl.Popup({ offset: 10, maxWidth: '320px' }).setLngLat(f.geometry.coordinates)
        .setHTML(`<div class="sim-pop"><b>${esc(p.titulo)}</b><br>${esc(p.detalle)}<br><span style="color:#546e7a">○ Fuera del reparto</span>${botonesMover(map, p)}</div>`).addTo(map);
      conectarBotones(map, pop, p);
      map._onPunto && map._onPunto(p, !!(e.originalEvent && (e.originalEvent.shiftKey || e.originalEvent.ctrlKey)));
    });
    ['sim-puntos', 'sim-fuera'].forEach((capa) => {
      map.on('mouseenter', capa, (e) => {
        map.getCanvas().style.cursor = 'pointer';
        if (capa === 'sim-puntos' && map._onHover) map._onHover(e.features && e.features[0] ? e.features[0].properties : null);
      });
      map.on('mouseleave', capa, () => {
        map.getCanvas().style.cursor = '';
        if (capa === 'sim-puntos' && map._onHover) map._onHover(null);
      });
    });
  };
  if (map._estiloOk) poner(); else map.once('style.load', poner);
  return { lineas, puntos };
}

// ── Animación de camiones ───────────────────────────────────────────────────
const rad = Math.PI / 180;
const hav = (a, b) => {
  const dLa = (b[1] - a[1]) * rad, dLo = (b[0] - a[0]) * rad;
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLo / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(x));
};
const acum = (pts) => { const c = [0]; for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + hav(pts[i - 1], pts[i])); return c; };

// Largo (km) de la ruta más larga visible: es la "duración" total de la animación.
export function largoMaximo(datos) {
  let m = 0;
  (datos.rutas || []).forEach((r, i) => {
    if (datos.soloRuta != null && datos.soloRuta !== i) return;
    const line = r.geom && r.geom.length > 1 ? r.geom : [[datos.deposito.lon, datos.deposito.lat], ...r.puntos.map((p) => [p.lon, p.lat])];
    m = Math.max(m, acum(line).slice(-1)[0] || 0);
  });
  return m;
}

// Posición de cada camión tras recorrer `km` km (todos a la misma velocidad) y entregas completadas.
export function posicionesAnim(datos, km) {
  const feats = []; let hechas = 0, total = 0;
  (datos.rutas || []).forEach((r, i) => {
    if (datos.soloRuta != null && datos.soloRuta !== i) return;
    const dep = [datos.deposito.lon, datos.deposito.lat];
    const stops = [dep, ...r.puntos.map((p) => [p.lon, p.lat])];
    const line = r.geom && r.geom.length > 1 ? r.geom : stops;
    const c = acum(line), T = c[c.length - 1] || 0, d = Math.min(km, T);
    let k = 1; while (k < c.length - 1 && c[k] < d) k++;
    const seg = c[k] - c[k - 1] || 1, t = Math.max(0, Math.min(1, (d - c[k - 1]) / seg));
    const a = line[k - 1], b = line[k] || a;
    feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] },
      properties: { color: r.color, n: String(i + 1) } });
    const cs = acum(stops), Ts = cs[cs.length - 1] || 1;
    const fr = T ? d / T : 1;
    total += r.puntos.length;
    for (let s = 1; s < cs.length; s++) if (cs[s] / Ts <= fr + 1e-9) hechas++;
  });
  return { feats, hechas, total };
}

// Camiones como marcadores DOM: se mueven al instante, sin pasar por el worker del mapa.
export function pintarCamiones(map, feats) {
  const lista = feats || [];
  const ms = map._camMarkers || (map._camMarkers = []);
  while (ms.length > lista.length) ms.pop().remove();
  lista.forEach((f, i) => {
    if (!ms[i]) {
      const el = document.createElement('div');
      el.className = 'sim-camion';
      ms[i] = new maplibregl.Marker({ element: el }).setLngLat(f.geometry.coordinates).addTo(map);
    }
    const el = ms[i].getElement();
    el.style.background = f.properties.color; el.textContent = f.properties.n;
    ms[i].setLngLat(f.geometry.coordinates);
  });
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

// ── Resaltar un camión sin volver a dibujar: solo cambia la opacidad (barato, se puede hacer al pasar el mouse) ──
export function resaltarCamion(map, color) {
  if (!map || !map.getLayer || !map.getLayer('sim-puntos') || !map.getLayer('sim-lineas')) return;
  if (color == null) {
    map.setPaintProperty('sim-lineas', 'line-opacity', 0.75);
    map.setPaintProperty('sim-lineas', 'line-width', 2.5);
    map.setPaintProperty('sim-puntos', 'circle-opacity', 1);
    map.setPaintProperty('sim-puntos', 'circle-stroke-opacity', 1);
    return;
  }
  const propio = ['any', ['==', ['get', 'color'], color], ['==', ['get', 'seq'], '⌂']];
  map.setPaintProperty('sim-lineas', 'line-opacity', ['case', ['==', ['get', 'color'], color], 1, 0.1]);
  map.setPaintProperty('sim-lineas', 'line-width', ['case', ['==', ['get', 'color'], color], 5, 1.5]);
  map.setPaintProperty('sim-puntos', 'circle-opacity', ['case', propio, 1, 0.15]);
  map.setPaintProperty('sim-puntos', 'circle-stroke-opacity', ['case', propio, 1, 0.15]);
}

// El mapa avisa qué camión tiene el mouse encima (para resaltar su tarjeta)
export function conectarHover(map, fn) { if (map) map._onHover = fn; }


// ── Entregas reales del mes (pestaña Ejecutivo): un círculo por cliente, tamaño = kg, color = localidad ──
// puntos: [{ lat, lon, kg, color, titulo, detalle }]
export function pintarEntregas(map, puntos) {
  const data = { type: 'FeatureCollection', features: puntos.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    properties: { color: p.color, kg: p.kg, titulo: p.titulo, detalle: p.detalle } })) };
  const poner = () => {
    const src = map.getSource('ent');
    if (src) { src.setData(data); return; }
    map.addSource('ent', { type: 'geojson', data });
    map.addLayer({ id: 'ent-c', type: 'circle', source: 'ent',
      paint: { 'circle-color': ['get', 'color'], 'circle-opacity': 0.78, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1,
        'circle-radius': ['interpolate', ['linear'], ['get', 'kg'], 0, 3.5, 300, 6, 1500, 11, 5000, 18] } });
    if (!map._entClick) {
      map._entClick = true;
      map.on('click', 'ent-c', (e) => {
        const f = e.features && e.features[0]; if (!f) return;
        new maplibregl.Popup({ offset: 8, maxWidth: '260px' }).setLngLat(f.geometry.coordinates)
          .setHTML(`<b>${esc(f.properties.titulo)}</b><br>${esc(f.properties.detalle)}`).addTo(map);
      });
      map.on('mouseenter', 'ent-c', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'ent-c', () => { map.getCanvas().style.cursor = ''; });
    }
  };
  if (map._estiloOk) poner(); else map.once('style.load', poner);
}
export function encuadrarPuntos(map, puntos, deposito) {
  if (!puntos.length) return;
  const b = new maplibregl.LngLatBounds();
  if (deposito) b.extend([deposito.lon, deposito.lat]);
  puntos.forEach((p) => b.extend([p.lon, p.lat]));
  map.fitBounds(b, { padding: 40, duration: 700, maxZoom: 14 });
}
