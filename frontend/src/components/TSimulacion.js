// components/TSimulacion.js — Calendario de romaneo + simulación de reparto en vivo.
// Carga perezosa (lazy) desde App.js: MapLibre solo se descarga al abrir esta pestaña.
// El romaneo y la maestra de clientes se suben desde la pestaña Importar (CargaRuteo).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { apiFetch, suscribirRuteo } from '../api/client';
import {
  PARAMS_DEFAULT, parsePedidos, construirUbicaciones, calibrarFactor, simular, diffPedidos,
  indexarRechazos, cruzarRechazos, resumenRuteados,
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
      if (ev === 'dia') { cacheDias.current.delete(info.fecha); cargarLista(); setDiaSel((s) => { if (s === info.fecha) cargarDia(s); return s; }); }
    }, setEnVivo);
    return parar;
  }, [cargarPedidos, cargarUbic, cargarLista, cargarDia]);
  useEffect(() => {
    if (enVivo) return undefined;
    const t = setInterval(cargarPedidos, 20000); return () => clearInterval(t);
  }, [enVivo, cargarPedidos]);

  const fechaPedidos = pedidos?.data?.fechaEntrega;
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
    return simular({ clientes: pedidos.data.clientes }, ubic, params);
  }, [pedidos, ubic, params]);

  // Rutas de la simulación con la geometría real por calles (si ya se calculó) y sus km
  const rutasSimMapa = useMemo(() => (simBase ? simBase.rutas.map((r, i) => {
    const puntos = r.paradas.map((p, k) => ({ lat: p.lat, lon: p.lon, seq: k + 1, titulo: p.n,
      detalle: `Cód. ${p.c} · ${f1(p.b)} bultos · ${f1(p.pallets)} pallets · ${cap(p.loc)}` }));
    return { color: COLORES[i % COLORES.length], label: `Camión ${r.n} · ${r.localidades.map(cap).join(' + ')}`, puntos,
      geom: callesOn ? calles[claveRuta(params.deposito, puntos)]?.coords : null };
  }) : []), [simBase, calles, callesOn, params.deposito]);

  const sim = useMemo(() => {
    if (!simBase) return null;
    let conCalle = 0;
    const rutas = simBase.rutas.map((r, i) => {
      const c = callesOn ? calles[claveRuta(params.deposito, rutasSimMapa[i].puntos)] : null;
      if (!c) return { ...r, kmCalle: false };
      conCalle++; const litros = c.km * params.consumoLKm;
      return { ...r, km: c.km, litros, combustible: litros * params.precioDiesel, kmCalle: true, min: c.min };
    });
    const sum = (k) => rutas.reduce((s, r) => s + r[k], 0);
    return { ...simBase, rutas, conCalle, totales: { ...simBase.totales, km: sum('km'), litros: sum('litros'), combustible: sum('combustible') } };
  }, [simBase, calles, callesOn, params, rutasSimMapa]);

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
    const map = crearMapa(mapDiv.current, params.deposito, () => setBaseFallo(true)); mapRef.current = map;
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
      {baseFallo && <div className="sim-warn">No pude cargar el mapa de fondo (sin internet o servicio caído). Los puntos y las rutas se ven igual; probá cambiar de vista para reintentar.</div>}

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
                    <div className="sim-kpi"><b>{money(sim.totales.combustible)}</b><span>Combustible</span></div>
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

                <div className="sim-card" style={{ overflowX: 'auto' }}>
                  <h3>Camiones sugeridos (con lo que falta rutear)</h3>
                  <table className="sim-table">
                    <thead><tr><th>Camión</th><th>Zona</th><th>Paradas</th><th>Bultos</th><th>Pallets</th><th>Ocupación</th><th>Km</th><th>Combustible</th></tr></thead>
                    <tbody>
                      {sim.rutas.map((r, i) => (
                        <tr key={r.n} className={`click ${rutaSel === i ? 'rsel' : ''}`} onClick={() => setRutaSel(rutaSel === i ? null : i)}>
                          <td><span className="sim-chip" style={{ background: COLORES[i % COLORES.length] }} />#{r.n}</td>
                          <td>{r.localidades.map(cap).join(' + ')}{r.pocaCarga && <span className="sim-warn" style={{ marginLeft: 6, padding: '1px 6px' }} title="Muy poca carga y ningún camión cercano con lugar: conviene postergar o agrupar con otro día">⚠ poca carga</span>}</td>
                          <td>{r.paradas.length}</td><td>{f0(r.bultos)}</td><td>{f1(r.pallets)}</td>
                          <td><div className="sim-bar"><i className={r.ocupacion > 0.8 ? 'alto' : r.ocupacion < 0.4 ? 'bajo' : ''} style={{ width: `${Math.min(100, r.ocupacion * 100)}%` }} /></div></td>
                          <td>{f0(r.km)}{r.kmCalle ? ' 🛣️' : ''}</td><td>{money(r.combustible)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="sim-sub" style={{ marginTop: 8 }}>Tocá un camión para verlo solo en el mapa (puntos numerados en orden de visita). 🛣️ = km medidos por calles; sin eso, se estima con km en línea recta × factor de ruta ({params.factorRuta})
                    {factorCal ? <> · calibrado con tu historial: {factorCal}</> : null}.</div>
                </div>
                <div className="sim-card">
                  <h3>Parámetros (ajustables)</h3>
                  <div className="sim-params">
                    {[['bultosPorPallet', 'Bultos por pallet'], ['palletsPorCamion', 'Pallets por camión'], ['llenado', 'Llenado objetivo (0–1)'],
                      ['factorRuta', 'Factor de ruta'], ['consumoLKm', 'Consumo (L/km)'], ['precioDiesel', 'Gasoil ($/L)'],
                      ['ayudantesPorCamion', 'Ayudantes por camión'], ['maxParadas', 'Máx. paradas por camión'], ['radioAgrupKm', 'Juntar zonas hasta (km)']].map(([k, et]) => (
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
                  <h3>Romaneo · {fechaLarga(diaSel)}</h3>
                  <div className="sim-kpis">
                    <div className="sim-kpi"><b>{diaDatos.rutas.length}</b><span>Rutas</span></div>
                    <div className="sim-kpi"><b>{f0(resumenDia.paradas)}</b><span>Paradas</span></div>
                    <div className="sim-kpi"><b>{f0(resumenDia.bultos)}</b><span>Bultos</span></div>
                    <div className="sim-kpi"><b>{f1(resumenDia.pallets)}</b><span>Pallets</span></div>
                    <div className="sim-kpi"><b>{f0(resumenDia.km)}</b><span>Km</span></div>
                    {cruceDia && <div className="sim-kpi"><b>{f0(cruceDia.total.b)}</b><span>Bultos reales (rechazos)</span></div>}
                    {cruceDia && <div className="sim-kpi"><b>{f0(cruceDia.total.r)}</b><span>Rechazados{cruceDia.total.b ? ` (${f1(cruceDia.total.r / cruceDia.total.b * 100)} %)` : ''}</span></div>}
                  </div>
                  {puedeVerRechazos && rechDia && rechDia.length === 0 && <div className="sim-sub" style={{ marginTop: 8 }}>No hay rechazos cargados para este día (se cargan en 📂 Importar).</div>}
                </div>
                <div className="sim-card" style={{ overflowX: 'auto' }}>
                  <h3>Rutas del día</h3>
                  <table className="sim-table">
                    <thead><tr><th>Ruta</th><th>Chofer</th><th>Vehículo</th><th>Paradas</th><th>Bultos plan</th><th>Pallets</th><th>Ocupación</th><th>Km</th><th>Horario</th>{cruceDia && <><th>Bultos reales</th><th>Rechazados</th></>}</tr></thead>
                    <tbody>
                      {diaDatos.rutas.map((r, i) => (
                        <tr key={i} className={`click ${rutaSel === i ? 'rsel' : ''}`} onClick={() => setRutaSel(rutaSel === i ? null : i)}>
                          <td><span className="sim-chip" style={{ background: COLORES[i % COLORES.length] }} />{i + 1}</td>
                          <td>{r.chofer}</td><td>{r.veh}</td><td>{r.entregas}</td><td>{f0(r.bultos)}</td><td>{f1(r.pallets)}</td>
                          <td><div className="sim-bar"><i className={r.cap && r.pallets / r.cap > 0.8 ? 'alto' : r.cap && r.pallets / r.cap < 0.4 ? 'bajo' : ''} style={{ width: `${Math.min(100, r.cap ? (r.pallets / r.cap) * 100 : 0)}%` }} /></div></td>
                          <td>{f1(r.km)}</td><td>{hhmm(r.ini)}–{hhmm(r.fin)}</td>
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
