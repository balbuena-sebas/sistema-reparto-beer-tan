// components/TSimulacion.js — Calendario de romaneo + simulación de reparto en vivo.
// Carga perezosa (lazy) desde App.js: MapLibre solo se descarga al abrir esta pestaña.
// El romaneo y la maestra de clientes se suben desde la pestaña Importar (CargaRuteo).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { apiFetch, suscribirRuteo } from '../api/client';
import {
  PARAMS_DEFAULT, parsePedidos, construirUbicaciones, calibrarFactor, diffPedidos,
  indexarRechazos, cruzarRechazos, resumenRuteados, costearRuta, comparativaMarcas, resumenPorLocalidad,
  perfilesChoferes, asignarChoferes, zonaDelDia, simularConTope,
} from '../simulacion/engine';
import { COLORES, VISTAS, crearMapa, cambiarVista, pintar, encuadrar, largoMaximo, posicionesAnim, pintarCamiones } from '../simulacion/mapa';
import { rutaPorCalles, claveRuta } from '../simulacion/calles';
import '../simulacion/simulacion.css';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DOW = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const f0 = (n) => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(n || 0);
const f1 = (n) => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(n || 0);
const money = (n) => '$ ' + f0(n);
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hhmm = (m) => (m == null ? '—' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
const fechaLarga = (s) => (s ? new Date(s + 'T12:00:00').toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }) : '');
const cap = (s) => String(s || '').toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

function proximoDiaHabil(desde = new Date()) {
  const d = new Date(desde); d.setDate(d.getDate() + 1);
  if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return iso(d);
}
const leerArchivo = (file) => new Promise((ok, mal) => {
  const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => mal(r.error); r.readAsArrayBuffer(file);
});
const centro = (pts) => ({ lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lon: pts.reduce((s, p) => s + p.lon, 0) / pts.length });

// Tres tarjetas: lo mismo (mismos litros) cargado en cada estación, para decidir dónde conviene cargar.
function TarjetasMarcas({ litros, km, bultos, clientes, params, onElegir }) {
  const marcas = comparativaMarcas(litros, params);
  const min = Math.min(...marcas.map((m) => m.costo));
  return (
    <div className="sim-marcas">
      {marcas.map((m) => {
        const barata = m.costo === min, uso = params.marca === m.marca;
        return (
          <div key={m.marca} className={`sim-marca ${barata ? 'barata' : ''} ${uso ? 'uso' : ''}`}>
            <div className="sim-marca-h"><b>{m.marca}</b>{barata && <span className="sim-tag">Más barata</span>}</div>
            <div className="sim-marca-v">{money(m.costo)}</div>
            <div className="sim-sub">{money(m.precio)} por litro · {m.fecha}</div>
            <div className="sim-marca-d">
              <span>{money(m.costo / (km || 1))} / km</span>
              <span>{money(m.costo / (bultos || 1))} / bulto</span>
              <span>{money(m.costo / (clientes || 1))} / cliente</span>
            </div>
            <div className={barata ? 'sim-ok' : 'sim-mas'}>{barata ? 'La más conveniente' : `+${money(m.costo - min)} que la más barata`}</div>
            <button className="sim-btn" disabled={uso} onClick={() => onElegir(m.marca, m.precio)}>{uso ? '✔ Usada en el cálculo' : 'Usar en el cálculo'}</button>
          </div>
        );
      })}
    </div>
  );
}

export function TSimulacion({ loggedInUser }) {
  const rol = String(loggedInUser?.role || '').toLowerCase();
  const permisos = loggedInUser?.permisos || {};
  const puedeVerRechazos = rol === 'admin' || permisos.rechazos === true;
  const usuario = loggedInUser?.nombre || '';
  const hdr = useMemo(() => ({ 'x-user-name': encodeURIComponent(usuario) }), [usuario]);

  const [modo, setModo] = useState('simulacion');
  const [vista, setVista] = useState('calle');
  const [animF, setAnimF] = useState(0);                   // avance de la animación 0..1
  const [animOn, setAnimOn] = useState(false);
  const [msg, setMsg] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [enVivo, setEnVivo] = useState(false);
  const [baseFallo, setBaseFallo] = useState(false);
  const [callesOn, setCallesOn] = useState(true);
  const [calles, setCalles] = useState({});               // clave de ruta → { coords, km, min }

  const [lista, setLista] = useState([]);
  const [diaSel, setDiaSel] = useState(null);
  const [diaDatos, setDiaDatos] = useState(null);
  const cacheDias = useRef(new Map());
  const [cursor, setCursor] = useState(() => { const h = new Date(); return { y: h.getFullYear(), m: h.getMonth() }; });

  const [ubicItems, setUbicItems] = useState([]);
  const [pedidos, setPedidos] = useState(null);
  const [params, setParams] = useState(PARAMS_DEFAULT);
  const [factorCal, setFactorCal] = useState(null);
  const [rutaSel, setRutaSel] = useState(null);
  const [diaRuteado, setDiaRuteado] = useState(null);     // romaneo del día de entrega de los pedidos (si ya está cargado)
  const [rechDia, setRechDia] = useState(null);           // rechazos reales del día elegido en el calendario
  const [rechPed, setRechPed] = useState(null);           // rechazos reales del día de entrega de los pedidos

  const asigFn = useRef(null);
  const [hist, setHist] = useState({});                      // romaneos recientes (para aprender la zona de cada chofer)
  const [ausentes, setAusentes] = useState([]);           // choferes que no vinieron
  const [cubre, setCubre] = useState({});                 // { chofer: chofer cuya zona cubre }
  const [manual, setManual] = useState({});               // { clienteAncla: chofer } elegido a mano por ruta
  const asigVer = useRef('');

  const mapDiv = useRef(null); const mapRef = useRef(null); const datosMapa = useRef(null);
  const aviso = useCallback((texto, tipo = 'ok') => setMsg({ texto, tipo }), []);

  // ── Carga de datos ───────────────────────────────────────────────────────
  const cargarLista = useCallback(async () => {
    try { const r = await apiFetch('/api/ruteo/dias'); setLista(r.data || []); } catch (e) { aviso(e.message, 'err'); }
  }, [aviso]);
  const cargarUbic = useCallback(async () => {
    try { const r = await apiFetch('/api/ruteo/ubicaciones'); setUbicItems(r.data || []); } catch (e) { aviso(e.message, 'err'); }
  }, [aviso]);
  const cargarPedidos = useCallback(async () => {
    try { const r = await apiFetch('/api/ruteo/pedidos'); setPedidos(r.data ? r : null); } catch (e) { aviso(e.message, 'err'); }
  }, [aviso]);
  const traerDia = useCallback(async (fecha) => {
    if (cacheDias.current.has(fecha)) return cacheDias.current.get(fecha);
    const r = await apiFetch(`/api/ruteo/dia/${fecha}`);
    if (r.data) cacheDias.current.set(fecha, r.data);
    return r.data;
  }, []);
  const cargarDia = useCallback(async (fecha) => {
    setDiaSel(fecha);
    try { setDiaDatos(await traerDia(fecha)); } catch (e) { aviso(e.message, 'err'); }
  }, [traerDia, aviso]);

  useEffect(() => { cargarLista(); cargarUbic(); cargarPedidos(); }, [cargarLista, cargarUbic, cargarPedidos]);

  useEffect(() => {
    const parar = suscribirRuteo((ev, info) => {
      if (ev === 'pedidos') cargarPedidos();
      if (ev === 'ubicaciones') cargarUbic();
      if (ev === 'asignacion' && asigFn.current) asigFn.current();
      if (ev === 'dia') { cacheDias.current.delete(info.fecha); cargarLista(); setDiaSel((s) => { if (s === info.fecha) cargarDia(s); return s; }); }
    }, setEnVivo);
    return parar;
  }, [cargarPedidos, cargarUbic, cargarLista, cargarDia]);
  useEffect(() => {
    if (enVivo) return undefined;
    const t = setInterval(cargarPedidos, 20000); return () => clearInterval(t);
  }, [enVivo, cargarPedidos]);

  const fechaPedidos = pedidos?.data?.fechaEntrega;

  useEffect(() => {
    let vivo = true;
    apiFetch('/api/ruteo/combustible').then((r) => {
      if (!vivo || !r.data) return;
      const pm = {}, fm = {};
      r.data.marcas.forEach((m) => {
        const g = m.comun || m.premium; if (!g) return;
        const nombre = /SHELL/.test(m.marca) ? 'Shell' : /AXION/.test(m.marca) ? 'Axion' : /YPF/.test(m.marca) ? 'YPF' : null;
        if (!nombre) return;
        pm[nombre] = Math.round(g.precio);
        const [y, mo, d] = g.fecha.split('-');
        fm[nombre] = `${d}/${mo}/${y.slice(2)} · ${g.origen === 'zona' ? 'zona' : 'Tandil'} oficial${g.estaciones > 1 ? ` (${g.estaciones} estaciones)` : ''}`;
      });
      if (!Object.keys(pm).length) return;
      setParams((p) => {
        const marca = pm[p.marca] ? p.marca : Object.keys(pm)[0];
        return { ...p, preciosMarca: { ...p.preciosMarca, ...pm }, fechasMarca: { ...p.fechasMarca, ...fm }, precioDiesel: pm[marca] || p.precioDiesel, marca };
      });
    }).catch(() => { /* sin conexión al dato oficial: quedan los precios del Excel */ });
    return () => { vivo = false; };
  }, []);

  // ── Choferes del día (compartido en vivo con el resto de los usuarios) ────
  const cargarAsig = useCallback(async () => {
    try {
      const r = await apiFetch('/api/ruteo/asignacion'); const d = r.data;
      const ok = d && d.fecha === fechaPedidos;
      const a = ok ? d.ausentes || [] : [], c = ok ? d.cubre || {} : {}, m = ok ? d.manual || {} : {};
      const k = JSON.stringify([a, c, m]);
      if (k !== asigVer.current) { asigVer.current = k; setAusentes(a); setCubre(c); setManual(m); }
    } catch { /* se reintenta con el próximo evento */ }
  }, [fechaPedidos]);
  asigFn.current = cargarAsig;
  useEffect(() => { cargarAsig(); }, [cargarAsig]);
  const guardarAsig = async (a, c, m) => {
    setAusentes(a); setCubre(c); setManual(m);
    asigVer.current = JSON.stringify([a, c, m]);
    if (!fechaPedidos) return;
    try { await apiFetch('/api/ruteo/asignacion', { method: 'PUT', headers: hdr, body: JSON.stringify({ fecha: fechaPedidos, ausentes: a, cubre: c, manual: m }) }); }
    catch (e) { aviso(e.message, 'err'); }
  };
  useEffect(() => {
    let vivo = true;
    const fechas = lista.map((x) => x.fecha).sort().slice(-12);
    (async () => {
      const h = {};
      for (const f of fechas) { try { const d = await traerDia(f); if (d) h[f] = d; } catch { /* sigue */ } if (!vivo) return; }
      if (vivo) setHist(h);
    })();
    return () => { vivo = false; };
  }, [lista, traerDia]);
  const mapaLista = useMemo(() => new Map(lista.map((x) => [x.fecha, x])), [lista]);

  // Romaneo del día de entrega (si el ruteador ya lo generó) y rechazos reales, para cruzar con los pedidos
  useEffect(() => {
    setDiaRuteado(null);
    if (fechaPedidos && mapaLista.has(fechaPedidos)) traerDia(fechaPedidos).then(setDiaRuteado).catch(() => {});
  }, [fechaPedidos, mapaLista, traerDia, lista]);
  const traerRechazos = useCallback(async (fecha) => {
    try { const r = await apiFetch(`/api/rechazos?desde=${fecha}&hasta=${fecha}`); return r.data || []; } catch { return []; }
  }, []);
  useEffect(() => {
    setRechPed(null);
    if (puedeVerRechazos && fechaPedidos) traerRechazos(fechaPedidos).then(setRechPed);
  }, [fechaPedidos, puedeVerRechazos, traerRechazos]);
  useEffect(() => {
    setRechDia(null);
    if (puedeVerRechazos && diaSel && modo === 'calendario') traerRechazos(diaSel).then(setRechDia);
  }, [diaSel, modo, puedeVerRechazos, traerRechazos]);

  // ── Cálculos ─────────────────────────────────────────────────────────────
  const ubic = useMemo(() => construirUbicaciones(ubicItems, diaDatos ? { [diaSel]: diaDatos } : {}), [ubicItems, diaDatos, diaSel]);

  useEffect(() => {
    const dias = {}; cacheDias.current.forEach((v, k) => { dias[k] = v; });
    if (Object.keys(dias).length) setFactorCal(calibrarFactor(dias, params.deposito));
  }, [diaDatos, params.deposito]);

  const simBase = useMemo(() => {
    if (!pedidos?.data?.clientes?.length) return null;
    return simularConTope({ clientes: pedidos.data.clientes }, ubic, params);
  }, [pedidos, ubic, params]);

  const haceDias = (f, n) => { if (!f) return ''; const d = new Date(`${f}T12:00:00`); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
  const perfiles = useMemo(() => perfilesChoferes(hist, ubic, params.deposito, fechaPedidos), [hist, ubic, params.deposito, fechaPedidos]);
  const claveAncla = (r) => String(Math.min(...r.paradas.map((p) => p.c)));
  // Chofer por ruta: lo elegido a mano manda; el resto se asigna por zona habitual (sin repetir choferes).
  const choferesRutas = useMemo(() => {
    if (!simBase) return [];
    const out = simBase.rutas.map((r) => (manual[claveAncla(r)] ? { chofer: manual[claveAncla(r)], motivo: 'elegido a mano' } : null));
    const libres = simBase.rutas.map((r, i) => i).filter((i) => !out[i]);
    const ocupados = out.filter(Boolean).map((x) => x.chofer);
    const auto = asignarChoferes(libres.map((i) => simBase.rutas[i]), perfiles, [...ausentes, ...ocupados], cubre);
    libres.forEach((i, k) => { out[i] = auto[k]; });
    return out;
  }, [simBase, perfiles, ausentes, cubre, manual]);

  // Rutas de la simulación con la geometría real por calles (si ya se calculó) y sus km
  const rutasSimMapa = useMemo(() => (simBase ? simBase.rutas.map((r, i) => {
    const puntos = r.paradas.map((p, k) => ({ lat: p.lat, lon: p.lon, seq: k + 1, titulo: p.n,
      detalle: `Cód. ${p.c} · ${f1(p.b)} bultos · ${f1(p.pallets)} pallets · ${cap(p.loc)}` }));
    return { color: COLORES[i % COLORES.length], label: `Camión ${r.n} · ${r.localidades.map(cap).join(' + ')}${choferesRutas[i] && choferesRutas[i].chofer ? ` · ${choferesRutas[i].chofer}` : ''}`, puntos,
      geom: callesOn ? calles[claveRuta(params.deposito, puntos)]?.coords : null };
  }) : []), [simBase, calles, callesOn, params.deposito, choferesRutas]);

  const sim = useMemo(() => {
    if (!simBase) return null;
    let conCalle = 0;
    const rutas = simBase.rutas.map((r, i) => {
      const c = callesOn ? calles[claveRuta(params.deposito, rutasSimMapa[i].puntos)] : null;
      if (!c) return { ...r, kmCalle: false };
      conCalle++;
      return { ...r, km: c.km, ...costearRuta(params, { km: c.km, pallets: r.pallets, bultos: r.bultos, localidades: r.localidades }), kmCalle: true, min: c.min };
    });
    const sum = (k) => rutas.reduce((s, r) => s + r[k], 0);
    return { ...simBase, rutas, conCalle, totales: { ...simBase.totales, km: sum('km'), litros: sum('litros'), combustible: sum('combustible'), personas: sum('personas'), recargas: sum('recargas') } };
  }, [simBase, calles, callesOn, params, rutasSimMapa]);

  const resumenLoc = useMemo(() => (sim ? resumenPorLocalidad(sim.rutas) : []), [sim]);
  // Costo del día real (mismas reglas de combustible y recarga que la planilla)
  const costoDia = useMemo(() => {
    if (!diaDatos) return null;
    const rutas = diaDatos.rutas.map((r) => costearRuta(params, { km: r.km, pallets: r.pallets, cap: r.cap || null, bultos: r.bultos }));
    return { rutas, litros: rutas.reduce((s, x) => s + x.litros, 0), combustible: rutas.reduce((s, x) => s + x.combustible, 0), recargas: rutas.reduce((s, x) => s + x.recargas, 0) };
  }, [diaDatos, params]);

  const rutasDiaMapa = useMemo(() => {
    if (!diaDatos) return [];
    return diaDatos.rutas.map((r, i) => {
      const puntos = diaDatos.paradas.filter((p) => p[0] === i).map((p) => ({ lat: p[4], lon: p[5], seq: p[1], titulo: p[3],
        detalle: `Cód. ${p[2]} · ${f0(p[6])} kg · llega ${hhmm(p[9])}` }));
      return { color: COLORES[i % COLORES.length], label: `${r.chofer || 'Ruta'} · ${r.veh}`, puntos,
        geom: callesOn && puntos.length > 1 ? calles[claveRuta(params.deposito, puntos)]?.coords : null };
    });
  }, [diaDatos, calles, callesOn, params.deposito]);

  const rutasMapa = modo === 'simulacion' ? rutasSimMapa : rutasDiaMapa;

  // Etiquetas de localidad / chofer sobre el mapa
  const etiquetas = useMemo(() => {
    const out = [];
    if (modo === 'simulacion' && simBase) {
      simBase.rutas.forEach((r, i) => {
        const g = new Map();
        r.paradas.forEach((p) => { const k = p.loc || 'Sin localidad'; (g.get(k) || g.set(k, []).get(k)).push(p); });
        g.forEach((ps, loc) => { const c = centro(ps); out.push({ lat: c.lat, lon: c.lon, ruta: i, color: COLORES[i % COLORES.length], texto: `${cap(loc)} · ${ps.length}` }); });
      });
    } else if (diaDatos) {
      rutasDiaMapa.forEach((r, i) => { if (r.puntos.length) { const c = centro(r.puntos); out.push({ lat: c.lat, lon: c.lon, ruta: i, color: r.color, texto: `${(diaDatos.rutas[i].chofer || 'Ruta').split(' ')[0]} · ${r.puntos.length}` }); } });
    }
    return out;
  }, [modo, simBase, diaDatos, rutasDiaMapa]);

  // Pide a OSRM la ruta por calles de cada camión (de a una, con memoria para no repetir)
  useEffect(() => {
    if (!callesOn) return undefined;
    let vivo = true;
    (async () => {
      for (const r of rutasMapa) {
        if (!vivo) return;
        if (r.puntos.length < 1) continue;
        const k = claveRuta(params.deposito, r.puntos);
        if (calles[k]) continue;
        const res = await rutaPorCalles(params.deposito, r.puntos);
        if (!vivo) return;
        if (res) setCalles((c) => (c[k] ? c : { ...c, [k]: res }));
      }
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rutasMapa.length, callesOn, simBase, diaDatos, params.deposito]);

  // ── Mapa ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapDiv.current) return undefined;
    const map = crearMapa(mapDiv.current, params.deposito, (m) => setBaseFallo(m || true)); mapRef.current = map;
    map.on('sim-respaldo', () => { if (datosMapa.current) pintar(map, datosMapa.current); });
    return () => { clearTimeout(map._vigia); map._removed = true; map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const redibujar = useCallback(() => {
    const map = mapRef.current; if (!map || !datosMapa.current) return;
    pintar(map, datosMapa.current);
  }, []);
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    datosMapa.current = { deposito: params.deposito, rutas: rutasMapa, etiquetas, soloRuta: rutaSel };
    redibujar();
  }, [rutasMapa, etiquetas, rutaSel, params.deposito, redibujar]);
  const firma = rutasMapa.map((r) => r.puntos.length).join(',') + '|' + rutaSel + '|' + modo;
  useEffect(() => {
    const map = mapRef.current; if (!map || !rutasMapa.length) return;
    encuadrar(map, { deposito: params.deposito, rutas: rutasMapa, soloRuta: rutaSel });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firma]);
  useEffect(() => { setRutaSel(null); }, [modo, diaSel, pedidos?.version]);
  // ── Animación del día: camiones moviéndose por sus rutas ─────────────────
  const animDatos = useMemo(() => ({ deposito: params.deposito, rutas: rutasMapa, soloRuta: rutaSel }), [params.deposito, rutasMapa, rutaSel]);
  const animLargo = useMemo(() => largoMaximo(animDatos), [animDatos]);
  const animPos = useMemo(() => posicionesAnim(animDatos, animF * animLargo), [animDatos, animF, animLargo]);
  useEffect(() => { setAnimOn(false); setAnimF(0); }, [firma]);
  useEffect(() => {
    if (!animOn) return undefined;
    const id = setInterval(() => setAnimF((f) => {
      if (f >= 1) { setAnimOn(false); return 1; }
      return Math.min(1, f + 0.0025);                       // ≈ 25 s de punta a punta
    }), 60);
    return () => clearInterval(id);
  }, [animOn]);
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    pintarCamiones(map, animOn || animF > 0 ? animPos.feats : []);
  }, [animPos, animOn, animF]);
  const elegirVista = (k) => { setVista(k); if (mapRef.current) cambiarVista(mapRef.current, k, redibujar); };

  // ── Pedidos ──────────────────────────────────────────────────────────────
  const subirPedidos = async (file, fechaEntrega) => {
    setOcupado(true);
    try {
      const wb = XLSX.read(await leerArchivo(file), { type: 'array' });
      const m = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
      const ped = parsePedidos(m);
      const previo = pedidos?.data;
      const snap = previo ? previo.clientes.map((c) => [c.c, c.b, c.n]) : null;
      const anterior = previo ? { archivo: previo.archivo, cargadoEn: pedidos.updatedAt, clientes: snap } : null;
      // "base" = primera carga del día de entrega: permite saber qué pedidos ya se ruteó y salieron de la lista
      const base = previo && previo.fechaEntrega === fechaEntrega ? (previo.base || snap) : null;
      await apiFetch('/api/ruteo/pedidos', { method: 'PUT', headers: hdr,
        body: JSON.stringify({ archivo: file.name, fechaEntrega, clientes: ped.clientes, anterior, base }) });
      aviso(`Pedidos cargados: ${ped.total.clientes} clientes, ${f0(ped.total.bultos)} bultos. Todos los usuarios con acceso lo ven al instante.`);
      await cargarPedidos();
    } catch (e) { aviso(e.message, 'err'); }
    setOcupado(false);
  };

  // ── Calendario ───────────────────────────────────────────────────────────
  const celdas = useMemo(() => {
    const prim = new Date(cursor.y, cursor.m, 1); const off = (prim.getDay() + 6) % 7;
    const n = new Date(cursor.y, cursor.m + 1, 0).getDate(); const out = [];
    for (let i = 0; i < off; i++) out.push(null);
    for (let d = 1; d <= n; d++) out.push(iso(new Date(cursor.y, cursor.m, d)));
    return out;
  }, [cursor]);
  const mover = (dm) => setCursor((c) => { const d = new Date(c.y, c.m + dm, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const hoyISO = iso(new Date());

  const [fechaNueva, setFechaNueva] = useState(proximoDiaHabil());
  const refPed = useRef(null);

  const resumenDia = diaDatos && {
    paradas: diaDatos.paradas.length, bultos: diaDatos.rutas.reduce((s, r) => s + r.bultos, 0),
    pallets: diaDatos.rutas.reduce((s, r) => s + r.pallets, 0), km: diaDatos.rutas.reduce((s, r) => s + r.km, 0),
  };
  const cruceDia = useMemo(() => (diaDatos && rechDia && rechDia.length ? cruzarRechazos(diaDatos, indexarRechazos(rechDia)) : null), [diaDatos, rechDia]);
  const cambios = useMemo(() => (pedidos?.data?.anterior?.clientes
    ? diffPedidos(pedidos.data.anterior.clientes, pedidos.data.clientes, ubic) : null), [pedidos, ubic]);
  const ruteados = useMemo(() => (pedidos?.data?.base
    ? resumenRuteados(pedidos.data.base, pedidos.data.clientes, ubic, diaRuteado, rechPed && rechPed.length ? indexarRechazos(rechPed) : null) : null),
  [pedidos, ubic, diaRuteado, rechPed]);
  const txtLoc = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([l, n]) => `${cap(l)} ${n}`).join(', ');

  return (
    <div className="sim">
      <div className="sim-top">
        <div>
          <h2 className="sim-title">🧭 Simulación de reparto</h2>
          <div className="sim-sub">Romaneo del ruteador por día · pedidos de mañana · mapa 3D y satélite</div>
        </div>
        <div className="sim-row">
          <span className={`sim-live ${enVivo ? 'on' : 'off'}`}>{enVivo ? '● En vivo' : '○ Reconectando…'}</span>
          <div className="sim-seg">
            <button className={modo === 'simulacion' ? 'on' : ''} onClick={() => setModo('simulacion')}>📦 Simulación</button>
            <button className={modo === 'calendario' ? 'on' : ''} onClick={() => setModo('calendario')}>📅 Romaneo por día</button>
          </div>
        </div>
      </div>

      {msg && <div className={`sim-msg ${msg.tipo === 'err' ? 'err' : 'ok'}`} role="status">{msg.texto}</div>}
      {baseFallo && (
        <div className="sim-warn">
          No pude cargar el mapa de fondo{typeof baseFallo === 'string' ? ` (${baseFallo.slice(0, 140)})` : ''}. Los puntos y las rutas se ven igual, sobre un mapa de calles alternativo.{' '}
          <button className="sim-btn" style={{ padding: '2px 8px' }} onClick={() => { setBaseFallo(false); elegirVista(vista); }}>Reintentar</button>
        </div>
      )}

      <div className="sim-grid">
        <div style={{ display: 'grid', gap: 14 }}>
          <div className="sim-card">
            <div className="sim-cal-head">
              <button onClick={() => mover(-1)} aria-label="Mes anterior">‹</button>
              <span>{MESES[cursor.m]} {cursor.y}</span>
              <button onClick={() => mover(1)} aria-label="Mes siguiente">›</button>
            </div>
            <div className="sim-cal">
              {DOW.map((d, i) => <div key={i} className="dow">{d}</div>)}
              {celdas.map((f, i) => {
                if (!f) return <div key={i} className="sim-day out" />;
                const x = mapaLista.get(f); const esPed = fechaPedidos === f;
                const clic = () => { if (x) { setModo('calendario'); cargarDia(f); } else if (esPed) setModo('simulacion'); };
                return (
                  <button key={f} className={`sim-day ${x ? 'has' : ''} ${esPed ? 'ped' : ''} ${diaSel === f && modo === 'calendario' ? 'sel' : ''} ${f === hoyISO ? 'hoy' : ''}`}
                    onClick={clic} disabled={!x && !esPed} title={x ? `${x.paradas} paradas · ${f0(x.bultos)} bultos` : esPed ? 'Pedidos cargados para este día' : ''}>
                    {Number(f.slice(8))}{x && <small>{x.paradas}</small>}
                  </button>
                );
              })}
            </div>
            <div className="sim-sub" style={{ marginTop: 8 }}>Azul = día con romaneo (número = paradas) · 📦 = pedidos cargados</div>
          </div>

          <div className="sim-card">
            <h3>Pedidos del día siguiente</h3>
            <div style={{ display: 'grid', gap: 8 }}>
              <label className="sim-sub">Fecha de entrega
                <input className="sim-input" type="date" value={fechaNueva} onChange={(e) => setFechaNueva(e.target.value)} />
              </label>
              <input ref={refPed} type="file" accept=".xlsx,.xls,.csv" hidden
                onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) subirPedidos(f, fechaNueva); }} />
              <button className="sim-btn pri" disabled={ocupado} onClick={() => refPed.current.click()}>📦 Subir pedidos (Excel)</button>
              <div className="sim-sub">
                {pedidos?.data ? <>Vigente: <b>{pedidos.data.archivo}</b> para el <b>{fechaLarga(pedidos.data.fechaEntrega)}</b>
                  {pedidos.updatedBy ? <> · cargó {decodeURIComponent(pedidos.updatedBy)}</> : null}
                  {pedidos.updatedAt ? <> · {new Date(pedidos.updatedAt).toLocaleString('es-AR')}</> : null}</> : 'Todavía no hay pedidos cargados.'}
                <br />Ubicaciones conocidas: {f0(ubicItems.length)} clientes.
                <br />El romaneo del ruteador y la maestra de clientes se suben en la pestaña <b>📂 Importar</b>.
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gap: 14, minWidth: 0 }}>
          <div className="sim-map-wrap">
            <div className="sim-seg sim-vistas">
              {Object.entries(VISTAS).map(([k, v]) => (
                <button key={k} className={vista === k ? 'on' : ''} onClick={() => elegirVista(k)}>{v.label}</button>
              ))}
              <button className={callesOn ? 'on' : ''} onClick={() => setCallesOn((v) => !v)} title="Dibuja el recorrido real por calles y rutas (OSRM)">🛣️ Por calles</button>
            </div>
            <div ref={mapDiv} className="sim-map" />
            {rutasMapa.length > 0 && (
              <div className="sim-anim">
                <button className="sim-btn" onClick={() => { if (animF >= 1) setAnimF(0); setAnimOn((v) => !v); }}>
                  {animOn ? '⏸ Pausar' : animF >= 1 ? '↺ Repetir' : '▶ Ver el día'}
                </button>
                <input type="range" min="0" max="1000" value={Math.round(animF * 1000)}
                  onChange={(e) => { setAnimOn(false); setAnimF(Number(e.target.value) / 1000); }} aria-label="Avance del día" />
                <span>{animPos.hechas} de {animPos.total} entregas · {f0(animF * animLargo)} km</span>
              </div>
            )}
          </div>

          {modo === 'simulacion' ? (
            !sim ? <div className="sim-card sim-empty">Subí el Excel de pedidos para simular la entrega.<br />Se calcula en tu navegador y lo ve en vivo cualquier usuario con acceso.</div> : (
              <>
                <div className="sim-card">
                  <h3>Simulación · {fechaLarga(fechaPedidos)}</h3>
                  <div className="sim-kpis">
                    <div className="sim-kpi"><b>{f0(sim.totales.clientes)}</b><span>Clientes pendientes</span></div>
                    <div className="sim-kpi"><b>{f0(sim.totales.bultos)}</b><span>Bultos</span></div>
                    <div className="sim-kpi"><b>{f1(sim.totales.pallets)}</b><span>Pallets</span></div>
                    <div className="sim-kpi"><b>{sim.totales.camiones}</b><span>Camiones</span></div>
                    <div className="sim-kpi"><b>{sim.totales.personas}</b><span>Personas</span></div>
                    <div className="sim-kpi"><b>{f0(sim.totales.km)}</b><span>Km {sim.conCalle === sim.rutas.length && sim.conCalle > 0 ? 'por calles' : 'estimados'}</span></div>
                    <div className="sim-kpi"><b>{money(sim.totales.combustible)}</b><span>Combustible ({f0(sim.totales.litros)} L)</span></div>
                    <div className="sim-kpi"><b>{sim.totales.recargas}</b><span>Recargas</span></div>
                  </div>
                  {cambios && (cambios.salen + cambios.entran + cambios.cambian > 0) && (
                    <div className="sim-msg" style={{ marginTop: 10 }}>
                      <b>Cambios desde la carga anterior</b> ({pedidos.data.anterior.archivo}):{' '}
                      {cambios.salen > 0 && <>salieron <b>{cambios.salen}</b> clientes ({txtLoc(cambios.salenPorLoc)}). </>}
                      {cambios.entran > 0 && <>Entraron <b>{cambios.entran}</b> nuevos ({txtLoc(cambios.entranPorLoc)}). </>}
                      {cambios.cambian > 0 && <>{cambios.cambian} cambiaron de bultos. </>}
                      Bultos: {f0(cambios.bultosAntes)} → <b>{f0(cambios.bultosAhora)}</b>.
                    </div>
                  )}
                  {sim.sinUbicacion.length > 0 && ubic.size === 0 && (
                    <div className="sim-msg" style={{ marginTop: 10 }}>
                      <b>Todavía no hay ubicaciones de clientes.</b> Cargá la maestra de clientes y/o los romaneos del ruteador en <b>📂 Importar → 🧭 Ruteo</b>; con eso la simulación arma camiones, km y combustible y dibuja el mapa.
                    </div>
                  )}
                  {sim.sinUbicacion.length > 0 && (
                    <div className="sim-warn" style={{ marginTop: 10 }}>
                      {sim.sinUbicacion.length} cliente(s) sin ubicación (no entran en el mapa ni en los km): {sim.sinUbicacion.slice(0, 6).map((c) => c.n).join(', ')}{sim.sinUbicacion.length > 6 ? '…' : ''}
                    </div>
                  )}
                </div>

                {ruteados && (
                  <div className="sim-card">
                    <h3>✅ Ya ruteados (salieron de la lista de pedidos)</h3>
                    <div className="sim-kpis" style={{ marginBottom: 10 }}>
                      <div className="sim-kpi"><b>{f0(ruteados.clientes)}</b><span>Clientes</span></div>
                      <div className="sim-kpi"><b>{f0(ruteados.bultos)}</b><span>Bultos pedidos</span></div>
                    </div>
                    <div className="sim-sub" style={{ marginBottom: 8 }}>
                      Por localidad: {Object.entries(ruteados.porLoc).sort((a, b) => b[1].bultos - a[1].bultos)
                        .map(([l, o]) => `${cap(l)} ${o.clientes} clientes / ${f0(o.bultos)} bultos`).join(' · ')}
                    </div>
                    {ruteados.porRuta ? (
                      <div style={{ overflowX: 'auto' }}>
                        <table className="sim-table">
                          <thead><tr><th>Salió en</th><th>Vehículo</th><th>Clientes</th><th>Bultos pedidos</th>{rechPed && rechPed.length > 0 && <><th>Bultos reales</th><th>Rechazados</th></>}<th>Km ruta</th><th>Horario</th></tr></thead>
                          <tbody>
                            {ruteados.porRuta.map((o) => { const r = diaRuteado.rutas[o.ri]; return (
                              <tr key={o.ri}>
                                <td><span className="sim-chip" style={{ background: COLORES[o.ri % COLORES.length] }} />{r.chofer}</td><td>{r.veh}</td>
                                <td>{o.clientes}</td><td>{f0(o.bultos)}</td>
                                {rechPed && rechPed.length > 0 && <><td>{o.conReal ? f0(o.real) : '—'}</td><td>{o.conReal ? f0(o.rech) : '—'}</td></>}
                                <td>{f1(r.km)}</td><td>{hhmm(r.ini)}–{hhmm(r.fin)}</td>
                              </tr>); })}
                          </tbody>
                        </table>
                        {ruteados.sinRuta > 0 && <div className="sim-sub" style={{ marginTop: 6 }}>{ruteados.sinRuta} cliente(s) no aparecen en el romaneo de ese día.</div>}
                      </div>
                    ) : (
                      <div className="sim-sub">Todavía no está el romaneo del {fechaLarga(fechaPedidos)}. Cuando lo subas en <b>📂 Importar</b>, acá vas a ver en qué camión salió cada grupo, con chofer, bultos y km{puedeVerRechazos ? ', y después de la entrega, cómo salió realmente (rechazos).' : '.'}</div>
                    )}
                  </div>
                )}

                <div className="sim-card">
                  <h3>👷 Choferes del día{fechaPedidos ? ` · zona del ${zonaDelDia(fechaPedidos) || '—'}` : ''}</h3>
                  <div className="sim-sub" style={{ marginBottom: 6 }}>Cada chofer sale por su zona habitual (aprendida del historial). Si alguien no vino, destildalo y elegí quién cubre su zona. Se comparte en vivo con los demás.</div>
                  {perfiles.filter((p) => !p.mercado).slice(0, 10).map((p) => {
                    const falta = ausentes.includes(p.nombre);
                    return (
                      <div key={p.nombre} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '4px 0' }}>
                        <label style={{ minWidth: 190 }}>
                          <input type="checkbox" checked={!falta}
                            onChange={() => guardarAsig(falta ? ausentes.filter((x) => x !== p.nombre) : [...ausentes, p.nombre], cubre, manual)} /> <b>{p.nombre}</b>
                        </label>
                        <span className="sim-sub">{p.etiqueta}{p.deZonaDelDia ? ' · zona de hoy' : ''}</span>
                        {!falta && ausentes.length > 0 && (
                          <select value={cubre[p.nombre] || ''} onChange={(e) => { const c = { ...cubre }; if (e.target.value) c[p.nombre] = e.target.value; else delete c[p.nombre]; guardarAsig(ausentes, c, manual); }}>
                            <option value="">cubre su propia zona</option>
                            {ausentes.map((a) => <option key={a} value={a}>cubre la zona de {a}</option>)}
                          </select>
                        )}
                        {falta && <span className="sim-warn" style={{ padding: '1px 6px' }}>no vino</span>}
                      </div>
                    );
                  })}
                  {perfiles.length === 0 && <div className="sim-sub">Todavía no hay romaneos cargados para aprender las zonas de los choferes.</div>}
                  {choferesRutas.filter((x) => !x || !x.chofer).length > 0 && <div className="sim-warn" style={{ marginTop: 6 }}>Hay más camiones que choferes disponibles: alguna ruta queda sin chofer.</div>}
                </div>

                <div className="sim-card" style={{ overflowX: 'auto' }}>
                  <h3>Camiones sugeridos (con lo que falta rutear)</h3>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                    <span className="sim-sub">Camiones disponibles:</span>
                    <input type="number" min="0" style={{ width: 64 }} value={params.maxCamiones || 0} onChange={(e) => setParams((p) => ({ ...p, maxCamiones: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))} />
                    <button className="sim-btn" onClick={() => setParams((p) => ({ ...p, maxCamiones: Math.max(0, perfiles.filter((x) => !x.mercado && !ausentes.includes(x.nombre) && x.ultimo >= haceDias(fechaPedidos, 10)).length) }))}>Usar choferes presentes</button>
                    <button className="sim-btn" onClick={() => setParams((p) => ({ ...p, maxCamiones: 0 }))}>Sin tope</button>
                    <span className="sim-sub">Hacen falta {sim.tope ? sim.tope.necesarios : sim.rutas.length} con la carga normal.</span>
                  </div>
                  {sim.tope && sim.tope.ajuste && sim.tope.faltan === 0 && (
                    <div className="sim-warn" style={{ marginBottom: 8 }}>Hacían falta {sim.tope.necesarios} camiones y tenés {sim.tope.max}: para que entre se arma {sim.tope.ajuste}. Revisá la ocupación y los km de cada uno.</div>
                  )}
                  {sim.tope && sim.tope.pendientes.length > 0 && (
                    <div className="sim-warn" style={{ marginBottom: 8 }}>
                      Con {sim.tope.max} camiones no alcanza ni al límite. Quedan sin camión: {sim.tope.pendientes.map((x) => `${x.localidades.map(cap).join(' + ')} (${x.paradas} paradas, ${f0(x.bultos)} bultos)`).join(' · ')}.
                      Opciones: sumar un camión o un utilitario, hacer un segundo viaje, o pasar esos clientes al día siguiente.
                    </div>
                  )}
                  <table className="sim-table">
                    <thead><tr><th>Camión</th><th>Zona</th><th>Chofer</th><th>Paradas</th><th>Bultos</th><th>Pallets</th><th>Ocupación</th><th>Km</th><th>Litros</th><th>Combustible</th><th>Personas</th><th>Recarga</th></tr></thead>
                    <tbody>
                      {sim.rutas.map((r, i) => (
                        <tr key={r.n} className={`click ${rutaSel === i ? 'rsel' : ''}`} onClick={() => setRutaSel(rutaSel === i ? null : i)}>
                          <td><span className="sim-chip" style={{ background: COLORES[i % COLORES.length] }} />#{r.n}</td>
                          <td>{r.localidades.map(cap).join(' + ')}{r.pocaCarga && <span className="sim-warn" style={{ marginLeft: 6, padding: '1px 6px' }} title="Muy poca carga y ningún camión cercano con lugar: conviene postergar o agrupar con otro día">⚠ poca carga</span>}</td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <select value={(choferesRutas[i] && choferesRutas[i].chofer) || ''} title={(choferesRutas[i] && choferesRutas[i].motivo) || ''}
                              onChange={(e) => { const m = { ...manual }; if (e.target.value) m[claveAncla(r)] = e.target.value; else delete m[claveAncla(r)]; guardarAsig(ausentes, cubre, m); }}>
                              <option value="">sin chofer</option>
                              {perfiles.filter((p) => !p.mercado && !ausentes.includes(p.nombre)).map((p) => <option key={p.nombre} value={p.nombre}>{p.nombre}</option>)}
                            </select>
                            {choferesRutas[i] && choferesRutas[i].motivo && !manual[claveAncla(r)] && <div className="sim-sub">{choferesRutas[i].motivo}</div>}
                          </td>
                          <td>{r.paradas.length}</td><td>{f0(r.bultos)}</td><td>{f1(r.pallets)}</td>
                          <td><div className="sim-bar"><i className={r.ocupacion > 0.8 ? 'alto' : r.ocupacion < 0.4 ? 'bajo' : ''} style={{ width: `${Math.min(100, r.ocupacion * 100)}%` }} /></div></td>
                          <td>{f0(r.km)}{r.kmCalle ? ' 🛣️' : ''}</td><td>{f1(r.litros)}{r.utilitario ? ' (util.)' : ''}</td><td>{money(r.combustible)}</td>
                          <td>{r.personas}</td>
                          <td>{r.recargas ? (r.alertaRecarga ? <span className="sim-warn" style={{ padding: '1px 6px' }} title={`Más de ${params.maxConRecarga} bultos con recarga: revisar`}>1 ⚠ revisar</span> : '1') : `no (≤${r.limiteRecarga})`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="sim-sub" style={{ marginTop: 8 }}>Tocá un camión para verlo solo en el mapa (puntos numerados en orden de visita). 🛣️ = km medidos por calles; sin eso, se estima con km en línea recta × factor de ruta ({params.factorRuta})
                    {factorCal ? <> · calibrado con tu historial: {factorCal}</> : null}.</div>
                </div>
                <div className="sim-card" style={{ overflowX: 'auto' }}>
                  <h3>Resumen por localidad y costo de combustible</h3>
                  <table className="sim-table">
                    <thead><tr><th>Localidad</th><th>Camiones</th><th>Clientes</th><th>Bultos</th><th>Km</th><th>Litros</th><th>Combustible</th><th>$/cliente</th><th>$/bulto</th><th>Recargas</th></tr></thead>
                    <tbody>
                      {resumenLoc.map((o) => (
                        <tr key={o.loc}><td>{cap(o.loc)}</td><td>{o.camiones}</td><td>{o.clientes}</td><td>{f0(o.bultos)}</td><td>{f0(o.km)}</td><td>{f1(o.litros)}</td>
                          <td>{money(o.combustible)}</td><td>{money(o.combustible / (o.clientes || 1))}</td><td>{money(o.combustible / (o.bultos || 1))}</td><td>{o.recargas}</td></tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="sim-sub" style={{ marginTop: 8 }}>Km de cada localidad = parte de la ruta según sus bultos. El costo de cada camión usa la estación elegida abajo.</div>
                </div>
                {sim.totales.litros > 0 && (
                <div className="sim-card">
                  <h3>⛽ ¿Dónde conviene cargar? ({f0(sim.totales.litros)} L del reparto)</h3>
                  <TarjetasMarcas litros={sim.totales.litros} km={sim.totales.km} bultos={sim.totales.bultos} clientes={sim.totales.clientes} params={params}
                    onElegir={(marca, precio) => setParams((p) => ({ ...p, marca, precioDiesel: precio }))} />
                  <div className="sim-sub" style={{ marginTop: 8 }}>Precios de la planilla (Secretaría de Energía; YPF es manual y puede estar desactualizado). Elegí una tarjeta para que el costo por camión use ese precio.</div>
                </div>
                )}
                <div className="sim-card">
                  <h3>Parámetros (ajustables)</h3>
                  <div className="sim-params">
                    {[['bultosPorPallet', 'Bultos por pallet'], ['palletsPorCamion', 'Pallets por camión'], ['llenado', 'Llenado objetivo (0–1)'],
                      ['factorRuta', 'Factor de ruta'], ['consumoCamion', 'Consumo camión (L/100 km)'], ['consumoUtil', 'Consumo utilitario (L/100 km)'],
                      ['ayudantesPorCamion', 'Ayudantes por camión'], ['limiteRecarga2', 'Sin recarga hasta (2 pers.)'], ['limiteRecarga3', 'Sin recarga hasta (3 pers.)'], ['maxCamiones', 'Camiones disponibles (0 = sin tope)'], ['maxParadas', 'Máx. paradas por camión'], ['radioAgrupKm', 'Juntar zonas hasta (km)']].map(([k, et]) => (
                      <label key={k}>{et}
                        <input type="number" step="any" value={params[k]} onChange={(e) => setParams((p) => ({ ...p, [k]: Number(e.target.value) }))} />
                      </label>
                    ))}
                    {factorCal && <button className="sim-btn" onClick={() => setParams((p) => ({ ...p, factorRuta: factorCal }))}>Usar factor del historial ({factorCal})</button>}
                  </div>
                  <div className="sim-sub" style={{ marginTop: 10 }}>
                    Modelo probado con 17 días reales del ruteador (23/10 al 14/11): pallets con ±2 % de error, camiones dentro de ±1 en 15 de 17 días
                    y km sin sesgo (mediana 1,00; por día varía). Es una estimación: el ruteador real optimiza con horarios y recargas que acá no se conocen.
                  </div>
                </div>
              </>
            )
          ) : (
            !diaSel ? <div className="sim-card sim-empty">Elegí un día azul del calendario para ver el romaneo del ruteador.</div> :
            !diaDatos ? <div className="sim-card sim-empty">Cargando {diaSel}…</div> : (
              <>
                <div className="sim-card">
                  <h3>{diaSel === hoyISO ? '🚚 Repartiendo hoy' : 'Romaneo'} · {fechaLarga(diaSel)}</h3>
                  <div className="sim-kpis">
                    <div className="sim-kpi"><b>{diaDatos.rutas.length}</b><span>Rutas</span></div>
                    <div className="sim-kpi"><b>{f0(resumenDia.paradas)}</b><span>Paradas</span></div>
                    <div className="sim-kpi"><b>{f0(resumenDia.bultos)}</b><span>Bultos</span></div>
                    <div className="sim-kpi"><b>{f1(resumenDia.pallets)}</b><span>Pallets</span></div>
                    <div className="sim-kpi"><b>{f0(resumenDia.km)}</b><span>Km</span></div>
                    {costoDia && <div className="sim-kpi"><b>{money(costoDia.combustible)}</b><span>Combustible ({f0(costoDia.litros)} L)</span></div>}
                    {costoDia && <div className="sim-kpi"><b>{costoDia.recargas}</b><span>Recargas</span></div>}
                    {cruceDia && <div className="sim-kpi"><b>{f0(cruceDia.total.b)}</b><span>Bultos reales (rechazos)</span></div>}
                    {cruceDia && <div className="sim-kpi"><b>{f0(cruceDia.total.r)}</b><span>Rechazados{cruceDia.total.b ? ` (${f1(cruceDia.total.r / cruceDia.total.b * 100)} %)` : ''}</span></div>}
                  </div>
                  {puedeVerRechazos && rechDia && rechDia.length === 0 && <div className="sim-sub" style={{ marginTop: 8 }}>No hay rechazos cargados para este día (se cargan en 📂 Importar).</div>}
                </div>
                {costoDia && (
                  <div className="sim-card">
                    <h3>⛽ ¿Dónde conviene cargar? ({f0(costoDia.litros)} L del día)</h3>
                    <TarjetasMarcas litros={costoDia.litros} km={resumenDia.km} bultos={resumenDia.bultos} clientes={resumenDia.paradas} params={params}
                      onElegir={(marca, precio) => setParams((p) => ({ ...p, marca, precioDiesel: precio }))} />
                  </div>
                )}
                <div className="sim-card" style={{ overflowX: 'auto' }}>
                  <h3>Rutas del día</h3>
                  <table className="sim-table">
                    <thead><tr><th>Ruta</th><th>Chofer</th><th>Vehículo</th><th>Paradas</th><th>Bultos plan</th><th>Pallets</th><th>Ocupación</th><th>Km</th><th>Combustible</th><th>Recarga</th><th>Horario</th>{cruceDia && <><th>Bultos reales</th><th>Rechazados</th></>}</tr></thead>
                    <tbody>
                      {diaDatos.rutas.map((r, i) => (
                        <tr key={i} className={`click ${rutaSel === i ? 'rsel' : ''}`} onClick={() => setRutaSel(rutaSel === i ? null : i)}>
                          <td><span className="sim-chip" style={{ background: COLORES[i % COLORES.length] }} />{i + 1}</td>
                          <td>{r.chofer}</td><td>{r.veh}</td><td>{r.entregas}</td><td>{f0(r.bultos)}</td><td>{f1(r.pallets)}</td>
                          <td><div className="sim-bar"><i className={r.cap && r.pallets / r.cap > 0.8 ? 'alto' : r.cap && r.pallets / r.cap < 0.4 ? 'bajo' : ''} style={{ width: `${Math.min(100, r.cap ? (r.pallets / r.cap) * 100 : 0)}%` }} /></div></td>
                          <td>{f1(r.km)}</td><td>{costoDia ? money(costoDia.rutas[i].combustible) : '—'}</td>
                          <td>{costoDia ? (costoDia.rutas[i].recargas ? (costoDia.rutas[i].alertaRecarga ? '1 ⚠' : '1') : 'no') : '—'}</td><td>{hhmm(r.ini)}–{hhmm(r.fin)}</td>
                          {cruceDia && <><td>{cruceDia.rutas[i].clientes ? f0(cruceDia.rutas[i].b) : '—'}</td><td>{cruceDia.rutas[i].clientes ? f0(cruceDia.rutas[i].r) : '—'}</td></>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {cruceDia && <div className="sim-sub" style={{ marginTop: 8 }}>Bultos reales y rechazados: salen de los rechazos que ya cargaste en la app, cruzados por código de cliente con las paradas de cada ruta.</div>}
                </div>
              </>
            )
          )}
        </div>
      </div>
    </div>
  );
}

export default TSimulacion;
