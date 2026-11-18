// backend/chessApi.js — Conexión de SOLO LECTURA con la API de ChessERP para traer los pedidos pendientes.
// Las credenciales NUNCA van en el código: se cargan en backend/.env (CHESS_BASE_URL, CHESS_USER, CHESS_PASSWORD).
// Contrato según el catálogo oficial (beertan.chesserp.com/AR485/apidoc/catalogo.html):
//   POST auth/login {usuario,password} → { sessionId, expires } · luego header "Cookie: <sessionId>" en cada llamada
//   GET  pedidos/?fechaPedido=YYYY-MM-DD  (o fechaEntrega=, o facturado=true) → pedidos con idCliente, idSucursal,
//        idDeposito, emitido, eliminado, fechaEntrega y líneas (cantBultos).
// El usuario tiene que ser de tipo "API PÚBLICA" (se da de alta nuevo en el ERP; tiene costo) con permisos de
// Comprobantes y Listas de precios. Todo se puede ajustar desde .env sin tocar el código.
'use strict';

const env = (k, d = '') => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);

const CAMPOS_DEFAULT = {
  id: ['idPedido', 'nroPedido', 'numero', 'id'],
  fecha: ['fechaPedido', 'fecPedido', 'fechaAlta', 'fecha'],
  entrega: ['fechaEntrega'],
  cliente: ['idCliente', 'codCliente', 'codigoCliente', 'cliente'],
  nombre: ['dsCliente', 'nombreCliente', 'razonSocial', 'nombre'],
  bultos: ['cantBultos', 'bultos', 'cantidadBultos', 'cantidad'],
  estado: ['dsEstado', 'estadoPedido', 'estado'],
  lineas: ['líneas del pedido', 'lineas del pedido', 'lineasPedido', 'lineas', 'detalle', 'items', 'articulos'],
  anulado: ['eliminado', 'anulado', 'anulada'],
  emitido: ['emitido'],
  sucursal: ['idSucursal'],
  deposito: ['idDeposito'],
};

function campos() {
  let extra = {};
  try { extra = JSON.parse(env('CHESS_CAMPOS', '{}')); } catch { /* se ignora un JSON mal escrito */ }
  const out = {};
  for (const k of Object.keys(CAMPOS_DEFAULT)) out[k] = [].concat(extra[k] || [], CAMPOS_DEFAULT[k]);
  return out;
}

const configurado = () => !!(env('CHESS_BASE_URL') && env('CHESS_USER') && env('CHESS_PASSWORD'));
const base = () => env('CHESS_BASE_URL').replace(/\/+$/, '') + '/';

let sesion = { id: null, t: 0 };

async function login(fetchFn = fetch) {
  if (sesion.id && Date.now() - sesion.t < 15 * 60 * 1000) return sesion.id;
  const r = await fetchFn(base() + env('CHESS_LOGIN_PATH', 'auth/login'), {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ usuario: env('CHESS_USER'), password: env('CHESS_PASSWORD') }),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`Chess rechazó el ingreso (${r.status}). Revisá CHESS_USER / CHESS_PASSWORD y que el usuario tenga API habilitada.`);
  const j = await r.json().catch(() => ({}));
  const id = j.sessionId || j.token || j.jsessionid || r.headers.get('set-cookie');
  if (!id) throw new Error('Chess no devolvió sesión en el login: revisá el manual (CHESS_LOGIN_PATH).');
  sesion = { id: String(id), t: Date.now() };
  return sesion.id;
}

const primero = (o, claves) => { for (const k of claves) if (o && o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]; return undefined; };
const num = (x) => { const n = Number(String(x ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const isoFecha = (x) => {
  const s = String(x || '');
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s); if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return '';
};

// Pedido crudo de Chess → { id, fecha, cliente, nombre, bultos, estado, anulado }
function normalizar(raw, C = campos()) {
  const lineas = primero(raw, C.lineas);
  let bultos = num(primero(raw, C.bultos));
  if (Array.isArray(lineas) && lineas.length) {
    const s = lineas.reduce((t, l) => t + num(primero(l, C.bultos)), 0);
    if (s > 0) bultos = s;
  }
  const an = primero(raw, C.anulado);
  const em = primero(raw, C.emitido);
  const estado = String(primero(raw, C.estado) ?? '') + (em === true || em === 1 ? ' EMITIDO' : '');
  return {
    id: String(primero(raw, C.id) ?? ''), fecha: isoFecha(primero(raw, C.fecha)) || isoFecha(primero(raw, C.entrega)),
    sucursal: Math.round(num(primero(raw, C.sucursal))), deposito: Math.round(num(primero(raw, C.deposito))),
    cliente: Math.round(num(primero(raw, C.cliente))), nombre: String(primero(raw, C.nombre) ?? '').trim(),
    bultos, estado, anulado: an === true || an === 1 || an === 'S' || /ANUL/i.test(estado),
  };
}

// Suma, por cliente, todos los pedidos vigentes con fecha de pedido <= día de entrega (ej. entrega el 17 con
// pedidos del 14, 15, 16 y 17: se juntan todos). Devuelve el mismo formato que parsePedidos del front.
function agregarHasta(pedidos, fechaEntrega, { desde = '' } = {}) {
  const excluir = env('CHESS_EXCLUIR_ESTADOS', 'ANULADO,FACTURADO,RECHAZADO,EMITIDO').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
  const por = new Map(); const porFecha = {}; let usados = 0, descartados = 0;
  for (const p of pedidos) {
    const ok = p.cliente > 0 && p.bultos > 0 && !p.anulado && p.fecha && p.fecha <= fechaEntrega && (!desde || p.fecha >= desde)
      && !excluir.some((e) => p.estado.toUpperCase().includes(e));
    if (!ok) { descartados++; continue; }
    usados++; porFecha[p.fecha] = (porFecha[p.fecha] || 0) + p.bultos;
    const a = por.get(p.cliente) || { c: p.cliente, n: p.nombre, b: 0, p: 0, neto: 0 };
    a.b += p.bultos; a.p += 1; if (!a.n && p.nombre) a.n = p.nombre;
    por.set(p.cliente, a);
  }
  const clientes = [...por.values()].map((x) => ({ ...x, b: Math.round(x.b * 100) / 100 }));
  return { clientes, total: { clientes: clientes.length, bultos: Math.round(clientes.reduce((s, x) => s + x.b, 0) * 10) / 10 },
    detalle: { pedidosUsados: usados, pedidosDescartados: descartados, bultosPorFecha: porFecha } };
}

const restarDias = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };

async function traerPedidos(fechaEntrega, fetchFn = fetch) {
  const sid = await login(fetchFn);
  const dias = Math.max(1, Number(env('CHESS_DIAS_ATRAS', '7')));
  const desde = restarDias(fechaEntrega, dias);
  const lista = []; let muestra = null;
  const C = campos();
  const permitidos = (k) => env(k).split(',').map((x) => Number(x.trim())).filter((x) => Number.isFinite(x) && x > 0);
  const sucs = permitidos('CHESS_SUCURSALES'), deps = permitidos('CHESS_DEPOSITOS');   // opcional: solo Tandil / Las Flores
  // La API busca por UN día de alta (fechaPedido): se piden todos los días desde `desde` hasta el día de entrega y se suman.
  for (let k = dias; k >= 0; k--) {
    const dia = restarDias(fechaEntrega, k);
    const qs = new URLSearchParams({ fechaPedido: dia });
    const r = await fetchFn(`${base()}${env('CHESS_PEDIDOS_PATH', 'pedidos')}/?${qs}`, {
      headers: { Accept: 'application/json', Cookie: sid }, signal: AbortSignal.timeout(60000),
    });
    if (r.status === 401 || r.status === 403) { sesion = { id: null, t: 0 }; throw new Error(`Chess negó el acceso a pedidos (${r.status}): el usuario necesita ser de tipo API PÚBLICA con permisos de Comprobantes.`); }
    if (!r.ok) throw new Error(`Chess respondió ${r.status} al pedir los pedidos del ${dia}.`);
    const j = await r.json();
    const arr = Array.isArray(j) ? j : (j.pedidos || j.data || j.items || j.rows || []);
    if (!Array.isArray(arr)) throw new Error('La respuesta de Chess no trae una lista de pedidos.');
    if (!muestra && arr.length) muestra = arr[0];
    for (const x of arr) {
      const p = normalizar(x, C); p.fecha = dia;                       // fecha del pedido = el día consultado
      if ((sucs.length && !sucs.includes(p.sucursal)) || (deps.length && !deps.includes(p.deposito))) continue;
      lista.push(p);
    }
  }
  return { desde, crudos: lista.length, muestra, ...agregarHasta(lista, fechaEntrega, { desde }) };
}

module.exports = { configurado, login, normalizar, agregarHasta, traerPedidos, campos };
