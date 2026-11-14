// simulacion/engine.js — Motor puro (sin React ni red): parseo, cruce y simulación.
// Todo se calcula en el navegador a partir de datos livianos; nada pesado se guarda.

export const PARAMS_DEFAULT = {
  bultosPorPallet: 94.5,   // calibrado con el ruteador (450,91 bultos = 4,77 pallets)
  kgPorBulto: 12.14,       // peso ruta / bultos ruta (5476 kg / 450,91)
  palletsPorCamion: 12,    // capacidad del camión 12CP-12PP
  llenado: 0.9,            // ocupación objetivo
  factorRuta: 1.4,         // km reales = km en línea recta * factor (calibrado con 17 días de historial)
  consumoLKm: 0.35,        // litros de gasoil por km (ajustable)
  precioDiesel: 2500,      // $/litro (ajustable; luego se conecta a Sec. de Energía)
  ayudantesPorCamion: 2,
  minPalletsRuta: 1,       // un camión con menos pallets que esto se intenta sumar a otro
  radioRescateKm: 60,      // ...si hay un camión con lugar a menos de esta distancia
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
        chofer: String(r['Conductor'] || ''), km: num(r['Distancia (km)']),
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
    rest.forEach((p, i) => { const d = haversine(cur, p); if (d < bd) { bd = d; bi = i; } });
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
  const unidades = [];
  for (const [loc, items] of porLoc) {
    const pal = items.reduce((s, c) => s + c.pallets, 0);
    if (pal <= capUtil && items.length <= P.maxParadas) { unidades.push({ loc, items, pallets: pal }); continue; }
    const k = Math.max(Math.ceil(pal / capUtil), Math.ceil(items.length / P.maxParadas)), objetivo = pal / k;
    const ang = (c) => Math.atan2(c.lat - dep.lat, c.lon - dep.lon);
    const ord = items.slice().sort((a, b) => ang(a) - ang(b));
    let cur = [], acc = 0, n = 0;
    for (const c of ord) {
      if (acc + c.pallets > objetivo * 1.05 && cur.length && n < k - 1) {
        unidades.push({ loc, items: cur, pallets: acc }); cur = []; acc = 0; n++;
      }
      cur.push(c); acc += c.pallets;
    }
    if (cur.length) unidades.push({ loc, items: cur, pallets: acc });
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
    for (const cam of camiones) {
      if (cam.pallets + u.pallets > capUtil || cam.items.length + u.items.length > P.maxParadas) continue;
      const d = haversine(centro(cam.items), cu);
      if (d <= P.radioAgrupKm && d < bd) { bd = d; dest = cam; }
    }
    if (dest) { dest.items.push(...u.items); dest.pallets += u.pallets; dest.locs.add(u.loc); }
    else camiones.push({ items: u.items.slice(), pallets: u.pallets, locs: new Set([u.loc]) });
  }
  // Rescate: camiones casi vacíos se suman al más cercano que tenga lugar (si no hay, quedan marcados "poca carga")
  for (let i = camiones.length - 1; i >= 0; i--) {
    const c = camiones[i];
    if (camiones.length < 2 || c.pallets >= P.minPalletsRuta) continue;
    const cc = centro(c.items);
    let dest = null, bd = Infinity;
    camiones.forEach((o, j) => {
      if (j === i || o.pallets + c.pallets > capUtil || o.items.length + c.items.length > P.maxParadas) return;
      const d = haversine(centro(o.items), cc);
      if (d <= P.radioRescateKm && d < bd) { bd = d; dest = o; }
    });
    if (dest) { dest.items.push(...c.items); dest.pallets += c.pallets; c.locs.forEach((l) => dest.locs.add(l)); camiones.splice(i, 1); }
  }
  const grupos = camiones.map((c) => c.items);

  const rutas = grupos.filter((g) => g.length).map((g, i) => {
    const ord = ordenarVecinoCercano(dep, g);
    const kmRecta = tourLen(dep, ord);
    const km = kmRecta * P.factorRuta;
    const litros = km * P.consumoLKm;
    const pallets = g.reduce((s, c) => s + c.pallets, 0);
    return {
      n: i + 1, paradas: ord, localidades: [...new Set(g.map((c) => c.loc || 'SIN LOCALIDAD'))], km, litros, combustible: litros * P.precioDiesel,
      pallets, bultos: g.reduce((s, c) => s + c.b, 0), kg: g.reduce((s, c) => s + c.kg, 0),
      ocupacion: pallets / P.palletsPorCamion, personas: 1 + P.ayudantesPorCamion,
      pocaCarga: pallets < P.minPalletsRuta,
    };
  });
  const sum = (k) => rutas.reduce((s, r) => s + r[k], 0);
  return {
    params: P, rutas, sinUbicacion: sinUbic,
    totales: {
      clientes: pedidos.clientes.length, bultos: totalBultos, pallets: totalPallets,
      camiones: rutas.length, camionesNecesarios: nCamiones, km: sum('km'),
      litros: sum('litros'), combustible: sum('combustible'),
      personas: rutas.length * (1 + P.ayudantesPorCamion),
    },
  };
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
