// simulacion/engine.js — Motor puro (sin React ni red): parseo, cruce y simulación.
// Todo se calcula en el navegador a partir de datos livianos; nada pesado se guarda.

export const PARAMS_DEFAULT = {
  bultosPorPallet: 94.5,   // calibrado con el ruteador (450,91 bultos = 4,77 pallets)
  kgPorBulto: 12.14,       // peso ruta / bultos ruta (5476 kg / 450,91)
  palletsPorCamion: 12,    // capacidad del camión 12CP-12PP
  llenado: 0.9,            // ocupación objetivo
  factorRuta: 1.4,         // km reales = km en línea recta * factor (calibrado con 17 días de historial)
  // Combustible y recargas: valores de la hoja "Parámetros Reparto" de entrega_diaria_v12.xlsx
  consumoCamion: 30,       // L cada 100 km (camión con carga)
  consumoUtil: 12,         // L cada 100 km (utilitario)
  palletsUtil: 3,          // vehículos de hasta este nº de pallets usan el consumo de utilitario
  marca: 'Shell',          // estación usada para el costo de cada camión (se elige en las tarjetas)
  precioDiesel: 2477,      // $/L de la marca elegida
  preciosMarca: { Shell: 2477, Axion: 2544, YPF: 2199 },
  fechasMarca: { Shell: '14/10/26 · Tandil', Axion: '03/10/26 · zona', YPF: '01/07/26 · manual, desactualizado' },
  ayudantesPorCamion: 1,   // personas = chofer + ayudantes (por defecto 2)
  limiteRecarga2: 450,     // con 2 personas: sin recarga hasta estos bultos
  limiteRecarga3: 700,     // con 3 personas
  maxConRecarga: 900,      // más de esto con 1 recarga => alerta de revisión
  zonaTau: 0.35, zonaK: 16, zonaDow: 1.6, zonaRec: 0.03, zonaMeta: 0.02, // ajuste del reparto por zonas de chofer
  siempreDosPersonas: ['LAS FLORES'], // localidades que salen siempre con 2 personas
  minPalletsRuta: 1,       // un camión con menos pallets que esto se intenta sumar a otro
  ahorroMinKm: 15,         // dos camiones se juntan si el recorrido único ahorra al menos esto (y 10 %)
  radioRescateKm: 60,      // ...si hay un camión con lugar a menos de esta distancia
  maxCamiones: 0,          // camiones disponibles hoy (0 = sin tope: arma los que hagan falta)
  camionesPorLoc: {},      // { LOCALIDAD: n } camiones fijados a mano para esa localidad (ej. Las Flores: 2)
  maxParadas: 70,          // tope de paradas por camión (límite de jornada)
  radioAgrupKm: 15,        // solo se juntan localidades a menos de esta distancia en un mismo camión
  deposito: { lat: -37.3140, lon: -59.1515 }, // calculado por trilateración con los radios del ruteador
};

const R = 6371.0088;
const rad = (d) => (d * Math.PI) / 180;

export function haversine(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const serialAISO = (s) =>
  new Date(Date.UTC(1899, 11, 30) + Math.round(Number(s)) * 86400000).toISOString().slice(0, 10);

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const minDia = (v) => (typeof v === 'number' ? Math.round((v % 1) * 1440) : null);

// ── Romaneo ────────────────────────────────────────────────────────────────
// rows: objetos por encabezado (SheetJS sheet_to_json). Devuelve { 'YYYY-MM-DD': dia }
// dia = { fecha, rutas:[{id,veh,chofer,km,bultos,pallets,kg,cap,entregas,ini,fin}],
//         paradas:[[r,seq,codigo,nombre,lat,lon,kg,pallet,kmTramo,llegMin]],
//         resumen:{paradas,bultos,rutas,km} }
export function parseRomaneo(rows) {
  const dias = {};
  for (const r of rows) {
    if (r['Tipo'] !== 'Entrega') continue;
    const lat = num(r['Latitud']), lon = num(r['Longitud']);
    const f = r['Fecha de ruta'];
    if (!f || !lat || !lon) continue;
    const fecha = serialAISO(f);
    const d = dias[fecha] || (dias[fecha] = { fecha, rutas: [], paradas: [], _idx: {} });
    const rid = [r['Número de ruta'], r['Matrícula del vehículo'], r['Conductor'], r['Sesión']].join('|');
    let ri = d._idx[rid];
    if (ri === undefined) {
      ri = d.rutas.length; d._idx[rid] = ri;
      d.rutas.push({
        id: rid, veh: String(r['Matrícula del vehículo'] || r['Transportista'] || ''),
        chofer: String(r['Conductor'] || '').replace(/\uFFFD/g, 'ñ'), km: num(r['Distancia (km)']),
        bultos: num(r['Total de Itens']), pallets: num(r['Capacidad utilizada']),
        kg: num(r['Peso utilizado']), cap: num(r['Capacidad del vehículo']),
        entregas: num(r['Cantidad de entregas']),
        ini: minDia(r['Inicio de ruta']), fin: minDia(r['Fin de ruta']),
      });
    }
    d.paradas.push([ri, num(r['Secuencia de entrega']), Math.round(num(r['Código de cliente'])),
      String(r['Nombre de empresa'] || ''), lat, lon, num(r['Peso']), num(r['Tamaño']),
      num(r['Distancia recorrida (km)']), minDia(r['Llegada'])]);
  }
  for (const d of Object.values(dias)) {
    delete d._idx;
    d.paradas.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    d.resumen = {
      paradas: d.paradas.length, rutas: d.rutas.length,
      bultos: Math.round(d.rutas.reduce((s, x) => s + x.bultos, 0) * 10) / 10,
      km: Math.round(d.rutas.reduce((s, x) => s + x.km, 0) * 10) / 10,
    };
  }
  return dias;
}

// Maestra de clientes (export del sistema): Coord X = longitud, Coord Y = latitud.
// Devuelve filas compactas [codigo, lat, lon, nombre, localidad] solo de clientes con coordenadas válidas.
export function parseMaestra(rows) {
  const out = [];
  for (const r of rows) {
    const c = Math.round(num(r['Cliente'])), lon = num(r['Coord X']), lat = num(r['Coord Y']);
    if (!c || Math.abs(lat) < 1 || Math.abs(lon) < 1) continue;
    out.push([c, Math.round(lat * 1e6) / 1e6, Math.round(lon * 1e6) / 1e6,
      String(r['Razon social'] || '').trim(), String(r['Descripcion localidad'] || '').trim()]);
  }
  return out;
}

// Frecuencia de entrega (hoja "Frecuencia" del ruteador): columnas Cliente, LU..SA con "X".
// Devuelve { codigo: máscara } con bit 1 = lunes … 32 = sábado. Los clientes sin ningún día marcado se omiten (= sin dato).
export function parseFrecuencia(rows) {
  const dias = ['LU', 'MA', 'MI', 'JU', 'VI', 'SA'], out = {};
  for (const r of rows) {
    const c = Math.round(num(r['Cliente'])); if (!c) continue;
    let m = 0; dias.forEach((d, i) => { if (String(r[d] || '').trim().toUpperCase() === 'X') m |= 1 << i; });
    if (m) out[c] = m;
  }
  return out;
}
// Bit del día de la semana de una fecha YYYY-MM-DD (lunes = 1 … sábado = 32; domingo = 0)
export function bitDia(fecha) {
  const d = new Date(`${fecha}T12:00:00`).getDay(); return d === 0 ? 0 : 1 << (d - 1);
}
export const NOMBRES_DIA = ['LU', 'MA', 'MI', 'JU', 'VI', 'SA'];
export const diasDeMascara = (m) => NOMBRES_DIA.filter((_, i) => m & (1 << i)).join(' ');

// Ubicaciones por código: primero la maestra, y encima la última posición real de entrega.
// items: [[c,lat,lon,nombre,localidad]]  ·  dias: salida de parseRomaneo (opcional)
export function construirUbicaciones(items = [], dias = {}) {
  const mapa = new Map();
  for (const [c, lat, lon, n, loc] of items) mapa.set(c, { lat, lon, n, loc });
  Object.keys(dias).sort().forEach((f) => {
    for (const p of dias[f].paradas) {
      const prev = mapa.get(p[2]);
      mapa.set(p[2], { lat: p[4], lon: p[5], n: p[3] || prev?.n || '', loc: prev?.loc || '' });
    }
  });
  // Clientes que no están en la maestra (o sin localidad cargada): se les asigna la localidad de los clientes
  // conocidos más cercanos (mayoría de los 3 más próximos, hasta 8 km). Quedan marcados como "locEstimada".
  const conLoc = [], sin = [];
  for (const [c, u] of mapa) (u.loc ? conLoc : sin).push([c, u]);
  if (conLoc.length && sin.length) {
    const cell = (lat, lon) => `${Math.floor(lat / 0.05)}|${Math.floor(lon / 0.05)}`;
    const grid = new Map();
    for (const [, u] of conLoc) { const k = cell(u.lat, u.lon); (grid.get(k) || grid.set(k, []).get(k)).push(u); }
    for (const [, u] of sin) {
      const cand = [];
      const i0 = Math.floor(u.lat / 0.05), j0 = Math.floor(u.lon / 0.05);
      for (let i = i0 - 2; i <= i0 + 2; i++) for (let j = j0 - 2; j <= j0 + 2; j++) {
        for (const v of grid.get(`${i}|${j}`) || []) cand.push([haversine(u, v), v.loc]);
      }
      cand.sort((a, b) => a[0] - b[0]);
      const cerca = cand.slice(0, 3).filter((x) => x[0] <= 8);
      if (!cerca.length) continue;
      const votos = {}; cerca.forEach(([, l]) => { votos[l] = (votos[l] || 0) + 1; });
      u.loc = Object.entries(votos).sort((a, b) => b[1] - a[1])[0][0]; u.locEstimada = true;
    }
  }
  return mapa;
}

// ── Pedidos ────────────────────────────────────────────────────────────────
// rows: matriz (array de arrays) de la hoja del Excel de pedidos.
export function parsePedidos(matriz) {
  const hi = matriz.findIndex((r) => r && r.some((c) => String(c).trim().toUpperCase().startsWith('SELECC')));
  if (hi < 0) throw new Error('No encontré la columna SELECCIÓN en el archivo de pedidos.');
  const H = matriz[hi].map((c) => String(c).trim().toUpperCase());
  const col = (n) => H.findIndex((h) => h.startsWith(n));
  const iS = col('SELECC'), iP = col('PEDIDOS'), iB = col('BULTOS'), iN = col('NETO');
  const por = new Map();
  for (const r of matriz.slice(hi + 1)) {
    const m = /^\s*0*(\d+)\s+(.+)$/.exec(String(r[iS] ?? ''));
    if (!m) continue;
    const c = parseInt(m[1], 10), b = num(r[iB]);
    if (!c || b <= 0) continue;
    const a = por.get(c) || { c, n: m[2].trim(), b: 0, p: 0, neto: 0 };
    a.b += b; a.p += num(r[iP]) || 1; a.neto += num(r[iN]);
    por.set(c, a);
  }
  const clientes = [...por.values()].map((x) => ({ ...x, b: Math.round(x.b * 100) / 100, neto: Math.round(x.neto) }));
  return { clientes, total: { clientes: clientes.length, bultos: Math.round(clientes.reduce((s, x) => s + x.b, 0) * 10) / 10 } };
}

// ── Rutas ──────────────────────────────────────────────────────────────────
function tourLen(dep, pts) {
  let d = 0, prev = dep;
  for (const p of pts) { d += haversine(prev, p); prev = p; }
  return d + haversine(prev, dep);
}

function ordenarVecinoCercano(dep, pts) {
  const rest = pts.slice(), out = []; let cur = dep;
  while (rest.length) {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < rest.length; i++) { const d = haversine(cur, rest[i]); if (d < bd) { bd = d; bi = i; } }
    cur = rest.splice(bi, 1)[0]; out.push(cur);
  }
  // 2-opt con delta O(1) por candidato (rápido incluso con cientos de paradas)
  const n = out.length;
  if (n >= 3) {
    const pts = [dep, ...out, dep];
    const d = (i, j) => haversine(pts[i], pts[j]);
    let mejor = true, it = 0;
    while (mejor && it++ < 40) {
      mejor = false;
      for (let i = 1; i < n; i++) for (let j = i + 1; j <= n; j++) {
        if (d(i - 1, j) + d(i, j + 1) < d(i - 1, i) + d(j, j + 1) - 1e-9) {
          for (let a = i, b = j; a < b; a++, b--) { const t = pts[a]; pts[a] = pts[b]; pts[b] = t; }
          mejor = true;
        }
      }
    }
    return pts.slice(1, n + 1);
  }
  return out;
}

// Calibra el factor km-reales / km-línea-recta usando rutas reales del historial
export function calibrarFactor(dias, dep = PARAMS_DEFAULT.deposito) {
  const ratios = [];
  for (const d of Object.values(dias)) {
    d.rutas.forEach((ru, ri) => {
      const pts = d.paradas.filter((p) => p[0] === ri).map((p) => ({ lat: p[4], lon: p[5] }));
      if (pts.length < 4 || ru.km <= 0) return;
      const straight = tourLen(dep, pts);
      if (straight > 0) ratios.push(ru.km / straight);
    });
  }
  if (!ratios.length) return PARAMS_DEFAULT.factorRuta;
  ratios.sort((a, b) => a - b);
  return Math.round(ratios[Math.floor(ratios.length / 2)] * 100) / 100;
}

// ── Costo de una ruta (misma regla que la planilla entrega_diaria) ─────────
// Litros = km × consumo ÷ 100 (utilitario si la capacidad del vehículo es ≤ palletsUtil).
// Recarga: 1 por viaje si los bultos superan el límite según las personas (2 → 450, 3 → 700).
export function costearRuta(P, { km, pallets, cap, bultos, localidades = [] }) {
  const util = cap != null && cap <= P.palletsUtil; // solo si se conoce la capacidad del vehículo (romaneo)
  const litros = (km * (util ? P.consumoUtil : P.consumoCamion)) / 100;
  const dos = localidades.some((l) => (P.siempreDosPersonas || []).includes(String(l).toUpperCase()));
  const personas = dos ? 2 : 1 + P.ayudantesPorCamion;
  const limite = personas >= 3 ? P.limiteRecarga3 : P.limiteRecarga2;
  const recargas = bultos > limite ? 1 : 0;
  return { litros, combustible: litros * P.precioDiesel, utilitario: util, personas, limiteRecarga: limite, recargas,
    alertaRecarga: recargas > 0 && bultos > P.maxConRecarga };
}

// Mismo litros con el precio de cada marca (Shell / Axion / YPF) y el usado en el cálculo.
export function comparativaMarcas(litros, P) {
  return Object.entries(P.preciosMarca || {}).map(([marca, precio]) => ({ marca, precio, fecha: (P.fechasMarca || {})[marca] || '', costo: litros * precio }));
}

// Resumen por localidad (como el Dashboard del Excel): km/litros/costo se reparten por bultos dentro de cada ruta.
export function resumenPorLocalidad(rutas) {
  const m = new Map();
  rutas.forEach((r) => {
    const tot = r.paradas.reduce((s, p) => s + p.b, 0) || 1;
    const vistas = new Set();
    r.paradas.forEach((p) => {
      const l = p.loc || 'SIN LOCALIDAD';
      const o = m.get(l) || { loc: l, camiones: 0, clientes: 0, bultos: 0, pallets: 0, km: 0, litros: 0, combustible: 0, recargas: 0 };
      const w = p.b / tot;
      o.clientes += 1; o.bultos += p.b; o.pallets += p.pallets;
      o.km += r.km * w; o.litros += r.litros * w; o.combustible += r.combustible * w;
      if (!vistas.has(l)) { vistas.add(l); o.camiones += 1; }
      m.set(l, o);
    });
    // la recarga se cuenta en la localidad con más bultos del viaje
    if (r.recargas) {
      const por = {}; r.paradas.forEach((p) => { const l = p.loc || 'SIN LOCALIDAD'; por[l] = (por[l] || 0) + p.b; });
      const top = Object.entries(por).sort((a, b) => b[1] - a[1])[0][0];
      m.get(top).recargas += r.recargas;
    }
  });
  return [...m.values()].sort((a, b) => b.bultos - a.bultos);
}

// ── Simulación ─────────────────────────────────────────────────────────────
export function simular(pedidos, ubic, parametros = {}) {
  const P = { ...PARAMS_DEFAULT, ...parametros };
  const dep = P.deposito;
  const conUbic = [], sinUbic = [];
  for (const c of pedidos.clientes) {
    const u = ubic.get(c.c);
    const item = { ...c, pallets: c.b / P.bultosPorPallet, kg: c.b * P.kgPorBulto };
    if (u) conUbic.push({ ...item, lat: u.lat, lon: u.lon, loc: u.loc || '' }); else sinUbic.push(item);
  }
  const totalBultos = pedidos.clientes.reduce((s, c) => s + c.b, 0);
  const totalPallets = totalBultos / P.bultosPorPallet;
  const capUtil = P.palletsPorCamion * P.llenado;
  const nCamiones = Math.max(1, Math.ceil(totalPallets / capUtil));

  // Agrupa por localidad y empaqueta en camiones: solo junta localidades cercanas
  // (radioAgrupKm) y respeta la capacidad. Si una localidad no entra en un camión, la parte por barrido angular.
  const porLoc = new Map();
  for (const c of conUbic) { const k = c.loc || 'SIN LOCALIDAD'; (porLoc.get(k) || porLoc.set(k, []).get(k)).push(c); }
  const unidades = []; const usadosZona = new Set();
  for (const [loc, items] of porLoc) {
    const pal = items.reduce((s, c) => s + c.pallets, 0);
    const fijo = Math.floor(Number((P.camionesPorLoc || {})[String(loc).toUpperCase()]) || 0);
    if (fijo > 0) {
      // Cantidad de camiones elegida a mano: se reparte la localidad en zonas contiguas (sectores alrededor del depósito)
      // con la misma cantidad de bultos y de clientes en cada camión; esos camiones no se mezclan con otras localidades.
      const k = Math.min(fijo, items.length);
      const z = repartirPorZonas(items, k, P, { usados: usadosZona });
      if (z) {
        z.grupos.forEach((g, j) => { usadosZona.add(z.choferes[j]); unidades.push({ loc, items: g, pallets: g.reduce((s, c) => s + c.pallets, 0), fijo: true, chofer: z.choferes[j] }); });
        continue;
      }
      const cub = afinarEquilibrio(repartirEquilibrado(items, k, dep));
      cub.filter((g) => g.length).forEach((g) => unidades.push({ loc, items: g, pallets: g.reduce((s, c) => s + c.pallets, 0), fijo: true }));
      continue;
    }
    if (pal <= capUtil && items.length <= P.maxParadas) { unidades.push({ loc, items, pallets: pal }); continue; }
    const k = Math.max(Math.ceil(pal / capUtil), Math.ceil(items.length / P.maxParadas)), objetivo = pal / k;
    const zAuto = k > 1 ? repartirPorZonas(items, k, P, { usados: usadosZona, capMax: capUtil * 1.03 }) : null;
    if (zAuto) {
      zAuto.grupos.forEach((g, j) => { usadosZona.add(zAuto.choferes[j]); unidades.push({ loc, items: g, pallets: g.reduce((s, c) => s + c.pallets, 0), fijo: true, chofer: zAuto.choferes[j] }); });
      continue;
    }
    // Sin historial de zonas: se parte en k sectores con los bultos y los clientes lo más parejos posible
    afinarEquilibrio(repartirEquilibrado(items, k, dep)).filter((g) => g.length)
      .forEach((g) => unidades.push({ loc, items: g, pallets: g.reduce((s2, c) => s2 + c.pallets, 0) }));
  }
  const centro = (items) => ({
    lat: items.reduce((s, c) => s + c.lat, 0) / items.length,
    lon: items.reduce((s, c) => s + c.lon, 0) / items.length,
  });
  unidades.sort((a, b) => b.pallets - a.pallets);
  const camiones = [];
  for (const u of unidades) {
    const cu = centro(u.items);
    let dest = null, bd = Infinity;
    if (u.fijo) { camiones.push({ items: u.items.slice(), pallets: u.pallets, locs: new Set([u.loc]), fijo: true, chofer: u.chofer || null }); continue; }
    for (const cam of camiones) {
      if (cam.fijo) continue;
      if (cam.pallets + u.pallets > capUtil || cam.items.length + u.items.length > P.maxParadas) continue;
      const d = haversine(centro(cam.items), cu);
      if (d <= P.radioAgrupKm && d < bd) { bd = d; dest = cam; }
    }
    if (dest) { dest.items.push(...u.items); dest.pallets += u.pallets; dest.locs.add(u.loc); }
    else camiones.push({ items: u.items.slice(), pallets: u.pallets, locs: new Set([u.loc]) });
  }
  // Ahorro de km: dos camiones sin zona fija se juntan si un solo recorrido sirve para ambos y es bastante más corto que
  // los dos por separado (típico de localidades lejanas con poca carga, como Juan N. Fernández + La Dulce), siempre que
  // entre en capacidad, en paradas y en la jornada aprendida del historial.
  const tiem = P.tiempos || TIEMPOS_DEFAULT;
  const kmCam = (cam) => (cam._km === undefined || cam._n !== cam.items.length ? ((cam._n = cam.items.length), (cam._km = armarRuta(P, cam.items, 0).km)) : cam._km);
  for (let vuelta = 0; vuelta < 12; vuelta++) {
    let mejor = null;
    for (let i = 0; i < camiones.length; i++) for (let j = i + 1; j < camiones.length; j++) {
      const A = camiones[i], B = camiones[j];
      if (A.fijo || B.fijo) continue;
      if (A.pallets + B.pallets > capUtil || A.items.length + B.items.length > P.maxParadas) continue;
      const juntos = armarRuta(P, A.items.concat(B.items), 0);
      const ahorro = kmCam(A) + kmCam(B) - juntos.km;
      if (ahorro < Math.max(P.ahorroMinKm, 0.1 * (kmCam(A) + kmCam(B)))) continue;
      if (minutosRuta(tiem, { paradas: juntos.paradas.length, km: juntos.km, bultos: juntos.bultos }) > tiem.limite) continue;
      if (!mejor || ahorro > mejor.ahorro) mejor = { i, j, ahorro };
    }
    if (!mejor) break;
    const A = camiones[mejor.i], B = camiones[mejor.j];
    A.items.push(...B.items); A.pallets += B.pallets; B.locs.forEach((l) => A.locs.add(l)); camiones.splice(mejor.j, 1);
  }
  // Rescate: camiones casi vacíos se suman al más cercano que tenga lugar (si no hay, quedan marcados "poca carga")
  for (let i = camiones.length - 1; i >= 0; i--) {
    const c = camiones[i];
    if (camiones.length < 2 || c.pallets >= P.minPalletsRuta || c.fijo) continue;
    const cc = centro(c.items);
    let dest = null, bd = Infinity;
    camiones.forEach((o, j) => {
      if (j === i || o.fijo || o.pallets + c.pallets > capUtil || o.items.length + c.items.length > P.maxParadas) return;
      const d = haversine(centro(o.items), cc);
      if (d <= P.radioRescateKm && d < bd) { bd = d; dest = o; }
    });
    if (dest) { dest.items.push(...c.items); dest.pallets += c.pallets; c.locs.forEach((l) => dest.locs.add(l)); camiones.splice(i, 1); }
  }
  const rutas = camiones.filter((c) => c.items.length).map((c, i) => ({ ...armarRuta(P, c.items, i + 1), choferZona: c.chofer || null }));
  const sum = (k) => rutas.reduce((s, r) => s + r[k], 0);
  return {
    params: P, rutas, sinUbicacion: sinUbic,
    totales: {
      clientes: pedidos.clientes.length, bultos: totalBultos, pallets: totalPallets,
      camiones: rutas.length, camionesNecesarios: nCamiones, km: sum('km'),
      litros: sum('litros'), combustible: sum('combustible'),
      personas: sum('personas'), recargas: sum('recargas'),
    },
  };
}

// Afina un reparto en k grupos para que los bultos y los clientes queden parejos: pasa de a uno el cliente que más
// mejora el equilibrio, siempre que el camión que lo recibe no quede a más de `maxKm` más lejos que el que lo cede.
// Mide el desvío de cada grupo como |parte de bultos − 1/k| + |parte de clientes − 1/k| y baja el peor.
export function afinarEquilibrio(grupos, opciones = {}) {
  const k = grupos.length; if (k < 2) return grupos;
  const maxKm = opciones.maxKm ?? 5, meta = opciones.meta ?? 0.05;
  const g = grupos.map((x) => x.slice());
  const n = g.reduce((s, x) => s + x.length, 0), palTot = g.reduce((s, x) => s + x.reduce((a, c) => a + c.pallets, 0), 0) || 1;
  if (n < k * 2) return grupos;
  const pal = g.map((x) => x.reduce((a, c) => a + c.pallets, 0) / palTot), cnt = g.map((x) => x.length / n);
  const sc = (p, q) => Math.abs(p - 1 / k) + Math.abs(q - 1 / k);
  const dev = () => Math.max(...pal.map((p, j) => sc(p, cnt[j])));
  const cen = (x) => ({ lat: x.reduce((a, c) => a + c.lat, 0) / x.length, lon: x.reduce((a, c) => a + c.lon, 0) / x.length });
  for (let it = 0; it < 500; it++) {
    const cur = dev(); if (cur <= meta) break;
    const ce = g.map((x) => (x.length ? cen(x) : null));
    let mejor = null;
    for (let A = 0; A < k; A++) {
      if (g[A].length < 2) continue;
      for (let i = 0; i < g[A].length; i++) {
        const c = g[A][i], pi = c.pallets / palTot;
        for (let B = 0; B < k; B++) {
          if (B === A || !ce[B]) continue;
          const extra = haversine(c, ce[B]) - haversine(c, ce[A]);
          if (extra > maxKm) continue;
          let v = Math.max(sc(pal[A] - pi, cnt[A] - 1 / n), sc(pal[B] + pi, cnt[B] + 1 / n));
          for (let j = 0; j < k; j++) if (j !== A && j !== B) v = Math.max(v, sc(pal[j], cnt[j]));
          if (v >= cur - 1e-9) continue;
          const puntaje = (cur - v) / (0.5 + Math.max(0, extra));
          if (!mejor || puntaje > mejor.puntaje) mejor = { puntaje, A, i, B, pi };
        }
      }
    }
    if (!mejor) break;
    const [c] = g[mejor.A].splice(mejor.i, 1); g[mejor.B].push(c);
    pal[mejor.A] -= mejor.pi; pal[mejor.B] += mejor.pi; cnt[mejor.A] -= 1 / n; cnt[mejor.B] += 1 / n;
  }
  return g;
}

// Reparte `items` en k sectores contiguos (barrido angular desde el depósito) buscando el punto de corte que deja
// lo más parejo posible tanto los bultos (pallets) como la cantidad de clientes de cada parte.
export function repartirEquilibrado(items, k, dep) {
  const n = items.length;
  if (k <= 1 || n <= 1) return [items.slice()];
  const ang = (c) => Math.atan2(c.lat - dep.lat, c.lon - dep.lon);
  const ord = items.slice().sort((a, b) => ang(a) - ang(b));
  const pal = ord.reduce((s, c) => s + c.pallets, 0) || 1;
  const w = ord.map((c) => 0.5 * (c.pallets / pal) + 0.5 / n);
  let mejor = null; const candidatos = [];
  const paso = Math.max(1, Math.floor(n / 150));
  for (let s0 = 0; s0 < n; s0 += paso) {
    const cub = Array.from({ length: k }, () => []); let acc = 0;
    for (let i = 0; i < n; i++) {
      const c = ord[(s0 + i) % n];
      cub[Math.min(k - 1, Math.floor(((acc + w[(s0 + i) % n] / 2) * k)))].push(c); acc += w[(s0 + i) % n];
    }
    if (cub.some((g) => !g.length)) continue;
    const desv = Math.max(...cub.map((g) => Math.abs(g.reduce((s, c) => s + c.pallets, 0) / pal - 1 / k) + Math.abs(g.length / n - 1 / k)));
    if (!mejor || desv < mejor.desv) mejor = { desv, cub };
    candidatos.push({ desv, cub });
  }
  candidatos.sort((x, y) => x.desv - y.desv); candidatos.length = Math.min(candidatos.length, 6);
  if (!mejor) return [items.slice()];
  // Afinado: pasa o intercambia clientes de frontera entre camiones mientras mejore el equilibrio (sin romper las zonas).
  // Se prueba desde las mejores particiones de arranque y se queda con la más pareja.
  const cen = (g) => ({ lat: g.reduce((s, c) => s + c.lat, 0) / g.length, lon: g.reduce((s, c) => s + c.lon, 0) / g.length });
  const afinar = (ini) => {
    const cub = ini.map((g) => g.slice());
    const P = cub.map((g) => g.reduce((s, c) => s + c.pallets, 0) / pal), N = cub.map((g) => g.length / n);
    const score = (p, q) => Math.abs(p - 1 / k) + Math.abs(q - 1 / k);
    const medida = () => Math.max(...cub.map((_, j) => score(P[j], N[j])));
    let actual = medida();
    for (let it = 0; it < 800; it++) {
      const ds = cub.map((_, j) => (P[j] - 1 / k) + (N[j] - 1 / k));
      const cercanos = (g, hacia, m) => g.map((c) => [haversine(c, hacia), c]).sort((x, y) => x[0] - y[0]).slice(0, m).map((x) => x[1]);
      let mov = null, mejorVal = actual - 1e-9;
      for (let A = 0; A < k; A++) for (let B = 0; B < k; B++) {
        if (B === A || ds[B] >= ds[A] || cub[A].length <= 1) continue;
        const cA = cen(cub[A]), cB = cen(cub[B]);
        const candA = cercanos(cub[A], cB, 14), candB = [null, ...cercanos(cub[B], cA, 10)];
        for (const a of candA) for (const b of candB) {
          const pa = a.pallets / pal, pb = b ? b.pallets / pal : 0, nb = b ? 1 / n : 0;
          const pA = P[A] - pa + pb, nA = N[A] - 1 / n + nb, pB = P[B] + pa - pb, nB = N[B] + 1 / n - nb;
          let v = Math.max(score(pA, nA), score(pB, nB));
          for (let j = 0; j < k; j++) if (j !== A && j !== B) v = Math.max(v, score(P[j], N[j]));
          if (v < mejorVal) { mejorVal = v; mov = { A, B, a, b, pA, nA, pB, nB }; }
        }
      }
      if (!mov) break;
      const { A, B, a, b } = mov;
      cub[A] = cub[A].filter((c) => c !== a); cub[B] = cub[B].concat([a]);
      if (b) { cub[B] = cub[B].filter((c) => c !== b); cub[A] = cub[A].concat([b]); }
      P[A] = mov.pA; N[A] = mov.nA; P[B] = mov.pB; N[B] = mov.nB; actual = mejorVal;
    }
    return { cub, desv: actual };
  };
  let res = null;
  for (const c of candidatos) { const r = afinar(c.cub); if (!res || r.desv < res.desv) res = r; }
  return res.cub;
}

// ── Zonas reales de cada chofer (aprendidas de los romaneos) ──────────────────
const esPropio = (nombre) => !MERCADOS.includes(String(nombre).toUpperCase()) && !/^CAMION /i.test(nombre);
// Todas las paradas de los romaneos cargados: { lat, lon, ch, dow, t } (t = mediodía del día, en ms).
export function construirZonas(dias) {
  const out = [];
  Object.entries(dias || {}).forEach(([f, d]) => {
    const t = Date.parse(`${f}T12:00:00`); const dow = new Date(t).getDay();
    d.rutas.forEach((r, i) => {
      const ch = String(r.chofer || '').trim();
      if (!ch || !esPropio(ch)) return;
      d.paradas.forEach((p) => { if (p[0] === i) out.push({ lat: p[4], lon: p[5], ch, dow, t, f }); });
    });
  });
  return out;
}

// Reparte `items` (clientes de una localidad) en k camiones respetando la zona que cada chofer recorre de verdad:
// 1) elige los k choferes presentes que más reparten por esa zona (más peso los días recientes y el mismo día de la semana),
// 2) cada cliente va al chofer cuyas paradas históricas tiene más cerca,
// 3) si quedó desparejo en bultos/clientes, pasa clientes de frontera al vecino hasta equilibrar sin sacar a nadie de una zona
//    donde ese chofer nunca va.
// Devuelve { grupos, choferes } o null si no hay historial suficiente (se usa entonces el reparto geométrico).
export function repartirPorZonas(items, k, P, opciones = {}) {
  const zonas = P.zonas;
  if (!zonas || !zonas.length || k < 2 || items.length < k) return null;
  const dep = P.deposito, kx = 111.32 * Math.cos(rad(dep.lat)), ky = 110.57;
  const xy = (c) => [(c.lon - dep.lon) * kx, (c.lat - dep.lat) * ky];
  const objetivo = P.fechaObjetivo ? Date.parse(`${P.fechaObjetivo}T12:00:00`) : Date.now();
  const dowT = new Date(objetivo).getDay();
  const aus = new Set(P.ausentes || []);
  const cubierto = {}; Object.entries(P.cubre || {}).forEach(([quien, aQuien]) => { cubierto[aQuien] = quien; });
  const yaUsados = new Set(opciones.usados || []);
  const ef = (ch) => (aus.has(ch) ? (cubierto[ch] && !aus.has(cubierto[ch]) ? cubierto[ch] : null) : ch);
  // paradas históricas anteriores al día a simular, con peso por antigüedad y día de la semana
  const H = [];
  for (const z of zonas) {
    if (z.t >= objetivo) continue;
    const ch = ef(z.ch); if (!ch || yaUsados.has(ch)) continue;
    const edad = (objetivo - z.t) / 86400000;
    const [x, y] = xy(z);
    H.push({ x, y, ch, w: Math.exp(-(P.zonaRec ?? 0.03) * edad) * (z.dow === dowT ? (P.zonaDow ?? 1.6) : 1) });
  }
  if (!H.length) return null;
  const pts = items.map((c) => xy(c));
  // choferes que reparten cerca de estos clientes
  const celda = 0.6, grid = new Map();
  pts.forEach(([x, y]) => { const key = `${Math.floor(x / celda)}|${Math.floor(y / celda)}`; grid.set(key, true); });
  const peso = new Map();
  for (const h of H) {
    const cx = Math.floor(h.x / celda), cy = Math.floor(h.y / celda);
    let cerca = false;
    for (let a = -1; a <= 1 && !cerca; a++) for (let b = -1; b <= 1; b++) if (grid.has(`${cx + a}|${cy + b}`)) { cerca = true; break; }
    if (cerca) peso.set(h.ch, (peso.get(h.ch) || 0) + h.w);
  }
  const cands = [...peso.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map((x) => x[0]);
  if (cands.length < k) return null;
  const idx = new Map(cands.map((c, i) => [c, i]));
  const Hc = H.filter((h) => idx.has(h.ch));
  // probabilidad de que cada cliente sea de cada chofer: sus 12 paradas históricas más cercanas, ponderadas por cercanía
  const n = items.length, KK = P.zonaK ?? 12, TAU = P.zonaTau ?? 0.35;
  const Pm = items.map((_, i) => {
    const [px, py] = pts[i];
    const top = [];
    for (const h of Hc) {
      const d = Math.hypot(h.x - px, h.y - py);
      if (top.length < KK || d < top[top.length - 1].d) {
        top.push({ d, h }); top.sort((a, b) => a.d - b.d); if (top.length > KK) top.pop();
      }
    }
    const v = new Array(k).fill(1e-6);
    top.forEach(({ d, h }) => { v[idx.get(h.ch)] += Math.exp(-d / TAU) * h.w; });
    const s = v.reduce((a, b) => a + b, 0);
    return v.map((x) => x / s);
  });
  let a = Pm.map((v) => v.indexOf(Math.max(...v)));
  // equilibrio: bultos (pallets) y cantidad de clientes parejos entre camiones
  const palTot = items.reduce((s, c) => s + c.pallets, 0) || 1;
  const pal = Array(k).fill(0), cnt = Array(k).fill(0);
  a.forEach((j, i) => { pal[j] += items[i].pallets / palTot; cnt[j] += 1 / n; });
  const sc = (p, q) => Math.abs(p - 1 / k) + Math.abs(q - 1 / k);
  const dev = () => Math.max(...pal.map((p, j) => sc(p, cnt[j])));
  const meta = opciones.meta == null ? (P.zonaMeta ?? 0.10) : opciones.meta;
  for (const minP of [0.05, 0.005, 0]) {
    for (let it = 0; it < 400; it++) {
      const cur = dev(); if (cur <= meta) break;
      let mejor = null;
      for (let i = 0; i < n; i++) {
        const A = a[i], pi = items[i].pallets / palTot;
        for (let B = 0; B < k; B++) {
          if (B === A || Pm[i][B] < minP) continue;
          const pA = pal[A] - pi, qA = cnt[A] - 1 / n, pB = pal[B] + pi, qB = cnt[B] + 1 / n;
          let v = Math.max(sc(pA, qA), sc(pB, qB));
          for (let j = 0; j < k; j++) if (j !== A && j !== B) v = Math.max(v, sc(pal[j], cnt[j]));
          if (v >= cur - 1e-9) continue;
          const puntaje = (cur - v) / (0.02 + Math.max(0, Pm[i][A] - Pm[i][B]));
          if (!mejor || puntaje > mejor.puntaje) mejor = { puntaje, i, A, B, pi };
        }
      }
      if (!mejor) break;
      const { i, A, B, pi } = mejor;
      a[i] = B; pal[A] -= pi; cnt[A] -= 1 / n; pal[B] += pi; cnt[B] += 1 / n;
    }
    if (dev() <= meta) break;
  }
  const grupos = cands.map(() => []); a.forEach((j, i) => grupos[j].push(items[i]));
  if (opciones.capMax) {
    // cada camión tiene que entrar en la capacidad: si no, que decida el reparto geométrico
    if (grupos.some((g) => g.reduce((s, c) => s + c.pallets, 0) > opciones.capMax)) {
      const m = opciones.meta == null ? (P.zonaMeta ?? 0.10) : opciones.meta;
      return m > 0.02 ? repartirPorZonas(items, k, P, { ...opciones, meta: m > 0.05 ? 0.05 : 0.02 }) : null;
    }
  }
  const out = grupos.map((g, j) => ({ items: g, chofer: cands[j] })).filter((x) => x.items.length);
  return { grupos: out.map((x) => x.items), choferes: out.map((x) => x.chofer) };
}

// Arma un camión a partir de sus clientes: orden de visita, km, combustible, personas y recarga.
// ordenCods (opcional): orden de visita fijado a mano; los clientes que no estén en la lista van al final.
export function armarRuta(P, g, n, ordenCods) {
  const dep = P.deposito;
  let ord;
  if (ordenCods && ordenCods.length) {
    const idx = new Map(ordenCods.map((c, i) => [c, i]));
    const fijos = g.filter((c) => idx.has(c.c)).sort((a, b) => idx.get(a.c) - idx.get(b.c));
    const sueltos = g.filter((c) => !idx.has(c.c));
    ord = fijos.concat(sueltos.length ? ordenarVecinoCercano(fijos.length ? fijos[fijos.length - 1] : dep, sueltos) : []);
  } else ord = ordenarVecinoCercano(dep, g);
  const km = tourLen(dep, ord) * P.factorRuta;
  const pallets = g.reduce((s, c) => s + c.pallets, 0);
  const bultos = g.reduce((s, c) => s + c.b, 0);
  const localidades = [...new Set(g.map((c) => c.loc || 'SIN LOCALIDAD'))];
  return {
    n, paradas: ord, localidades, km,
    ...costearRuta(P, { km, pallets, bultos, localidades }),
    pallets, bultos, kg: g.reduce((s, c) => s + c.kg, 0),
    ocupacion: pallets / P.palletsPorCamion,
    pocaCarga: pallets < P.minPalletsRuta,
  };
}

// ── Reparto editado a mano ─────────────────────────────────────────────────
// plan = { camiones: [{ id, cods: [codigoCliente], orden: bool }], pend: [codigoCliente] }
//   orden=true: el orden de cods es el orden de visita elegido a mano · pend: clientes que se dejan para otro día.
export function planDesde(sim) {
  return { camiones: sim.rutas.map((r, i) => ({ id: i + 1, cods: r.paradas.map((p) => p.c), orden: false, chofer: r.choferZona || null })), pend: [] };
}
const planLimpio = (pl) => {
  const enDiv = new Set(); Object.values(pl.division || {}).forEach((ps) => ps.forEach((x) => enDiv.add(x.id)));
  const out = { camiones: pl.camiones.filter((t) => t.cods.length || enDiv.has(t.id)), pend: pl.pend || [] };
  const pend = new Set(out.pend);
  const mot = Object.fromEntries(Object.entries(pl.motivos || {}).filter(([c]) => pend.has(Number(c))));
  if (Object.keys(mot).length) out.motivos = mot;
  const ids = new Set(out.camiones.map((t) => t.id));
  const div = Object.fromEntries(Object.entries(pl.division || {}).map(([c, ps]) => [c, ps.filter((x) => ids.has(x.id))]).filter(([, ps]) => ps.length >= 2));
  if (Object.keys(div).length) out.division = div;
  return out;
};
// Motivos de no ruteo (los mismos que usa Way Route en "Lista no ruteados")
export const MOTIVOS = ['Geo incorrecta', 'Fuera de ruta', 'Comercial', 'Bajo drop', 'Exceso SLA', 'Vta depósito', 'Jornada reducida', 'Posdateo logístico'];
export const planMotivo = (plan, cods, motivo) => {
  const pend = new Set(plan.pend || []);
  const motivos = { ...(plan.motivos || {}) };
  cods.forEach((c) => { if (!pend.has(c)) return; if (motivo) motivos[c] = motivo; else delete motivos[c]; });
  const out = { ...plan }; if (Object.keys(motivos).length) out.motivos = motivos; else delete out.motivos;
  return out;
};
// División de carga: el cliente `cod` se entrega entre varios camiones. partes: [{ id: camión, b: bultos }] (al menos 2).
export function planDividir(plan, cod, partes) {
  const ps = (partes || []).filter((x) => x && x.b > 0 && plan.camiones.some((t) => t.id === x.id));
  if (ps.length < 2) return plan;
  return planLimpio({ ...plan, camiones: plan.camiones.map((t) => ({ ...t, cods: t.cods.filter((c) => c !== cod) })),
    pend: (plan.pend || []).filter((c) => c !== cod), division: { ...(plan.division || {}), [cod]: ps } });
}
export const planUnir = (plan, cod, id) => {
  const division = { ...(plan.division || {}) }; delete division[cod];
  const base = { ...plan, division };
  return planMover(base, [cod], id);
};
// destino: id de camión · 'nuevo' (camión nuevo) · 'pend' (otro día)
export function planMover(plan, cods, destino) {
  const s = new Set(cods);
  if (!s.size) return plan;
  if (typeof destino === 'number' && !plan.camiones.some((t) => t.id === destino)) return plan;
  const camiones = plan.camiones.map((t) => ({ ...t, cods: t.cods.filter((c) => !s.has(c)), orden: t.cods.some((c) => s.has(c)) ? false : t.orden }));
  let pend = (plan.pend || []).filter((c) => !s.has(c));
  const motivos = { ...(plan.motivos || {}) }; s.forEach((c) => delete motivos[c]);
  const division = { ...(plan.division || {}) }; s.forEach((c) => delete division[c]);
  plan = { ...plan, motivos, division };
  if (destino === 'pend') pend = pend.concat([...s]);
  else if (destino === 'nuevo') camiones.push({ id: Math.max(0, ...plan.camiones.map((t) => t.id)) + 1, cods: [...s], orden: false });
  else { const t = camiones.find((x) => x.id === destino); t.cods = t.cods.concat([...s]); t.orden = false; }
  return planLimpio({ camiones, pend, motivos, division });
}
export const planJuntar = (plan, desde, hacia) => {
  const t = plan.camiones.find((x) => x.id === desde);
  return t ? planMover(plan, t.cods, hacia) : plan;
};
// Parte un camión en dos por barrido angular desde el depósito (mitad de pallets cada uno).
export function planPartir(plan, id, ruta, dep) {
  if (!ruta || ruta.paradas.length < 2) return plan;
  const ang = (c) => Math.atan2(c.lat - dep.lat, c.lon - dep.lon);
  const ord = ruta.paradas.slice().sort((a, b) => ang(a) - ang(b));
  const mitad = ruta.pallets / 2; let acc = 0; const resto = [];
  for (const c of ord) { if (acc >= mitad) resto.push(c.c); acc += c.pallets; }
  return resto.length ? planMover(plan, resto, 'nuevo') : plan;
}
export const planOrdenar = (plan, id, cods) => ({ ...plan, camiones: plan.camiones.map((t) => (t.id === id ? { ...t, cods, orden: true } : t)) });
export const planOrdenAuto = (plan, id) => ({ ...plan, camiones: plan.camiones.map((t) => (t.id === id ? { ...t, orden: false } : t)) });

// Aplica el plan editado sobre la propuesta automática `sim` (que aporta los clientes con su ubicación y carga).
// Clientes nuevos (que entraron con otra carga de pedidos) se suman al camión más cercano; los que ya no están se descartan.
export function aplicarPlan(sim, plan, parametros = {}) {
  const P = { ...PARAMS_DEFAULT, ...parametros };
  const por = new Map();
  sim.rutas.forEach((r) => r.paradas.forEach((p) => por.set(p.c, p)));
  const pend = new Set((plan.pend || []).filter((c) => por.has(c)));
  const usados = new Set(); const grupos = [];
  const div = Object.entries(plan.division || {}).filter(([c, ps]) => por.has(Number(c)) && !pend.has(Number(c)) && ps.length >= 2);
  div.forEach(([c]) => usados.add(Number(c)));
  for (const t of plan.camiones || []) {
    const g = [], ord = [];
    (t.cods || []).forEach((c) => { const p = por.get(c); if (p && !pend.has(c) && !usados.has(c)) { g.push(p); ord.push(c); usados.add(c); } });
    grupos.push({ id: t.id, g, ord: t.orden ? ord : null, chofer: t.chofer || null });
  }
  // Clientes divididos: cada camión lleva una parte (bultos, pallets y kg proporcionales)
  const divididos = [];
  for (const [cs, ps] of div) {
    const p = por.get(Number(cs)); const tot = ps.reduce((s, x) => s + x.b, 0) || 1;
    for (const x of ps) {
      const gr = grupos.find((q) => q.id === x.id); if (!gr) continue;
      const f = x.b / tot;
      gr.g.push({ ...p, b: p.b * f, pallets: p.pallets * f, kg: p.kg * f, parte: true });
    }
    divididos.push({ c: p.c, n: p.n, b: p.b, partes: ps.map((x) => ({ id: x.id, b: Math.round((p.b * x.b) / tot * 10) / 10 })) });
  }
  const nuevos = [...por.values()].filter((p) => !usados.has(p.c) && !pend.has(p.c));
  const cen = (g) => ({ lat: g.reduce((s, c) => s + c.lat, 0) / g.length, lon: g.reduce((s, c) => s + c.lon, 0) / g.length });
  const centros = grupos.map((x) => (x.g.length ? cen(x.g) : null));
  for (const p of nuevos) {
    let bi = -1, bd = Infinity;
    centros.forEach((c, i) => { if (c) { const d = haversine(c, p); if (d < bd) { bd = d; bi = i; } } });
    if (bi < 0) { grupos.push({ id: Math.max(0, ...grupos.map((x) => x.id)) + 1, g: [p], ord: null }); centros.push(cen([p])); }
    else grupos[bi].g.push(p);
  }
  const rutas = grupos.filter((x) => x.g.length).map((x, i) => ({ ...armarRuta(P, x.g, i + 1, x.ord), planId: x.id, ordenManual: !!x.ord, choferZona: x.chofer }));
  const sum = (k) => rutas.reduce((s, r) => s + r[k], 0);
  const pendientes = [...pend].map((c) => por.get(c));
  const max = Math.floor(P.maxCamiones || 0);
  return {
    params: P, rutas, sinUbicacion: sim.sinUbicacion, editado: true, agregados: nuevos.length, divididos,
    pendEdit: { clientes: pendientes, bultos: pendientes.reduce((s, c) => s + c.b, 0) },
    tope: { max, necesarios: sim.tope ? sim.tope.necesarios : rutas.length, ajuste: null, faltan: max > 0 ? Math.max(0, rutas.length - max) : 0, pendientes: [] },
    totales: {
      clientes: por.size - pend.size, bultos: sum('bultos'), pallets: sum('pallets'),
      camiones: rutas.length, camionesNecesarios: sim.totales.camionesNecesarios, km: sum('km'),
      litros: sum('litros'), combustible: sum('combustible'), personas: sum('personas'), recargas: sum('recargas'),
    },
  };
}

// Simula respetando el tope de camiones disponibles (P.maxCamiones). Si hacen falta más, prueba
// cargar más cada camión y juntar zonas más lejanas; si ni así entra, informa cuánto falta.
export function simularConTope(pedidos, ubic, parametros = {}) {
  const P = { ...PARAMS_DEFAULT, ...parametros };
  let sim = simular(pedidos, ubic, P);
  const max = Math.floor(P.maxCamiones || 0);
  sim.tope = { max, necesarios: sim.rutas.length, ajuste: null, faltan: 0, pendientes: [] };
  if (!(max > 0) || sim.rutas.length <= max) return sim;
  const pasos = [
    { llenado: Math.max(P.llenado, 0.95), radioAgrupKm: Math.max(P.radioAgrupKm, 30), txt: 'cargando cada camión al 95 % y juntando zonas de hasta 30 km' },
    { llenado: 1, radioAgrupKm: Math.max(P.radioAgrupKm, 45), radioRescateKm: Math.max(P.radioRescateKm, 90), txt: 'cargando los camiones al 100 % y juntando zonas de hasta 45 km' },
    { llenado: 1, radioAgrupKm: 90, radioRescateKm: 150, maxParadas: Math.max(P.maxParadas, 90), txt: 'al límite: 100 % de carga, zonas lejanas juntas y más paradas por camión' },
  ];
  let mejor = sim;
  for (const p of pasos) {
    const { txt, ...cambios } = p;
    const s = simular(pedidos, ubic, { ...P, ...cambios });
    s.tope = { max, necesarios: sim.tope.necesarios, ajuste: txt, faltan: Math.max(0, s.rutas.length - max), pendientes: [] };
    if (s.rutas.length < mejor.rutas.length) mejor = s;
    if (s.rutas.length <= max) return s;
  }
  // No entra: se dejan los `max` camiones más cargados y el resto queda como pendiente para otro día / otro viaje.
  const orden = mejor.rutas.map((r, i) => i).sort((a, b) => mejor.rutas[b].pallets - mejor.rutas[a].pallets);
  const quedan = new Set(orden.slice(0, max));
  const sacadas = mejor.rutas.filter((_, i) => !quedan.has(i));
  mejor.tope.pendientes = sacadas.map((r) => ({ localidades: r.localidades, paradas: r.paradas.length, bultos: r.bultos, pallets: r.pallets }));
  return mejor;
}

// ── Cambios entre dos cargas de pedidos ────────────────────────────────────
// anterior: [[codigo, bultos, nombre]] · actual: [{c, n, b}] · ubic: Map (para la localidad)
export function diffPedidos(anterior, actual, ubic) {
  const A = new Map((anterior || []).map(([c, b, n]) => [c, { c, b, n }]));
  const B = new Map(actual.map((x) => [x.c, x]));
  const loc = (c) => ubic.get(c)?.loc || 'Sin localidad';
  const cuenta = (lista) => lista.reduce((o, x) => { const l = loc(x.c); o[l] = (o[l] || 0) + 1; return o; }, {});
  const salen = [...A.values()].filter((x) => !B.has(x.c));
  const entran = actual.filter((x) => !A.has(x.c));
  const cambian = actual.filter((x) => A.has(x.c) && Math.abs(A.get(x.c).b - x.b) > 0.01)
    .map((x) => ({ c: x.c, n: x.n, antes: A.get(x.c).b, ahora: x.b }));
  return {
    salen: salen.length, entran: entran.length, cambian: cambian.length,
    salenPorLoc: cuenta(salen), entranPorLoc: cuenta(entran),
    bultosAntes: [...A.values()].reduce((s, x) => s + x.b, 0), bultosAhora: actual.reduce((s, x) => s + x.b, 0),
  };
}

// ── Rechazos reales (filas de la tabla de rechazos de la app) ────────────────
// Devuelve Map codigo → { b: bultos, r: bultos rechazados }
export function indexarRechazos(filas) {
  const m = new Map();
  for (const f of filas || []) {
    const c = parseInt(String(f.clienteId ?? '').replace(/\D/g, ''), 10);
    if (!c) continue;
    const a = m.get(c) || { b: 0, r: 0 };
    a.b += num(f.bultos); a.r += num(f.bultosRechazados);
    m.set(c, a);
  }
  return m;
}

// Cruza un día de romaneo con los rechazos: por ruta, cómo salió realmente (bultos facturados y rechazados)
export function cruzarRechazos(dia, idx) {
  const rutas = dia.rutas.map(() => ({ b: 0, r: 0, clientes: 0, conRechazo: 0 }));
  const tot = { b: 0, r: 0, clientes: 0, conRechazo: 0 };
  for (const p of dia.paradas) {
    const a = idx.get(p[2]); if (!a) continue;
    const x = rutas[p[0]];
    for (const t of [x, tot]) { t.b += a.b; t.r += a.r; t.clientes++; if (a.r > 0) t.conRechazo++; }
  }
  return { rutas, total: tot };
}

// Pedidos que ya no están en la lista (se ruteó): base = [[c,b,n]] primera carga del día
// dia = romaneo del día de entrega (opcional) · idxRech = indexarRechazos(...) (opcional)
export function resumenRuteados(base, actual, ubic, dia, idxRech) {
  if (!base) return null;
  const vivos = new Set(actual.map((x) => x.c));
  const lista = base.filter(([c]) => !vivos.has(c)).map(([c, b, n]) => ({ c, b, n, loc: ubic.get(c)?.loc || 'Sin localidad' }));
  if (!lista.length) return null;
  const porLoc = {};
  lista.forEach((x) => { const o = porLoc[x.loc] || (porLoc[x.loc] = { clientes: 0, bultos: 0 }); o.clientes++; o.bultos += x.b; });
  let porRuta = null, sinRuta = 0;
  if (dia) {
    const ruta = new Map(dia.paradas.map((p) => [p[2], p[0]]));
    porRuta = new Map();
    for (const x of lista) {
      const ri = ruta.get(x.c);
      if (ri === undefined) { sinRuta++; continue; }
      const o = porRuta.get(ri) || { ri, clientes: 0, bultos: 0, real: 0, rech: 0, conReal: 0 };
      o.clientes++; o.bultos += x.b;
      const a = idxRech && idxRech.get(x.c); if (a) { o.real += a.b; o.rech += a.r; o.conReal++; }
      porRuta.set(ri, o);
    }
  }
  return {
    clientes: lista.length, bultos: lista.reduce((s, x) => s + x.b, 0), porLoc,
    porRuta: porRuta ? [...porRuta.values()].sort((a, b) => a.ri - b.ri) : null, sinRuta,
  };
}

// ── Choferes y zonas ───────────────────────────────────────────────────────
// Zona del día según la planilla (hoja "Zonas"): lun y jue Azul · mar y vie Verde · mié y sáb Amarillo.
const ZONA_SEMANA = { 1: 'Azul', 2: 'Verde', 3: 'Amarillo', 4: 'Azul', 5: 'Verde', 6: 'Amarillo' };
export const zonaDelDia = (fechaISO) => ZONA_SEMANA[new Date(`${fechaISO}T12:00:00`).getDay()] || '';

// "Choferes" que en realidad son un cliente/mercado con ruta propia: no se reasignan.
const MERCADOS = ['VEA', 'PANAMA', 'DEL VALLE', '9 DE JULIO', 'COOPERATIVA'];

const dirTexto = (dep, c) => {
  const dN = (c.lat - dep.lat) * 111, dE = (c.lon - dep.lon) * 111 * Math.cos(rad(dep.lat));
  if (Math.hypot(dN, dE) < 1.5) return 'centro';
  const ang = (Math.atan2(dN, dE) * 180) / Math.PI;           // 0°=este, 90°=norte
  const pts = ['este', 'noreste', 'norte', 'noroeste', 'oeste', 'suroeste', 'sur', 'sureste'];
  return pts[Math.round(((ang + 360) % 360) / 45) % 8];
};

// Zona habitual de cada chofer, aprendida de los romaneos ya cargados.
// Si hay días de la misma zona-color que el día a simular, se usan esos primero (cada chofer rota por zona según el día).
export function perfilesChoferes(dias, ubic, dep, fechaObjetivo) {
  const objetivo = fechaObjetivo ? zonaDelDia(fechaObjetivo) : '';
  const acc = new Map();
  Object.entries(dias).forEach(([f, d]) => {
    const zona = zonaDelDia(f);
    d.rutas.forEach((r, i) => {
      const nombre = String(r.chofer || '').trim(); if (!nombre) return;
      const pts = d.paradas.filter((p) => p[0] === i); if (!pts.length) return;
      const o = acc.get(nombre) || { nombre, dias: 0, ultimo: '', zonas: {}, locs: {} };
      o.dias++; if (f > o.ultimo) o.ultimo = f;
      const z = o.zonas[zona] || (o.zonas[zona] = { n: 0, lat: 0, lon: 0, dias: 0 }); z.dias++;
      pts.forEach((p) => {
        z.n++; z.lat += p[4]; z.lon += p[5];
        const l = (ubic.get(p[2]) || {}).loc || 'SIN LOCALIDAD'; o.locs[l] = (o.locs[l] || 0) + 1;
      });
      acc.set(nombre, o);
    });
  });
  return [...acc.values()].map((o) => {
    const mismaZona = objetivo && o.zonas[objetivo] && o.zonas[objetivo].n ? o.zonas[objetivo] : null;
    const base = mismaZona || Object.values(o.zonas).reduce((t, z) => ({ n: t.n + z.n, lat: t.lat + z.lat, lon: t.lon + z.lon, dias: t.dias + z.dias }), { n: 0, lat: 0, lon: 0, dias: 0 });
    const centro = { lat: base.lat / base.n, lon: base.lon / base.n };
    const loc = Object.entries(o.locs).sort((a, b) => b[1] - a[1])[0][0];
    const etiqueta = loc === 'TANDIL' ? `Tandil · ${dirTexto(dep, centro)}` : loc;
    return { nombre: o.nombre, dias: o.dias, ultimo: o.ultimo, centro, locPrincipal: loc, etiqueta, deZonaDelDia: !!mismaZona,
      mercado: MERCADOS.includes(o.nombre.toUpperCase()) || /^CAMION /i.test(o.nombre) };  // mercados y camiones de terceros no son choferes propios
  }).sort((a, b) => b.dias - a.dias);
}

// Asigna un chofer a cada ruta simulada: el presente cuya zona habitual queda más cerca de la ruta.
// - ausentes: choferes que no vinieron (no se asignan).
// - cubre: { choferQueCubre: choferCuyaZonaCubre } — el que cubre toma la zona del otro (p. ej. Nicolás cubre la de Diego).
// Devuelve un array (uno por ruta) con { chofer, motivo } o { chofer: null }.
export function asignarChoferes(rutas, perfiles, ausentes = [], cubre = {}) {
  const aus = new Set(ausentes);
  const porNombre = new Map(perfiles.map((p) => [p.nombre, p]));
  const centroRuta = (r) => ({ lat: r.paradas.reduce((s, p) => s + p.lat, 0) / r.paradas.length, lon: r.paradas.reduce((s, p) => s + p.lon, 0) / r.paradas.length });
  const cands = perfiles.filter((p) => !aus.has(p.nombre) && !p.mercado && p.centro).map((p) => {
    const cub = cubre[p.nombre] && porNombre.get(cubre[p.nombre]);
    if (cub && !cub.centro) return { nombre: p.nombre, centro: p.centro, cubre: null };
    return { nombre: p.nombre, centro: cub ? cub.centro : p.centro, cubre: cub ? cub.nombre : null };
  });
  const cr = rutas.map(centroRuta);
  const pares = [];
  rutas.forEach((_, i) => cands.forEach((c) => pares.push({ i, c, d: haversine(cr[i], c.centro) - (c.cubre ? 1000 : 0) })));
  pares.sort((a, b) => a.d - b.d);              // los que cubren una zona ajena van primero
  const out = rutas.map(() => ({ chofer: null, motivo: '' })); const usados = new Set();
  for (const p of pares) {
    if (out[p.i].chofer || usados.has(p.c.nombre)) continue;
    out[p.i] = { chofer: p.c.nombre, motivo: p.c.cubre ? `cubre la zona de ${p.c.cubre}` : 'zona habitual' };
    usados.add(p.c.nombre);
  }
  return out;
}

// ── Prueba del motor contra un día real ────────────────────────────────────
// Índice de Rand ajustado entre dos agrupamientos (1 = idénticos, 0 = como al azar).
function indiceRand(a, b) {
  const n = a.length; if (n < 2) return 0;
  const c2 = (x) => (x * (x - 1)) / 2;
  const tab = new Map(), ra = new Map(), rb = new Map();
  for (let i = 0; i < n; i++) {
    const k = `${a[i]}|${b[i]}`;
    tab.set(k, (tab.get(k) || 0) + 1); ra.set(a[i], (ra.get(a[i]) || 0) + 1); rb.set(b[i], (rb.get(b[i]) || 0) + 1);
  }
  let sT = 0, sA = 0, sB = 0;
  tab.forEach((v) => { sT += c2(v); }); ra.forEach((v) => { sA += c2(v); }); rb.forEach((v) => { sB += c2(v); });
  const esp = (sA * sB) / c2(n), max = (sA + sB) / 2;
  return max === esp ? 1 : (sT - esp) / (max - esp);
}

// Rutas "aparte": mercados, camiones de terceros y salidas de 1-2 paradas (clientes grandes que se llevan por separado).
export const rutaAparte = (r, nParadas) => !esPropio(r.chofer) || nParadas <= 2;
// Códigos de cliente que fueron en una ruta normal (propia, con varias paradas) en ese romaneo.
export function clientesEnRutaPropia(dia) {
  const out = new Set();
  (dia.rutas || []).forEach((r, ri) => {
    const pts = dia.paradas.filter((p) => p[0] === ri);
    if (!rutaAparte(r, pts.length)) pts.forEach((p) => out.add(p[2]));
  });
  return out;
}

// Rearma los "pedidos" de un día ya repartido (los bultos de cada ruta se reparten entre sus paradas según el peso),
// corre el motor SIN mirar ese día en el historial y compara con lo que el ruteador hizo de verdad.
export function probarContraDia(fecha, dia, hist, ubicItems, parametros = {}) {
  if (!dia || !dia.rutas || !dia.rutas.length) throw new Error('El día no tiene rutas.');
  const P = { ...PARAMS_DEFAULT, ...parametros };
  const histSin = { ...(hist || {}) }; delete histSin[fecha];
  const ubic = construirUbicaciones(ubicItems || [], { ...histSin, [fecha]: dia });
  const por = new Map(); const rutaReal = new Map();
  const aparte = [];
  dia.rutas.forEach((r, ri) => {
    const pts = dia.paradas.filter((p) => p[0] === ri); if (!pts.length) return;
    if (rutaAparte(r, pts.length)) { pts.forEach((p) => aparte.push({ c: p[2], n: p[3], b: (r.bultos || 0) / pts.length, chofer: r.chofer })); return; }
    const kg = pts.reduce((s, p) => s + (p[6] || 0), 0);
    pts.forEach((p) => {
      const b = (r.bultos || 0) * (kg > 0 ? (p[6] || 0) / kg : 1 / pts.length);
      const a = por.get(p[2]) || { c: p[2], n: p[3], b: 0, p: 1, neto: 0 }; a.b += b; por.set(p[2], a);
      if (!rutaReal.has(p[2])) rutaReal.set(p[2], ri);
    });
  });
  const clientes = [...por.values()].filter((x) => x.b > 0).map((x) => ({ ...x, b: Math.round(x.b * 100) / 100 }));
  const sim = simularConTope({ clientes }, ubic, { ...P, camionesPorLoc: {}, maxCamiones: 0, zonas: construirZonas(histSin), fechaObjetivo: fecha, ausentes: [], cubre: {}, tiempos: ajustarTiempos(histSin) });
  const perfiles = perfilesChoferes(histSin, ubic, P.deposito, fecha);
  const auto = asignarChoferes(sim.rutas, perfiles, [], {});
  const choferSim = sim.rutas.map((r, i) => r.choferZona || (auto[i] && auto[i].chofer) || '');
  const rutaSim = new Map(); sim.rutas.forEach((r, i) => r.paradas.forEach((p) => rutaSim.set(p.c, i)));
  const propias = dia.rutas.map((r, ri) => ri).filter((ri) => { const n = dia.paradas.filter((p) => p[0] === ri).length; return n && !rutaAparte(dia.rutas[ri], n); });
  const comunes = [...rutaReal.keys()].filter((c) => rutaSim.has(c));
  const norm = (x) => String(x || '').trim().toUpperCase();
  let mismoChofer = 0, bultosComunes = 0, bultosMismo = 0;
  comunes.forEach((c) => {
    const b = por.get(c).b; bultosComunes += b;
    if (norm(choferSim[rutaSim.get(c)]) && norm(choferSim[rutaSim.get(c)]) === norm(dia.rutas[rutaReal.get(c)].chofer)) { mismoChofer++; bultosMismo += b; }
  });
  const porRuta = dia.rutas.map((r, ri) => {
    const cl = comunes.filter((c) => rutaReal.get(c) === ri); if (!cl.length) return null;
    const cuenta = new Map(); cl.forEach((c) => cuenta.set(rutaSim.get(c), (cuenta.get(rutaSim.get(c)) || 0) + 1));
    const [mejor, n] = [...cuenta.entries()].sort((a, b) => b[1] - a[1])[0];
    return { ri, chofer: r.chofer, clientes: cl.length, juntos: n / cl.length, camionSim: sim.rutas[mejor].n, choferSim: choferSim[mejor] };
  }).filter(Boolean);
  const tmod = ajustarTiempos(histSin);
  const errs = propias.filter((ri) => dia.rutas[ri].ini && dia.rutas[ri].fin > dia.rutas[ri].ini).map((ri) => Math.abs(minutosRuta(tmod, { paradas: dia.paradas.filter((p) => p[0] === ri).length, km: dia.rutas[ri].km || 0, bultos: dia.rutas[ri].bultos || 0 }) - (dia.rutas[ri].fin - dia.rutas[ri].ini)));
  const kmReal = propias.reduce((s, ri) => s + (dia.rutas[ri].km || 0), 0);
  return {
    fecha, clientes: clientes.length, comunes: comunes.length,
    aparte: { clientes: aparte.length, bultos: aparte.reduce((s, x) => s + x.b, 0), lista: aparte.sort((a, b) => b.b - a.b).slice(0, 12) },
    real: { camiones: propias.length, km: kmReal, bultos: propias.reduce((s, ri) => s + (dia.rutas[ri].bultos || 0), 0), total: dia.rutas.length },
    motor: { camiones: sim.rutas.length, km: sim.totales.km, bultos: sim.totales.bultos, combustible: sim.totales.combustible },
    agrupamiento: indiceRand(comunes.map((c) => rutaReal.get(c)), comunes.map((c) => rutaSim.get(c))),
    choferClientes: comunes.length ? mismoChofer / comunes.length : 0,
    choferBultos: bultosComunes ? bultosMismo / bultosComunes : 0,
    tiempos: { errMin: errs.length ? errs.reduce((x, y) => x + y, 0) / errs.length : null, rutas: errs.length, ajustado: tmod.ajustado },
    porRuta,
  };
}

// ── Tiempos de jornada aprendidos del historial ────────────────────────────
// Modelo: minutos = base + porParada·paradas + porKm·km + porBulto·bultos, ajustado por mínimos cuadrados con las
// rutas propias reales (más de 2 paradas). Si hay pocas rutas se usan los valores típicos de Beer Tan.
export const TIEMPOS_DEFAULT = { base: 31, porParada: 7.6, porKm: 0.78, porBulto: 0.05, limite: 600, mae: null, n: 0, ajustado: false };
export function ajustarTiempos(dias) {
  const X = [], Y = [];
  Object.values(dias || {}).forEach((d) => (d.rutas || []).forEach((r, ri) => {
    const n = d.paradas.filter((p) => p[0] === ri).length;
    if (rutaAparte(r, n) || !r.ini || !r.fin || r.fin <= r.ini) return;
    X.push([1, n, r.km || 0, r.bultos || 0]); Y.push(r.fin - r.ini);
  }));
  if (X.length < 12) return { ...TIEMPOS_DEFAULT, n: X.length };
  // ecuaciones normales con un poco de regularización (ridge) para que no queden coeficientes absurdos
  const k = 4, A = Array.from({ length: k }, () => new Array(k + 1).fill(0));
  X.forEach((x, i) => { for (let a = 0; a < k; a++) { for (let b = 0; b < k; b++) A[a][b] += x[a] * x[b]; A[a][k] += x[a] * Y[i]; } });
  for (let a = 1; a < k; a++) A[a][a] += 1e-3 * A[a][a];
  for (let c = 0; c < k; c++) {
    let p = c; for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    if (Math.abs(A[c][c]) < 1e-12) return { ...TIEMPOS_DEFAULT, n: X.length };
    for (let r = 0; r < k; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let j = c; j <= k; j++) A[r][j] -= f * A[c][j]; }
  }
  const co = A.map((row, i) => row[k] / row[i]).map((v, i) => (i === 0 ? v : Math.max(0, v)));
  const m = { base: co[0], porParada: co[1], porKm: co[2], porBulto: co[3] };
  const err = X.map((x, i) => Math.abs(m.base + m.porParada * x[1] + m.porKm * x[2] + m.porBulto * x[3] - Y[i]));
  const ord = Y.slice().sort((a, b) => a - b);
  return { ...m, limite: Math.max(480, Math.round(ord[Math.floor(ord.length * 0.9)] || 600)), mae: err.reduce((a, b) => a + b, 0) / err.length, n: X.length, ajustado: true };
}
export const minutosRuta = (m, { paradas, km, bultos }) => m.base + m.porParada * paradas + m.porKm * km + m.porBulto * bultos;
