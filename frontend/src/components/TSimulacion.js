// components/TSimulacion.js — Calendario de romaneo + simulación de reparto en vivo.
// Carga perezosa (lazy) desde App.js: MapLibre solo se descarga al abrir esta pestaña.
// El romaneo y la maestra de clientes se suben desde la pestaña Importar (CargaRuteo).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { apiFetch, suscribirRuteo } from '../api/client';
import { CapaSeleccion } from '../simulacion/seleccion';
import {
  PARAMS_DEFAULT, parsePedidos, construirUbicaciones, calibrarFactor, diffPedidos,
  indexarRechazos, cruzarRechazos, resumenRuteados, costearRuta, comparativaMarcas, resumenPorLocalidad,
  perfilesChoferes, asignarChoferes, zonaDelDia, simularConTope,
  planDesde, planMover, planJuntar, planPartir, planOrdenar, planOrdenAuto, aplicarPlan, construirZonas,
  probarContraDia, clientesEnRutaPropia, ajustarTiempos, minutosRuta,
} from '../simulacion/engine';
import { COLORES, VISTAS, crearMapa, cambiarVista, pintar, encuadrar, largoMaximo, posicionesAnim, pintarCamiones } from '../simulacion/mapa';
import { rutaPorCalles, claveRuta } from '../simulacion/calles';
import { motivoNoLaborable, calcDiasTrabajados } from './diasTrabajados';
import '../simulacion/simulacion.css';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DOW = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const f0 = (n) => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(n || 0);
const f1 = (n) => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(n || 0);
const money = (n) => '$ ' + f0(n);
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hhmm = (m) => (m == null ? '—' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
const fechaLarga = (s) => (s ? new Date(s + 'T12:00:00').toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }) : '');
const hm = (m) => `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')}`;
const cap = (s) => String(s || '').toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

// Próximo día de reparto: salta domingos, feriados nacionales y días cargados como no trabajados en Config.
function proximoDiaHabil(desde = new Date(), extra = []) {
  const d = new Date(desde);
  do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || motivoNoLaborable(iso(d), extra));
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

const normN = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export function TSimulacion({ loggedInUser, cfg, ausencias }) {
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
  // Límites de recarga y de alerta salen de la Configuración de la app (param1/2/3), no de valores fijos.
  const [params, setParams] = useState(() => ({
    ...PARAMS_DEFAULT,
    ...(Number(cfg?.param1) > 0 ? { limiteRecarga2: Number(cfg.param1) } : {}),
    ...(Number(cfg?.param2) > 0 ? { limiteRecarga3: Number(cfg.param2) } : {}),
    ...(Number(cfg?.param3) > 0 ? { maxConRecarga: Number(cfg.param3) } : {}),
  }));
  const diasNoTrab = cfg?.diasNoTrabajados;
  const [factorCal, setFactorCal] = useState(null);
  const [rutaSel, setRutaSel] = useState(null);
  const [diaRuteado, setDiaRuteado] = useState(null);     // romaneo del día de entrega de los pedidos (si ya está cargado)
  const [rechDia, setRechDia] = useState(null);           // rechazos reales del día elegido en el calendario
  const [rechPed, setRechPed] = useState(null);           // rechazos reales del día de entrega de los pedidos

  const asigFn = useRef(null);
  const [datosPrecios, setDatosPrecios] = useState(null);     // respuesta cruda de /combustible (común y premium por marca)
  const [gradoGasoil, setGradoGasoil] = useState('comun');     // 'comun' (Grado 2) o 'premium' (Infinia / V-Power / Quantium)
  const [plan, setPlan] = useState(null);                         // reparto editado a mano (null = automático)
  const [selCli, setSelCli] = useState([]);                       // clientes marcados para mover
  const [abierto, setAbierto] = useState(null);                   // camión con la lista de clientes abierta
  const [fTxt, setFTxt] = useState('');                           // planilla de armado: búsqueda
  const [fEstado, setFEstado] = useState('todos');                // todos | fuera | grandes | camión (id)
  const [fLoc, setFLoc] = useState('');
  const [umbralGrande, setUmbralGrande] = useState(300);          // bultos desde los que un cliente se marca como "grande"
  const [ordenPl, setOrdenPl] = useState({ k: 'b', d: -1 });
  const [aprend, setAprend] = useState({ umbral: 300, procesadas: [], grandes: {} });   // lo aprendido (compartido): qué pasó con los clientes grandes
  const [aprendOk, setAprendOk] = useState(false);
  const [herr, setHerr] = useState('');                           // herramienta de selección sobre el mapa: '' | circulo | lazo | rect
  const [prueba, setPrueba] = useState(null);                     // resultado de probar el motor contra un día real
  const [camionesLoc, setCamionesLoc] = useState({});            // { LOCALIDAD: n } camiones fijados a mano
  const [excluidas, setExcluidas] = useState([]);              // localidades que NO salen el día de entrega
  const [precioInfo, setPrecioInfo] = useState({ estado: 'cargando' });   // de dónde salen los precios del gasoil
  const [hist, setHist] = useState({});                      // romaneos recientes (para aprender la zona de cada chofer)
  const [ausentes, setAusentes] = useState([]);           // choferes que no vinieron
  const [cubre, setCubre] = useState({});                 // { chofer: chofer cuya zona cubre }
  const [manual, setManual] = useState({});               // { clienteAncla: chofer } elegido a mano por ruta
  const asigVer = useRef('');
  const asigPend = useRef({ enviando: false, ultimo: null, enviado: null, t: 0 });   // guardado en orden, sin pisar lo que el usuario recién tocó

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
  const cargarAprend = useCallback(async () => {
    try {
      const r = await apiFetch('/api/ruteo/aprendizaje');
      if (r.data) { setAprend(r.data); if (r.data.umbral) setUmbralGrande(r.data.umbral); }
      setAprendOk(true);
    } catch { /* se reintenta con el próximo evento */ }
  }, []);
  const registrarAprend = useCallback(async (cuerpo) => {
    try {
      const r = await apiFetch('/api/ruteo/aprendizaje', { method: 'PUT', headers: hdr, body: JSON.stringify(cuerpo) });
      if (r.data) setAprend(r.data);
    } catch { /* el aprendizaje es de apoyo: si falla no frena el trabajo */ }
  }, [hdr]);
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

  useEffect(() => { cargarLista(); cargarUbic(); cargarPedidos(); cargarAprend(); }, [cargarLista, cargarUbic, cargarPedidos, cargarAprend]);

  useEffect(() => {
    const parar = suscribirRuteo((ev, info) => {
      if (ev === 'pedidos') cargarPedidos();
      if (ev === 'ubicaciones') cargarUbic();
      if (ev === 'aprendizaje') cargarAprend();
      if (ev === 'asignacion' && asigFn.current) asigFn.current();
      if (ev === 'dia') { cacheDias.current.delete(info.fecha); cargarLista(); setDiaSel((s) => { if (s === info.fecha) cargarDia(s); return s; }); }
    }, setEnVivo);
    return parar;
  }, [cargarPedidos, cargarUbic, cargarLista, cargarDia, cargarAprend]);
  useEffect(() => {
    if (enVivo) return undefined;
    const t = setInterval(cargarPedidos, 20000); return () => clearInterval(t);
  }, [enVivo, cargarPedidos]);

  const fechaPedidos = pedidos?.data?.fechaEntrega;

  // Precios del gasoil: se leen al abrir y con el botón "Actualizar precios" (forzar = saltear la memoria del servidor)
  const leerPrecios = useCallback(async (forzar = false) => {
    setPrecioInfo({ estado: 'cargando' });
    try {
      const r = await apiFetch(`/api/ruteo/combustible${forzar ? '?refrescar=1' : ''}`);
      if (!r.data) throw new Error('Respuesta vacía');
      setPrecioInfo({ estado: 'ok', fuentes: r.data.fuentes || [], fallas: r.data.fallas || [], cache: !!r.cache, aviso: r.aviso || '' });
      setDatosPrecios(r.data);
    } catch (e) { setPrecioInfo({ estado: 'error', error: e.message }); }
  }, []);
  useEffect(() => { leerPrecios(false); }, [leerPrecios]);

  // Precios de las APIs → parámetros de costo (por marca, con la fecha de vigencia y cuántos días tiene)
  useEffect(() => {
    if (!datosPrecios) return;
    const pm = {}, fm = {};
    datosPrecios.marcas.forEach((m) => {
      const g = m[gradoGasoil] || m.comun || m.premium; if (!g) return;
      const sinGrado = !m[gradoGasoil];
      const nombre = /SHELL/.test(m.marca) ? 'Shell' : /AXION/.test(m.marca) ? 'Axion' : /YPF/.test(m.marca) ? 'YPF' : null;
      if (!nombre) return;
      pm[nombre] = Math.round(g.precio);
      const [y, mo, d] = g.fecha.split('-');
      const dias = Math.max(0, Math.round((Date.now() - new Date(`${g.fecha}T12:00:00`)) / 864e5));
      fm[nombre] = `${sinGrado ? `sin dato ${gradoGasoil === 'premium' ? 'premium' : 'común'}, se usa el otro · ` : ''}${d}/${mo}/${y.slice(2)} (hace ${dias} d${dias > 14 ? ' ⚠' : ''}) · ${g.producto || (gradoGasoil === 'premium' ? 'premium' : 'común')} · ${g.origen === 'zona' ? 'zona' : 'Tandil'} · ${g.fuente || 'oficial'}`;
    });
    if (!Object.keys(pm).length) return;
    setParams((p) => {
      const marca = pm[p.marca] ? p.marca : Object.keys(pm)[0];
      return { ...p, preciosMarca: { ...p.preciosMarca, ...pm }, fechasMarca: { ...p.fechasMarca, ...fm }, precioDiesel: pm[marca] || p.precioDiesel, marca };
    });
  }, [datosPrecios, gradoGasoil]);

  // ── Choferes del día (compartido en vivo con el resto de los usuarios) ────
  const cargarAsig = useCallback(async () => {
    try {
      // Si hay un guardado en curso (o recién terminó) no se pisa lo que el usuario acaba de tocar con una lectura vieja.
      if (asigPend.current.enviando || Date.now() - asigPend.current.t < 2500) return;
      const r = await apiFetch('/api/ruteo/asignacion'); const d = r.data;
      if (asigPend.current.enviando) return;
      const ok = d && d.fecha === fechaPedidos;
      const a = ok ? d.ausentes || [] : [], c = ok ? d.cubre || {} : {}, m = ok ? d.manual || {} : {}, ex = ok ? d.excluidas || [] : [], cl = ok ? d.camionesLoc || {} : {}, pl = ok ? d.plan || null : null;
      const k = JSON.stringify([a, c, m, ex, cl, pl]);
      if (k !== asigVer.current) { asigVer.current = k; setAusentes(a); setCubre(c); setManual(m); setExcluidas(ex); setCamionesLoc(cl); setPlan(pl); }
    } catch { /* se reintenta con el próximo evento */ }
  }, [fechaPedidos]);
  asigFn.current = cargarAsig;
  useEffect(() => { cargarAsig(); }, [cargarAsig]);
  const guardarAsig = async (a, c, m, ex = excluidas, cl = camionesLoc, pl = plan) => {
    setAusentes(a); setCubre(c); setManual(m); setExcluidas(ex); setCamionesLoc(cl); setPlan(pl);
    asigVer.current = JSON.stringify([a, c, m, ex, cl, pl]);
    if (!fechaPedidos) return;
    // Los guardados salen de a uno y siempre con lo último elegido, para que no lleguen desordenados al servidor.
    const A = asigPend.current;
    A.ultimo = JSON.stringify({ fecha: fechaPedidos, ausentes: a, cubre: c, manual: m, excluidas: ex, camionesLoc: cl, plan: pl });
    if (A.enviando) return;
    A.enviando = true;
    try {
      while (A.enviado !== A.ultimo) {
        const cuerpo = A.ultimo; A.enviado = cuerpo;
        await apiFetch('/api/ruteo/asignacion', { method: 'PUT', headers: hdr, body: cuerpo });
      }
    } catch (e) { aviso(e.message, 'err'); }
    A.enviando = false; A.t = Date.now();
  };
  useEffect(() => {
    let vivo = true;
    const fechas = lista.map((x) => x.fecha).sort().slice(-30);
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

  // Localidades de los pedidos (según la maestra) con cuántos clientes y bultos tiene cada una
  const locDe = (c) => (ubic.get(c)?.loc || 'SIN LOCALIDAD').toUpperCase();
  const locsPedidos = useMemo(() => {
    const m = new Map();
    (pedidos?.data?.clientes || []).forEach((c) => {
      const k = locDe(c.c); const o = m.get(k) || { loc: k, clientes: 0, bultos: 0, est: 0, ej: [] };
      o.clientes++; o.bultos += c.b; if (ubic.get(c.c)?.locEstimada) o.est++; if (o.ej.length < 12) o.ej.push(`${c.c} ${c.n || ''}`.trim()); m.set(k, o);
    });
    return [...m.values()].sort((a, b) => b.bultos - a.bultos);
  }, [pedidos, ubic]);  // eslint-disable-line react-hooks/exhaustive-deps
  const pedidosSalen = useMemo(() => {
    const ex = new Set(excluidas);
    const todos = pedidos?.data?.clientes || [];
    return { salen: todos.filter((c) => !ex.has(locDe(c.c))), quedan: todos.filter((c) => ex.has(locDe(c.c))) };
  }, [pedidos, ubic, excluidas]);  // eslint-disable-line react-hooks/exhaustive-deps
  const haceDias = (f, n) => { if (!f) return ''; const d = new Date(`${f}T12:00:00`); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
  // Choferes: los del historial de romaneos (con su zona) + los cargados en Config que todavía no tienen historial.
  const notaPrecios = precioInfo.estado === 'ok'
    ? `Precios leídos de ${precioInfo.fuentes.join(' y ') || 'fuente oficial'} (por marca, el de fecha más reciente).${precioInfo.fallas.length ? ` ⚠ Una fuente falló: ${precioInfo.fallas.join(' | ')}.` : ''}`
    : precioInfo.estado === 'error'
      ? `⚠ No se pudo leer el precio actual (${precioInfo.error}). Se muestran los precios fijos del Excel, que pueden estar viejos: reiniciá el backend o revisá que tenga internet.`
      : 'Buscando el precio actual del gasoil…';
  const selGrado = (
    <div className="sim-sub" style={{ marginBottom: 8 }}>Gasoil a comparar:{' '}
      <select value={gradoGasoil} onChange={(e) => setGradoGasoil(e.target.value)}>
        <option value="comun">Común (Grado 2: Diesel 500 / Evolux / Diesel X10)</option>
        <option value="premium">Premium (Infinia Diesel / V-Power Diesel / Quantium Diesel)</option>
      </select>
      {' '}<button className="sim-btn" onClick={() => leerPrecios(true)} disabled={precioInfo.estado === 'cargando'}>🔄 Actualizar precios ahora</button>
      {gradoGasoil === 'premium' && datosPrecios && !datosPrecios.marcas.some((m) => m.premium) && (
        <span className="sim-warn" style={{ marginLeft: 6, padding: '1px 6px' }}>El servidor todavía no devuelve premium: reiniciá el backend.</span>
      )}
    </div>
  );
  const perfiles = useMemo(() => {
    const base = perfilesChoferes(hist, ubic, params.deposito, fechaPedidos);
    const norm = normN;
    const conocidos = new Set(base.map((p) => norm(p.nombre)));
    const deConfig = (cfg?.choferes || []).filter((n) => !conocidos.has(norm(n)))
      .map((n) => ({ nombre: String(n).replace(/\s+/g, ' ').trim(), dias: 0, ultimo: '', etiqueta: 'sin historial de romaneo (Config)', deZonaDelDia: false, mercado: false, soloConfig: true }));
    return [...base, ...deConfig];
  }, [hist, ubic, params.deposito, fechaPedidos, cfg]);
  // Paradas de los romaneos recientes: de acá sale la zona que cada chofer recorre de verdad
  const zonas = useMemo(() => construirZonas(hist), [hist]);
  // Ausencias cargadas en la pestaña Ausencias que cubren el día de entrega (nombre normalizado → motivo)
  const ausAuto = useMemo(() => {
    const m = new Map();
    if (!fechaPedidos) return m;
    (ausencias || []).forEach((a) => {
      if (!a || !a.persona || !a.fechaDesde) return;
      const d = String(a.fechaDesde).slice(0, 10), h = String(a.fechaHasta || a.fechaDesde).slice(0, 10);
      if (d <= fechaPedidos && fechaPedidos <= h) m.set(normN(a.persona), a.motivo || 'Ausencia');
    });
    return m;
  }, [ausencias, fechaPedidos]);
  const ausEf = useMemo(() => [...new Set([...ausentes, ...perfiles.filter((p) => ausAuto.has(normN(p.nombre))).map((p) => p.nombre)])], [ausentes, perfiles, ausAuto]);
  // Personal de Config (choferes + ayudantes, sin repetir) que está presente ese día
  const personalPresente = useMemo(() => {
    const todos = new Map();
    [...(cfg?.choferes || []), ...(cfg?.ayudantes || [])].forEach((n) => todos.set(normN(n), n));
    const aus = new Set([...ausAuto.keys(), ...ausentes.map(normN)]);
    return [...todos.keys()].filter((k) => !aus.has(k)).length;
  }, [cfg, ausAuto, ausentes]);
  const tiempos = useMemo(() => ajustarTiempos(hist), [hist]);       // minutos por parada / km / bulto aprendidos de los romaneos
  const simAuto = useMemo(() => {
    if (!pedidosSalen.salen.length) return null;
    return simularConTope({ clientes: pedidosSalen.salen }, ubic, { ...params, camionesPorLoc: camionesLoc, zonas, fechaObjetivo: fechaPedidos, ausentes: ausEf, cubre, tiempos });
  }, [pedidosSalen, ubic, params, camionesLoc, zonas, fechaPedidos, ausEf, cubre, tiempos]);
  // Con reparto editado a mano manda el plan; si no, la propuesta del motor.
  const simBase = useMemo(() => (simAuto && plan ? aplicarPlan(simAuto, plan, params) : simAuto), [simAuto, plan, params]);

  const claveAncla = (r) => (r.planId ? `p${r.planId}` : String(Math.min(...r.paradas.map((p) => p.c))));
  // Chofer por ruta: lo elegido a mano manda; el resto se asigna por zona habitual (sin repetir choferes).
  const choferesRutas = useMemo(() => {
    if (!simBase) return [];
    const out = simBase.rutas.map((r) => (manual[claveAncla(r)] ? { chofer: manual[claveAncla(r)], motivo: 'elegido a mano' }
      : r.choferZona && !ausEf.includes(r.choferZona) ? { chofer: r.choferZona, motivo: 'reparte esta zona en los romaneos' } : null));
    const libres = simBase.rutas.map((r, i) => i).filter((i) => !out[i]);
    const ocupados = out.filter(Boolean).map((x) => x.chofer);
    const auto = asignarChoferes(libres.map((i) => simBase.rutas[i]), perfiles, [...ausEf, ...ocupados], cubre);
    libres.forEach((i, k) => { out[i] = auto[k]; });
    return out;
  }, [simBase, perfiles, ausEf, cubre, manual]);

  // Rutas de la simulación con la geometría real por calles (si ya se calculó) y sus km
  const rutasSimMapa = useMemo(() => (simBase ? simBase.rutas.map((r, i) => {
    const puntos = r.paradas.map((p, k) => ({ lat: p.lat, lon: p.lon, seq: k + 1, titulo: p.n, cod: p.c, grande: p.b >= umbralGrande,
      detalle: `Cód. ${p.c} · ${f1(p.b)} bultos · ${f1(p.pallets)} pallets · ${cap(p.loc)}` }));
    return { color: COLORES[i % COLORES.length], label: `Camión ${r.n} · ${r.localidades.map(cap).join(' + ')}${choferesRutas[i] && choferesRutas[i].chofer ? ` · ${choferesRutas[i].chofer}` : ''}`, puntos,
      geom: callesOn ? calles[claveRuta(params.deposito, puntos)]?.coords : null };
  }) : []), [simBase, calles, callesOn, params.deposito, choferesRutas, umbralGrande]);

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

  // Costo de personal del día: sueldo mensual de Config (o el del mes en "paramXMes") ÷ días trabajados del mes
  // (lunes a sábado sin feriados ni días no trabajados), igual que el resto de la app.
  const costoPers = useMemo(() => {
    if (!sim || !fechaPedidos) return null;
    const mes = fechaPedidos.slice(0, 7), pm = (cfg?.paramXMes || {})[mes] || {};
    const ch = Number(pm.costoChofer ?? cfg?.costoChofer) || 0, ay = Number(pm.costoAyudante ?? cfg?.costoAyudante) || 0;
    const [y, m] = mes.split('-').map(Number);
    const ultimo = new Date(y, m, 0).getDate();
    const dias = calcDiasTrabajados(`${mes}-01`, `${mes}-${String(ultimo).padStart(2, '0')}`, (cfg?.diasNoTrabajados || []).map((d) => d.fecha)) || 26;
    const de = (personas) => (ch + Math.max(0, personas - 1) * ay) / dias;
    const porRuta = sim.rutas.map((r) => de(r.personas));
    return { porRuta, total: porRuta.reduce((s, x) => s + x, 0), dias, ch, ay };
  }, [sim, fechaPedidos, cfg]);
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
  // Clientes que quedan fuera del reparto (con ubicación): se ven como círculos huecos y se pueden tildar desde el mapa
  const fueraMapa = useMemo(() => {
    if (modo !== 'simulacion' || !simBase) return [];
    const out = [];
    ((simBase.pendEdit && simBase.pendEdit.clientes) || []).forEach((p) => out.push({ lat: p.lat, lon: p.lon, cod: p.c, titulo: p.n, detalle: `Cód. ${p.c} · ${f1(p.b)} bultos · ${cap(p.loc)} · otro día` }));
    pedidosSalen.quedan.forEach((p) => { const u = ubic.get(p.c); if (u) out.push({ lat: u.lat, lon: u.lon, cod: p.c, titulo: p.n || String(p.c), detalle: `Cód. ${p.c} · ${f1(p.b)} bultos · ${cap(locDe(p.c))} · localidad fuera`, bloq: true }); });
    return out;
  }, [modo, simBase, pedidosSalen, ubic]);  // eslint-disable-line react-hooks/exhaustive-deps
  const onPuntoRef = useRef(null);
  onPuntoRef.current = (p) => { const c = Number(p && p.cod); if (c) setSelCli((a) => (a.includes(c) ? a.filter((x) => x !== c) : [...a, c])); };
  const redibujar = useCallback(() => {
    const map = mapRef.current; if (!map || !datosMapa.current) return;
    pintar(map, datosMapa.current, (p) => { if (onPuntoRef.current) onPuntoRef.current(p); });
  }, []);
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    datosMapa.current = { deposito: params.deposito, rutas: rutasMapa, etiquetas, soloRuta: rutaSel, fuera: fueraMapa, marcados: modo === 'simulacion' ? selCli : [] };
    redibujar();
  }, [rutasMapa, etiquetas, rutaSel, params.deposito, redibujar, fueraMapa, selCli, modo]);
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
  // Los pedidos de un día de entrega se arman por CAPAS: una por cada fecha de pedido (el Excel de Chess no trae la fecha
  // de cada pedido, la indica quien lo sube). El total por cliente es la suma de todas las capas.
  //   · Subir pedidos del día      → reemplaza la capa de esa fecha de pedido (volver a subir el mismo día no duplica).
  //   · Sumar otro archivo         → agrega clientes a esa misma capa (otra zona del mismo día, ej. Las Flores y zona).
  const capasDe = (p, fechaEntrega) => (p && p.fechaEntrega === fechaEntrega
    ? (p.capas || (p.clientes && p.clientes.length ? { '': { archivo: p.archivo, clientes: p.clientes } } : {})) : {});
  const totalCapas = (capas) => {
    const m = new Map();
    Object.keys(capas).sort().forEach((k) => capas[k].clientes.forEach((c) => {
      const a = m.get(c.c);
      if (!a) m.set(c.c, { ...c });
      else m.set(c.c, { ...a, n: a.n || c.n, b: Math.round((a.b + c.b) * 100) / 100, p: (a.p || 0) + (c.p || 0), neto: (a.neto || 0) + (c.neto || 0) });
    }));
    return [...m.values()];
  };
  const subirPedidos = async (file, fechaEntrega, fechaPedido, sumar = false) => {
    const capas0 = capasDe(pedidos?.data, fechaEntrega);
    if (!sumar && capas0[fechaPedido] &&
        !window.confirm(`Ya cargaste pedidos con fecha ${fechaLarga(fechaPedido)} (${capas0[fechaPedido].archivo}).\n\n¿Reemplazarlos por este archivo?\nSi es el otro archivo del mismo día (por ejemplo Las Flores), cancelá y usá «Sumar otro archivo».`)) return;
    setOcupado(true);
    try {
      const wb = XLSX.read(await leerArchivo(file), { type: 'array' });
      const m = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
      await guardarPedidos(parsePedidos(m), file.name, fechaEntrega, sumar, fechaPedido);
    } catch (e) { aviso(e.message, 'err'); }
    setOcupado(false);
  };

  const guardarPedidos = async (ped, archivoNombre, fechaEntrega, sumar, fechaPedido, quitar = false) => {
    const previo = pedidos?.data;
    const mismo = !!previo && previo.fechaEntrega === fechaEntrega;
    const snap = previo ? previo.clientes.map((c) => [c.c, c.b, c.n]) : null;
    const anterior = previo ? { archivo: previo.archivo, cargadoEn: pedidos.updatedAt, clientes: snap } : null;
    const capas = { ...capasDe(previo, fechaEntrega) };
    const act = capas[fechaPedido];
    const nueva = !act;
    if (quitar) delete capas[fechaPedido];
    else if (sumar && act) {
      const m = new Map(act.clientes.map((c) => [c.c, c]));
      ped.clientes.forEach((c) => m.set(c.c, c));               // un cliente repetido en la misma fecha no se duplica
      capas[fechaPedido] = { archivo: (act.archivo || '').split(' + ').includes(archivoNombre) ? act.archivo : `${act.archivo} + ${archivoNombre}`.slice(0, 200), clientes: [...m.values()] };
    } else capas[fechaPedido] = { archivo: archivoNombre, clientes: ped.clientes };
    const clientes = totalCapas(capas);
    const archivo = [...new Set(Object.keys(capas).sort().map((k) => capas[k].archivo))].join(' + ').slice(0, 200) || archivoNombre;
    // "base" = primera carga del día de entrega: permite saber qué pedidos ya se ruteó y salieron de la lista.
    // Al sumar pedidos nuevos (otra zona u otra fecha) la base sube con ellos; al reemplazar una capa queda como estaba.
    let base = mismo ? (previo.base || snap) : null;
    if (mismo && !quitar && (sumar || nueva)) {
      const tot = new Map(clientes.map((c) => [c.c, c]));
      const bm = new Map((base || snap || []).map((r) => [r[0], r]));
      ped.clientes.forEach((c) => { const t = tot.get(c.c); bm.set(c.c, [c.c, t ? t.b : c.b, c.n]); });
      base = [...bm.values()];
    }
    await apiFetch('/api/ruteo/pedidos', { method: 'PUT', headers: hdr,
      body: JSON.stringify({ archivo, fechaEntrega, clientes, anterior, base, capas }) });
    const totB = clientes.reduce((s, c) => s + c.b, 0);
    aviso(`${quitar ? 'Quitado' : sumar ? 'Sumado' : 'Pedidos cargados'}: ${clientes.length} clientes, ${f0(totB)} bultos para el ${fechaLarga(fechaEntrega)} (${Object.keys(capas).length} fecha${Object.keys(capas).length === 1 ? '' : 's'} de pedido). Todos los usuarios con acceso lo ven al instante.`);
    await cargarPedidos();
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

  const [fechaNueva, setFechaNueva] = useState(() => proximoDiaHabil(new Date(), cfg?.diasNoTrabajados));
  const [fechaPed, setFechaPed] = useState(() => iso(new Date()));       // fecha en que se hicieron los pedidos del archivo
  const refPed2 = useRef(null);
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

  const tarjetaLocs = (
      <div className="sim-card">
        <h3>📍 Localidades que salen{fechaPedidos ? ` el ${fechaLarga(fechaPedidos)}` : ''}</h3>
        <div className="sim-sub" style={{ marginBottom: 6 }}>Destildá las localidades que ese día no se reparten (por ejemplo Cachari si se va el miércoles). Se sacan de la simulación y se avisa cuántos clientes y bultos quedan para otro día. Al lado de cada una podés fijar cuántos camiones salen (por ejemplo 2 a Las Flores); vacío = lo calcula solo. Se comparte en vivo.</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
          {locsPedidos.map((o) => (
            <label key={o.loc} style={{ minWidth: 200 }} title={o.loc === 'SIN LOCALIDAD' ? `Clientes que no están en la maestra o no tienen localidad y no hay vecinos cerca para estimarla. Ej.: ${o.ej.join(' · ')}` : (o.est ? `${o.est} clientes no están en la maestra: se les estimó la localidad por los vecinos más cercanos.` : undefined)}>
              <input type="checkbox" checked={!excluidas.includes(o.loc)}
                onChange={() => guardarAsig(ausentes, cubre, manual, excluidas.includes(o.loc) ? excluidas.filter((x) => x !== o.loc) : [...excluidas, o.loc])} /> <b>{cap(o.loc)}</b> <span className="sim-sub">{o.clientes} cl. · {f0(o.bultos)} bultos{o.est ? ` · ${o.est} estimados` : ''}{o.loc === 'SIN LOCALIDAD' ? ' · no están en la maestra' : ''}</span>
              {!excluidas.includes(o.loc) && (
                <> <input type="number" min="0" max="20" step="1" placeholder="auto" title="Camiones para esta localidad (vacío = automático)"
                  style={{ width: 54 }} value={camionesLoc[o.loc] || ''}
                  onChange={(e) => { const n = Math.floor(Number(e.target.value)) || 0; const cl = { ...camionesLoc }; if (n > 0) cl[o.loc] = Math.min(20, n); else delete cl[o.loc]; guardarAsig(ausentes, cubre, manual, excluidas, cl); }} /> <span className="sim-sub">camiones</span></>
              )}
            </label>
          ))}
        </div>
        {pedidosSalen.quedan.length > 0 && (
          <div className="sim-warn" style={{ marginTop: 6 }}>
            Quedan para otro día: {pedidosSalen.quedan.length} clientes · {f0(pedidosSalen.quedan.reduce((s, c) => s + c.b, 0))} bultos ({excluidas.map(cap).join(', ')}).
          </div>
        )}
      </div>
  );


  // ── Edición manual del reparto (sobre la propuesta del motor) ─────────────
  const guardarPlan = (pl) => guardarAsig(ausentes, cubre, manual, excluidas, camionesLoc, pl);
  const moverA = (cods, v) => {
    if (!v || !sim || !cods.length) return;
    // Decisión sobre clientes grandes (sale / queda fuera): se guarda para sugerirla la próxima vez.
    const dePend = new Set(((sim.pendEdit && sim.pendEdit.clientes) || []).map((p) => p.c));
    const porCod = new Map(); sim.rutas.forEach((r) => r.paradas.forEach((p) => porCod.set(p.c, p))); ((sim.pendEdit && sim.pendEdit.clientes) || []).forEach((p) => porCod.set(p.c, p));
    const ev = cods.map((c) => porCod.get(c)).filter((p) => p && p.b >= umbralGrande && ((v === 'pend') !== dePend.has(p.c)))
      .map((p) => ({ c: p.c, n: p.n, d: v === 'pend' ? 'fuera' : 'sale', f: fechaPedidos || iso(new Date()) }));
    if (ev.length) registrarAprend({ eventos: ev });
    guardarPlan(planMover(plan || planDesde(simAuto), cods, v === 'nuevo' || v === 'pend' ? v : Number(v)));
    setSelCli((s) => s.filter((c) => !cods.includes(c)));
  };
  const pidDe = (r, i) => (r.planId != null ? r.planId : i + 1);        // id de camión (sin plan editado = su posición)
  // Puntos del mapa que se pueden elegir con círculo / lazo / rectángulo (los de una localidad que no sale no se mueven)
  const puntosElegibles = () => {
    const d = datosMapa.current; if (!d) return [];
    const out = [];
    (d.rutas || []).forEach((r, i) => { if (d.soloRuta != null && d.soloRuta !== i) return; r.puntos.forEach((p) => { if (p.cod) out.push({ cod: p.cod, lon: p.lon, lat: p.lat }); }); });
    (d.fuera || []).forEach((p) => { if (p.cod && !p.bloq) out.push({ cod: p.cod, lon: p.lon, lat: p.lat }); });
    return out;
  };
  const alSeleccionar = (cods, suma) => {
    setHerr('');
    setSelCli((a) => (suma ? [...new Set([...a, ...cods])] : cods));
  };
  const opcionesDestino = (idExcluir) => (
    <>
      {sim && sim.rutas.filter((x) => x.planId !== idExcluir).map((x) => <option key={x.planId} value={x.planId}>Camión #{x.n} · {x.localidades.map(cap).join(' + ')}</option>)}
      <option value="nuevo">➕ Camión nuevo</option>
      <option value="pend">📅 Otro día</option>
    </>
  );

  // ── Jornada estimada por camión (plano de horas): conducción + paradas, con el modelo aprendido de los romaneos ──
  const tarjetaJornada = sim && (() => {
    const filas = sim.rutas.map((r, i) => {
      const base = tiempos.base, cond = tiempos.porKm * r.km, serv = tiempos.porParada * r.paradas.length + tiempos.porBulto * r.bultos;
      return { r, i, base, cond, serv, tot: base + cond + serv };
    });
    const esc = Math.max(tiempos.limite * 1.15, ...filas.map((x) => x.tot), 600);
    const pct = (m) => `${(m / esc) * 100}%`;
    return (
      <div className="sim-card">
        <h3>🕒 Jornada estimada por camión</h3>
        <div className="sim-sub" style={{ marginBottom: 8 }}>
          {tiempos.ajustado
            ? <>Aprendido de {tiempos.n} rutas reales: {f1(tiempos.porParada)} min por parada, {f0(tiempos.porKm * 100)} min cada 100 km y {f1(tiempos.porBulto * 100)} min cada 100 bultos (error medio ±{f0(tiempos.mae)} min). El 90 % de las jornadas reales dura menos de {hm(tiempos.limite)}.</>
            : <>Con valores típicos de Beer Tan: faltan romaneos para aprender los tiempos reales.</>}
        </div>
        {filas.map((x) => (
          <div key={x.i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <div style={{ width: 210, fontSize: 13 }}><span className="sim-chip" style={{ background: COLORES[x.i % COLORES.length] }} /> #{x.r.n} {(choferesRutas[x.i] && choferesRutas[x.i].chofer) || 'sin chofer'}</div>
            <div style={{ position: 'relative', flex: 1, height: 18, background: '#eef1f7', borderRadius: 4, overflow: 'hidden' }} title={`Salida y carga ${f0(x.base)} min · conducción ${f0(x.cond)} min · paradas ${f0(x.serv)} min`}>
              <div style={{ position: 'absolute', left: 0, width: pct(x.base), top: 0, bottom: 0, background: '#b0bec5' }} />
              <div style={{ position: 'absolute', left: pct(x.base), width: pct(x.cond), top: 0, bottom: 0, background: '#5c8dd6' }} />
              <div style={{ position: 'absolute', left: pct(x.base + x.cond), width: pct(x.serv), top: 0, bottom: 0, background: '#66bb6a' }} />
              <div style={{ position: 'absolute', left: pct(tiempos.limite), width: 2, top: 0, bottom: 0, background: '#c62828' }} />
            </div>
            <div style={{ width: 150, fontSize: 13, color: x.tot > tiempos.limite ? '#c62828' : undefined }}><b>{hm(x.tot)}</b> · {x.r.paradas.length} par. · {f0(x.r.km)} km{x.tot > tiempos.limite ? ' ⚠ larga' : ''}</div>
          </div>
        ))}
        <div className="sim-sub">▮ gris: salida y carga · ▮ azul: conducción · ▮ verde: paradas · ┃ rojo: límite habitual. Si un camión se pasa, sumá un camión o pasá clientes a otro desde la planilla.</div>
      </div>
    );
  })();

  // ── Planilla de armado (como el listado de ruteo de Chess): todos los clientes con tilde, camión y estado ──
  // Aprende de lo que realmente pasó: cuando ya está el romaneo del día de entrega, los clientes grandes del pedido
  // que fueron en una ruta normal "salieron" y los que se llevaron aparte (mercados, terceros) o no fueron "quedaron fuera".
  useEffect(() => {
    const base = pedidos && pedidos.data && pedidos.data.base;
    if (!aprendOk || !diaRuteado || !base || !fechaPedidos || (aprend.procesadas || []).includes(fechaPedidos)) return;
    const normales = clientesEnRutaPropia(diaRuteado);
    const ev = base.filter(([, b]) => b >= umbralGrande).map(([c, , n]) => ({ c, n, d: normales.has(c) ? 'sale' : 'fuera', real: true, f: fechaPedidos }));
    registrarAprend({ eventos: ev, fechaReal: fechaPedidos });
  }, [aprendOk, diaRuteado, pedidos, fechaPedidos, aprend.procesadas, umbralGrande, registrarAprend]);
  const habitual = (c) => {      // lo que suele pasar con este cliente grande: 'fuera' | 'sale' | null (sin historial)
    const h = aprend.grandes && aprend.grandes[c]; if (!h) return null;
    const f = (h.f || 0) + (h.df || 0), sl = (h.s || 0) + (h.ds || 0);
    return f === sl ? null : (f > sl ? 'fuera' : 'sale');
  };

  const tarjetaPlanilla = sim && (() => {
    const pid = (r, i) => (r.planId != null ? r.planId : i + 1);   // sin plan editado, el id de camión es su posición (igual que planDesde)
    const filas = [];
    sim.rutas.forEach((r, i) => r.paradas.forEach((p) => filas.push({ c: p.c, n: p.n, lat: p.lat, lon: p.lon, loc: p.loc || 'SIN LOCALIDAD', b: p.b, pal: p.pallets, cam: pid(r, i), nCam: r.n, ch: (choferesRutas[i] && choferesRutas[i].chofer) || '', ord: 0 })));
    ((sim.pendEdit && sim.pendEdit.clientes) || []).forEach((p) => filas.push({ c: p.c, n: p.n, lat: p.lat, lon: p.lon, loc: p.loc || 'SIN LOCALIDAD', b: p.b, pal: p.pallets, cam: 'pend', nCam: 0, ch: '' }));
    (sim.sinUbicacion || []).forEach((p) => filas.push({ c: p.c, n: p.n, loc: 'SIN UBICACIÓN', b: p.b, pal: p.pallets || 0, cam: 'sinub', nCam: 0, ch: '' }));
    pedidosSalen.quedan.forEach((p) => filas.push({ c: p.c, n: p.n, loc: locDe(p.c), b: p.b, pal: 0, cam: 'loc', nCam: 0, ch: '' }));
    const grande = (f) => f.b >= umbralGrande;
    const q = fTxt.trim().toLowerCase();
    const vis = filas.filter((f) => (!q || `${f.c} ${f.n} ${f.loc}`.toLowerCase().includes(q)) && (!fLoc || f.loc === fLoc)
      && (fEstado === 'todos' || (fEstado === 'fuera' ? (f.cam === 'pend' || f.cam === 'loc') : fEstado === 'grandes' ? grande(f) : String(f.cam) === fEstado)))
      .sort((x, y) => { const k = ordenPl.k; const a = k === 'n' || k === 'loc' ? String(x[k]) : x[k], b = k === 'n' || k === 'loc' ? String(y[k]) : y[k]; return (a < b ? -1 : a > b ? 1 : 0) * ordenPl.d; });
    const locs = [...new Set(filas.map((f) => f.loc))].sort();
    const grandes = filas.filter(grande);
    const dentro = (f) => typeof f.cam === 'number';
    const editables = vis.filter(dentro).concat(vis.filter((f) => f.cam === 'pend'));
    const th = (k, t) => <th style={{ cursor: 'pointer' }} onClick={() => setOrdenPl((o) => ({ k, d: o.k === k ? -o.d : (k === 'b' ? -1 : 1) }))}>{t}{ordenPl.k === k ? (ordenPl.d > 0 ? ' ▲' : ' ▼') : ''}</th>;
    const sel = new Set(selCli);
    const todosSel = editables.length > 0 && editables.every((f) => sel.has(f.c));
    return (
      <div className="sim-card">
        <h3>📋 Planilla de armado</h3>
        <div className="sim-sub" style={{ marginBottom: 8 }}>Todos los clientes del día con sus bultos, localidad y camión. Tildá los que quieras y <b>sumalos a un camión</b> o <b>dejalos fuera</b> (quedan para otro día). Cada cambio recalcula km, combustible y personas y se comparte en vivo.
          Los clientes de mucho volumen aparecen marcados con ⚠ para que decidas uno por uno si salen.</div>
        <div className="sim-sub" style={{ marginBottom: 6 }}>
          <b>Del día:</b> {sim.totales.clientes} clientes ruteados de {filas.filter((f) => typeof f.cam === 'number' || f.cam === 'pend' || f.cam === 'loc').length} ·
          no ruteados {filas.filter((f) => f.cam === 'pend' || f.cam === 'loc' || f.cam === 'sinub').length} ({f0((100 * filas.filter((f) => f.cam === 'pend' || f.cam === 'loc' || f.cam === 'sinub').length) / Math.max(1, filas.length))} %) ·
          camiones {sim.rutas.length}{sim.tope && sim.tope.max > 0 ? ` de ${sim.tope.max} disponibles` : ''} · recargas {sim.totales.recargas} · {f1(sim.totales.pallets)} pallets
        </div>
        <div className="sim-row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          {sim.rutas.map((r, i) => (
            <button key={pid(r, i)} className="sim-btn" style={{ borderLeft: `6px solid ${COLORES[i % COLORES.length]}`, background: fEstado === String(pid(r, i)) ? '#e8eefc' : undefined }}
              onClick={() => setFEstado(fEstado === String(pid(r, i)) ? 'todos' : String(pid(r, i)))}>
              #{r.n} {(choferesRutas[i] && choferesRutas[i].chofer) || ''} · {r.paradas.length} cl. · {f0(r.bultos)} b · {f0(r.ocupacion * 100)} % · ⏱ {hm(minutosRuta(tiempos, { paradas: r.paradas.length, km: r.km, bultos: r.bultos }))}{r.ocupacion > 1 || minutosRuta(tiempos, { paradas: r.paradas.length, km: r.km, bultos: r.bultos }) > tiempos.limite ? ' ⚠' : ''}
            </button>
          ))}
          {sim.pendEdit && sim.pendEdit.clientes.length > 0 && (
            <button className="sim-btn" onClick={() => setFEstado(fEstado === 'fuera' ? 'todos' : 'fuera')}>🚫 Fuera: {sim.pendEdit.clientes.length} cl. · {f0(sim.pendEdit.bultos)} b</button>
          )}
        </div>
        <div className="sim-row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <input placeholder="Buscar cliente, código o localidad…" value={fTxt} onChange={(e) => setFTxt(e.target.value)} style={{ minWidth: 220 }} />
          <select value={fLoc} onChange={(e) => setFLoc(e.target.value)}><option value="">Todas las localidades</option>{locs.map((l) => <option key={l} value={l}>{cap(l)}</option>)}</select>
          <select value={fEstado} onChange={(e) => setFEstado(e.target.value)}>
            <option value="todos">Todos</option><option value="fuera">Solo los que están fuera</option><option value="grandes">Solo los grandes ⚠</option>
            {sim.rutas.map((r, i) => <option key={pid(r, i)} value={String(pid(r, i))}>Camión #{r.n}</option>)}
          </select>
          <span className="sim-sub">Grande desde <input type="number" min="1" value={umbralGrande} style={{ width: 70 }} onChange={(e) => setUmbralGrande(Math.max(1, Math.floor(Number(e.target.value)) || 1))} onBlur={() => { if (umbralGrande !== aprend.umbral) registrarAprend({ umbral: umbralGrande }); }} /> bultos</span>
          {grandes.length > 0 && <span className="sim-warn" style={{ padding: '2px 8px' }}>⚠ {grandes.length} clientes grandes · {f0(grandes.reduce((t, f) => t + f.b, 0))} bultos</span>}
        </div>
        {selCli.length > 0 && (
          <div className="sim-row" style={{ marginBottom: 8, gap: 8, flexWrap: 'wrap', background: '#fff8e1', padding: 6, borderRadius: 8 }}>
            <b>{selCli.length} marcados · {f0(filas.filter((f) => sel.has(f.c)).reduce((t, f) => t + f.b, 0))} bultos</b>
            <select value="" onChange={(e) => moverA(selCli, e.target.value)}>
              <option value="">➕ Sumar a camión…</option>
              {sim.rutas.map((x, k) => <option key={pid(x, k)} value={pid(x, k)}>Camión #{x.n} · {x.localidades.map(cap).join(' + ')}</option>)}
              <option value="nuevo">➕ Camión nuevo</option>
            </select>
            <button className="sim-btn" onClick={() => moverA(selCli, 'pend')}>🚫 Dejar fuera</button>
            <button className="sim-btn" onClick={() => setSelCli([])}>Desmarcar</button>
          </div>
        )}
        <div className="sim-row" style={{ gap: 8, marginBottom: 6 }}>
          <button className="sim-btn" onClick={() => setSelCli(todosSel ? [] : editables.map((f) => f.c))}>{todosSel ? 'Desmarcar visibles' : `Marcar visibles (${editables.length})`}</button>
          {(() => { const lista = grandes.filter((f) => typeof f.cam === 'number' && habitual(f.c) === 'fuera').map((f) => f.c);
            return lista.length > 0 && <button className="sim-btn" title="Según el historial, estos clientes grandes casi siempre se llevan aparte o no salen en el ruteo" onClick={() => moverA(lista, 'pend')}>🧠 Dejar fuera los que suelen ir aparte ({lista.length})</button>; })()}
          {grandes.some(dentro) && <button className="sim-btn" onClick={() => setSelCli(grandes.filter((f) => dentro(f) || f.cam === 'pend').map((f) => f.c))}>Marcar los grandes</button>}
        </div>
        <div style={{ overflowX: 'auto', maxHeight: 460, overflowY: 'auto' }}>
          <table className="sim-table">
            <thead><tr><th></th>{th('c', 'Cód.')}{th('n', 'Cliente')}{th('loc', 'Localidad')}{th('b', 'Bultos')}{th('cam', 'Camión')}<th>Chofer</th></tr></thead>
            <tbody>
              {vis.map((f) => {
                const edit = dentro(f) || f.cam === 'pend';
                const fuera = f.cam === 'pend' || f.cam === 'loc';
                return (
                  <tr key={`${f.c}-${f.cam}`} style={{ opacity: fuera ? 0.6 : 1, background: grande(f) ? '#fff6e5' : undefined }}>
                    <td><input type="checkbox" disabled={!edit} checked={sel.has(f.c)} onChange={() => setSelCli((a) => (a.includes(f.c) ? a.filter((x) => x !== f.c) : [...a, f.c]))} /></td>
                    <td>{f.lat ? <button className="sim-btn" style={{ padding: '0 4px' }} title="Ver en el mapa" onClick={() => { const m = mapRef.current; if (m && m.flyTo) m.flyTo({ center: [f.lon, f.lat], zoom: 14 }); }}>📍</button> : null} {f.c}</td><td>{f.n}{grande(f) && <span title="Cliente de mucho volumen: decidí si sale" style={{ marginLeft: 6 }}>⚠ grande</span>}
                      {grande(f) && aprend.grandes[f.c] && (() => { const h = aprend.grandes[f.c]; return <span className="sim-sub" style={{ marginLeft: 6 }} title="Según romaneos reales y tus decisiones">historial: salió {h.s || 0} · aparte/fuera {h.f || 0}{(h.ds || h.df) ? ` · vos: sale ${h.ds || 0} / fuera ${h.df || 0}` : ''}</span>; })()}</td><td>{cap(f.loc)}</td><td>{f1(f.b)}</td>
                    <td>{edit ? (
                      <select value={f.cam === 'pend' ? 'pend' : String(f.cam)} onChange={(e) => moverA([f.c], e.target.value)}>
                        {sim.rutas.map((x, k) => <option key={pid(x, k)} value={String(pid(x, k))}>#{x.n}</option>)}
                        <option value="nuevo">➕ Nuevo</option><option value="pend">🚫 Fuera</option>
                      </select>
                    ) : f.cam === 'loc' ? 'Localidad fuera' : 'Sin ubicación'}</td>
                    <td>{f.ch}</td>
                  </tr>
                );
              })}
              {vis.length === 0 && <tr><td colSpan="7" className="sim-sub">Ningún cliente con ese filtro.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="sim-sub" style={{ marginTop: 6 }}>Mostrando {vis.length} de {filas.length} clientes.</div>
      </div>
    );
  })();
  const tarjetaEditar = sim && (
    <div className="sim-card">
      <h3>✏️ Editar el reparto</h3>
      {!plan ? (
        <>
          <div className="sim-sub" style={{ marginBottom: 8 }}>El motor ya armó la propuesta de arriba. Si querés cambiar cómo sale — mover una localidad o clientes sueltos a otro camión, juntar o partir camiones, fijar el orden de las paradas —
            tocá <b>Editar esta propuesta</b>: queda fija y todo se recalcula (km, combustible, personas, recarga). Los clientes nuevos que entren con otra carga de pedidos se suman solos al camión más cercano. Se comparte en vivo.</div>
          <button className="sim-btn" onClick={() => guardarPlan(planDesde(simAuto))}>✏️ Editar esta propuesta</button>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
            <span className="sim-sub">Estás editando el reparto a mano: el motor ya no lo recalcula (los camiones por localidad de arriba no aplican). Todo cambio se comparte en vivo.</span>
            <button className="sim-btn" onClick={() => { if (window.confirm('Se descartan tus cambios y vuelve la propuesta automática del motor. ¿Seguro?')) { setSelCli([]); setAbierto(null); guardarPlan(null); } }}>↩ Volver al reparto automático</button>
          </div>
          {sim.agregados > 0 && <div className="sim-warn" style={{ marginBottom: 8 }}>Entraron {sim.agregados} clientes nuevos desde que editaste: se sumaron al camión más cercano. Revisalos.</div>}
          {sim.tope && sim.tope.faltan > 0 && <div className="sim-warn" style={{ marginBottom: 8 }}>Tu reparto usa {sim.rutas.length} camiones y tenés {sim.tope.max} disponibles.</div>}
          {selCli.length > 0 && (
            <div className="sim-row" style={{ marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
              <b>{selCli.length} clientes marcados</b>
              <select value="" onChange={(e) => moverA(selCli, e.target.value)}><option value="">Mover marcados a…</option>{opcionesDestino(null)}</select>
              <button className="sim-btn" onClick={() => setSelCli([])}>Desmarcar</button>
            </div>
          )}
          {sim.rutas.map((r, i) => {
            const porLoc = new Map();
            r.paradas.forEach((p) => { const l = p.loc || 'SIN LOCALIDAD'; const o = porLoc.get(l) || { loc: l, cods: [], b: 0 }; o.cods.push(p.c); o.b += p.b; porLoc.set(l, o); });
            const ch = choferesRutas[i] && choferesRutas[i].chofer;
            return (
              <div key={r.planId} style={{ border: '1px solid var(--border, #cdd4e4)', borderRadius: 10, padding: 10, marginBottom: 8 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="sim-chip" style={{ background: COLORES[i % COLORES.length] }} />
                  <b>Camión #{r.n}</b>
                  <span className="sim-sub">{ch || 'sin chofer'} · {r.paradas.length} paradas · {f0(r.bultos)} bultos · ocupación {f0(r.ocupacion * 100)} %</span>
                  {r.ocupacion > 1 && <span className="sim-warn" style={{ padding: '1px 6px' }}>⚠ pasa la capacidad</span>}
                  <select value="" onChange={(e) => { if (e.target.value) guardarPlan(planJuntar(plan, r.planId, Number(e.target.value))); }}>
                    <option value="">Juntar con…</option>
                    {sim.rutas.filter((x) => x.planId !== r.planId).map((x) => <option key={x.planId} value={x.planId}>Camión #{x.n}</option>)}
                  </select>
                  <button className="sim-btn" disabled={r.paradas.length < 2} onClick={() => guardarPlan(planPartir(plan, r.planId, r, params.deposito))}>✂️ Partir en 2</button>
                  <button className="sim-btn" onClick={() => setAbierto(abierto === r.planId ? null : r.planId)}>{abierto === r.planId ? 'Ocultar clientes' : 'Ver clientes y orden'}</button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 6 }}>
                  {[...porLoc.values()].map((o) => (
                    <span key={o.loc}><b>{cap(o.loc)}</b> <span className="sim-sub">{o.cods.length} cl. · {f0(o.b)} bultos</span>{' '}
                      <select value="" onChange={(e) => moverA(o.cods, e.target.value)}><option value="">mover a…</option>{opcionesDestino(r.planId)}</select></span>
                  ))}
                </div>
                {abierto === r.planId && (
                  <div style={{ marginTop: 8, overflowX: 'auto' }}>
                    <div className="sim-sub" style={{ marginBottom: 4 }}>Orden: {r.ordenManual ? 'fijado a mano' : 'automático (el más corto)'}{' '}
                      {r.ordenManual && <button className="sim-btn" onClick={() => guardarPlan(planOrdenAuto(plan, r.planId))}>Volver al orden automático</button>}</div>
                    <table className="sim-table">
                      <thead><tr><th></th><th>#</th><th>Cód.</th><th>Cliente</th><th>Localidad</th><th>Bultos</th><th>Orden</th></tr></thead>
                      <tbody>
                        {r.paradas.map((p, k) => {
                          const cods = r.paradas.map((x) => x.c);
                          const mover = (d) => { const n = cods.slice(); const t = n[k]; n[k] = n[k + d]; n[k + d] = t; guardarPlan(planOrdenar(plan, r.planId, n)); };
                          return (
                            <tr key={p.c}>
                              <td><input type="checkbox" checked={selCli.includes(p.c)} onChange={() => setSelCli((s) => (s.includes(p.c) ? s.filter((c) => c !== p.c) : [...s, p.c]))} /></td>
                              <td>{k + 1}</td><td>{p.c}</td><td>{p.n}</td><td>{cap(p.loc)}</td><td>{f1(p.b)}</td>
                              <td><button className="sim-btn" disabled={k === 0} onClick={() => mover(-1)}>↑</button> <button className="sim-btn" disabled={k === r.paradas.length - 1} onClick={() => mover(1)}>↓</button></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
          {sim.pendEdit && sim.pendEdit.clientes.length > 0 && (
            <div className="sim-warn">
              <b>Quedan para otro día (por tu edición): {sim.pendEdit.clientes.length} clientes · {f0(sim.pendEdit.bultos)} bultos.</b>
              <div style={{ marginTop: 4 }}>
                {[...sim.pendEdit.clientes.reduce((m, p) => { const l = p.loc || 'SIN LOCALIDAD'; const o = m.get(l) || { loc: l, cods: [], b: 0 }; o.cods.push(p.c); o.b += p.b; return m.set(l, o); }, new Map()).values()].map((o) => (
                  <span key={o.loc} style={{ marginRight: 14 }}>{cap(o.loc)} {o.cods.length} cl. · {f0(o.b)} bultos{' '}
                    <select value="" onChange={(e) => moverA(o.cods, e.target.value)}><option value="">devolver a…</option>{sim.rutas.map((x) => <option key={x.planId} value={x.planId}>Camión #{x.n} · {x.localidades.map(cap).join(' + ')}</option>)}<option value="nuevo">➕ Camión nuevo</option></select></span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );

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
                const x = mapaLista.get(f); const esPed = fechaPedidos === f; const noLab = motivoNoLaborable(f, diasNoTrab);
                const clic = () => { if (x) { setModo('calendario'); cargarDia(f); } else if (esPed) setModo('simulacion'); };
                return (
                  <button key={f} className={`sim-day ${x ? 'has' : ''} ${noLab ? 'fer' : ''} ${esPed ? 'ped' : ''} ${diaSel === f && modo === 'calendario' ? 'sel' : ''} ${f === hoyISO ? 'hoy' : ''}`}
                    onClick={clic} disabled={!x && !esPed} title={`${noLab ? `${noLab} · ` : ''}${x ? `${x.paradas} paradas · ${f0(x.bultos)} bultos` : esPed ? 'Pedidos cargados para este día' : ''}`}>
                    {Number(f.slice(8))}{x && <small>{x.paradas}</small>}
                  </button>
                );
              })}
            </div>
            <div className="sim-sub" style={{ marginTop: 8 }}>Azul = día con romaneo (número = paradas) · 📦 = pedidos cargados · Rojo = feriado o día no trabajado (Config)</div>
          </div>

          <div className="sim-card">
            <h3>Pedidos del día siguiente</h3>
            <div style={{ display: 'grid', gap: 8 }}>
              <label className="sim-sub">Fecha de entrega
                <input className="sim-input" type="date" value={fechaNueva} onChange={(e) => setFechaNueva(e.target.value)} />
              </label>
              <input ref={refPed} type="file" accept=".xlsx,.xls,.csv" hidden
                onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) subirPedidos(f, fechaNueva, fechaPed); }} />
              <label className="sim-sub">Pedidos hechos el día
                <input className="sim-input" type="date" value={fechaPed} onChange={(e) => setFechaPed(e.target.value)} />
              </label>
              <button className="sim-btn pri" disabled={ocupado || !fechaPed} onClick={() => refPed.current.click()}>📦 Subir pedidos del día (Excel)</button>
              <input ref={refPed2} type="file" accept=".xlsx,.xls,.csv" hidden
                onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) subirPedidos(f, fechaNueva, fechaPed, true); }} />
              <button className="sim-btn" disabled={ocupado || !fechaPed || !pedidos?.data} onClick={() => refPed2.current.click()}
                title="Otro archivo de la misma fecha de pedido (ej. Tandil y zona + Las Flores y zona): se agrega sin borrar el anterior">➕ Sumar otro archivo (misma fecha)</button>
              {pedidos?.data && pedidos.data.fechaEntrega === fechaNueva && Object.keys(capasDe(pedidos.data, fechaNueva)).length > 0 && (
                <div className="sim-sub" style={{ borderTop: '1px solid var(--border, #cdd4e4)', paddingTop: 6 }}>
                  <b>Se entrega el {fechaLarga(fechaNueva)} · pedidos acumulados:</b>
                  {Object.entries(capasDe(pedidos.data, fechaNueva)).sort().map(([k, v]) => (
                    <div key={k}>{k ? `Hechos el ${fechaLarga(k)}` : 'Carga anterior'}: {v.clientes.length} cl. · {f0(v.clientes.reduce((t, c) => t + c.b, 0))} bultos{' '}
                      <button className="sim-btn" disabled={ocupado} title="Quitar los pedidos de esta fecha"
                        onClick={() => { if (window.confirm(`¿Quitar los pedidos hechos el ${k ? fechaLarga(k) : 'de la carga anterior'}?`)) { setOcupado(true); guardarPedidos({ clientes: [] }, '', fechaNueva, false, k, true).catch((e) => aviso(e.message, 'err')).finally(() => setOcupado(false)); } }}>🗑</button></div>
                  ))}
                  <b>Total: {pedidos.data.clientes.length} clientes · {f0(pedidos.data.clientes.reduce((t, c) => t + c.b, 0))} bultos</b>
                </div>
              )}
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
            <div style={{ position: 'relative' }}>
              <div ref={mapDiv} className="sim-map" />
              {modo === 'simulacion' && sim && (
                <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 6, display: 'flex', gap: 4, flexWrap: 'wrap', maxWidth: 'calc(100% - 60px)' }}>
                  <div className="sim-seg">
                    {[['', '✋', 'Mover el mapa'], ['circulo', '⭕', 'Círculo: arrastrá desde el centro'], ['lazo', '✏️', 'Lazo: dibujá alrededor de los clientes'], ['rect', '▭', 'Rectángulo']].map(([k, ic, tt]) => (
                      <button key={k || 'mano'} className={herr === k ? 'on' : ''} title={tt} onClick={() => setHerr(k)}>{ic}</button>
                    ))}
                  </div>
                  {selCli.length > 0 && (() => {
                    const por = new Map(); sim.rutas.forEach((r) => r.paradas.forEach((p) => por.set(p.c, p))); ((sim.pendEdit && sim.pendEdit.clientes) || []).forEach((p) => por.set(p.c, p));
                    const bs = selCli.reduce((t, c) => t + ((por.get(c) || {}).b || 0), 0);
                    return (
                      <div className="sim-card" style={{ margin: 0, padding: '4px 8px', display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                        <b>{selCli.length} cl. · {f0(bs)} b →</b>
                        {sim.rutas.map((r, i) => <button key={pidDe(r, i)} className="sim-btn" style={{ borderLeft: `6px solid ${COLORES[i % COLORES.length]}` }} onClick={() => moverA(selCli, pidDe(r, i))}>#{r.n}</button>)}
                        <button className="sim-btn" onClick={() => moverA(selCli, 'nuevo')}>➕ Nuevo</button>
                        <button className="sim-btn" onClick={() => moverA(selCli, 'pend')}>🚫 Fuera</button>
                        <button className="sim-btn" onClick={() => setSelCli([])}>✖</button>
                      </div>
                    );
                  })()}
                </div>
              )}
              <CapaSeleccion herramienta={modo === 'simulacion' ? herr : ''} getPuntos={puntosElegibles} onSeleccion={alSeleccionar} onCancelar={() => setHerr('')}
                proyectar={(p) => { const q = mapRef.current.project([p.lon, p.lat]); return [q.x, q.y]; }} />
            </div>
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
            !sim ? <>{pedidos?.data && tarjetaLocs}<div className="sim-card sim-empty">{pedidos?.data ? 'No sale ninguna localidad: tildá alguna arriba para simular.' : <>Subí el Excel de pedidos para simular la entrega.<br />Se calcula en tu navegador y lo ve en vivo cualquier usuario con acceso.</>}</div></> : (
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
                    {costoPers && costoPers.total > 0 && <div className="sim-kpi"><b>{money(costoPers.total)}</b><span>Personal del día ({costoPers.dias} días hábiles)</span></div>}
                    {costoPers && costoPers.total > 0 && <div className="sim-kpi"><b>{money(costoPers.total + sim.totales.combustible)}</b><span>Combustible + personal{sim.totales.bultos ? ` · ${money((costoPers.total + sim.totales.combustible) / sim.totales.bultos)}/bulto` : ''}</span></div>}
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

                {tarjetaLocs}

                <div className="sim-card">
                  <h3>👷 Choferes del día{fechaPedidos ? ` · zona del ${zonaDelDia(fechaPedidos) || '—'}` : ''}</h3>
                  <div className="sim-sub" style={{ marginBottom: 6 }}>Cada chofer sale por su zona habitual (aprendida del historial). Si alguien no vino, destildalo y elegí quién cubre su zona. Se comparte en vivo con los demás.</div>
                  {perfiles.filter((p) => !p.mercado).slice(0, 16).map((p) => {
                    const auto = ausAuto.get(normN(p.nombre)); const falta = !!auto || ausentes.includes(p.nombre);
                    return (
                      <div key={p.nombre} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '4px 0' }}>
                        <label style={{ minWidth: 190 }}>
                          <input type="checkbox" checked={!falta} disabled={!!auto}
                            onChange={() => guardarAsig(falta ? ausentes.filter((x) => x !== p.nombre) : [...ausentes, p.nombre], cubre, manual)} /> <b>{p.nombre}</b>
                        </label>
                        <span className="sim-sub">{p.etiqueta}{p.deZonaDelDia ? ' · zona de hoy' : ''}</span>
                        {!falta && ausEf.length > 0 && (
                          <select value={cubre[p.nombre] || ''} onChange={(e) => { const c = { ...cubre }; if (e.target.value) c[p.nombre] = e.target.value; else delete c[p.nombre]; guardarAsig(ausentes, c, manual); }}>
                            <option value="">cubre su propia zona</option>
                            {ausEf.map((a) => <option key={a} value={a}>cubre la zona de {a}</option>)}
                          </select>
                        )}
                        {falta && <span className="sim-warn" style={{ padding: '1px 6px' }}>{auto ? `Ausencias: ${auto}` : 'no vino'}</span>}
                      </div>
                    );
                  })}
                  {sim && sim.totales && (
                    <div className="sim-sub" style={{ marginTop: 6 }}>
                      Personal presente según Config y Ausencias: <b>{personalPresente}</b> personas · la simulación necesita <b>{sim.totales.personas}</b> ({sim.rutas.length} camiones × chofer + {params.ayudantesPorCamion} ayudante{params.ayudantesPorCamion === 1 ? '' : 's'}, y 2 en Las Flores).
                      {sim.totales.personas > personalPresente && <span className="sim-warn" style={{ marginLeft: 6, padding: '1px 6px' }}>⚠ falta personal</span>}
                    </div>
                  )}
                  {perfiles.length === 0 && <div className="sim-sub">Todavía no hay romaneos cargados para aprender las zonas de los choferes.</div>}
                  {choferesRutas.filter((x) => !x || !x.chofer).length > 0 && <div className="sim-warn" style={{ marginTop: 6 }}>Hay más camiones que choferes disponibles: alguna ruta queda sin chofer.</div>}
                </div>

                <div className="sim-card" style={{ overflowX: 'auto' }}>
                  <h3>Camiones sugeridos (con lo que falta rutear)</h3>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                    <span className="sim-sub">Camiones disponibles:</span>
                    <input type="number" min="0" style={{ width: 64 }} value={params.maxCamiones || 0} onChange={(e) => setParams((p) => ({ ...p, maxCamiones: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))} />
                    <button className="sim-btn" onClick={() => setParams((p) => ({ ...p, maxCamiones: Math.max(0, perfiles.filter((x) => !x.mercado && !ausEf.includes(x.nombre) && x.ultimo >= haceDias(fechaPedidos, 10)).length) }))}>Usar choferes presentes</button>
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
                    <thead><tr><th>Camión</th><th>Zona</th><th>Chofer</th><th>Paradas</th><th>Bultos</th><th>Pallets</th><th>Ocupación</th><th>Km</th><th>Litros</th><th>Combustible</th><th>Personas</th><th>Personal</th><th>Total</th><th>Recarga</th></tr></thead>
                    <tbody>
                      {sim.rutas.map((r, i) => (
                        <tr key={r.n} className={`click ${rutaSel === i ? 'rsel' : ''}`} onClick={() => setRutaSel(rutaSel === i ? null : i)}>
                          <td><span className="sim-chip" style={{ background: COLORES[i % COLORES.length] }} />#{r.n}</td>
                          <td>{r.localidades.map(cap).join(' + ')}{r.pocaCarga && <span className="sim-warn" style={{ marginLeft: 6, padding: '1px 6px' }} title="Muy poca carga y ningún camión cercano con lugar: conviene postergar o agrupar con otro día">⚠ poca carga</span>}</td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <select value={(choferesRutas[i] && choferesRutas[i].chofer) || ''} title={(choferesRutas[i] && choferesRutas[i].motivo) || ''}
                              onChange={(e) => { const m = { ...manual }; if (e.target.value) m[claveAncla(r)] = e.target.value; else delete m[claveAncla(r)]; guardarAsig(ausentes, cubre, m); }}>
                              <option value="">sin chofer</option>
                              {perfiles.filter((p) => !p.mercado && !ausEf.includes(p.nombre)).map((p) => <option key={p.nombre} value={p.nombre}>{p.nombre}</option>)}
                            </select>
                            {choferesRutas[i] && choferesRutas[i].motivo && !manual[claveAncla(r)] && <div className="sim-sub">{choferesRutas[i].motivo}</div>}
                          </td>
                          <td>{r.paradas.length}</td><td>{f0(r.bultos)}</td><td>{f1(r.pallets)}</td>
                          <td><div className="sim-bar"><i className={r.ocupacion > 0.8 ? 'alto' : r.ocupacion < 0.4 ? 'bajo' : ''} style={{ width: `${Math.min(100, r.ocupacion * 100)}%` }} /></div></td>
                          <td>{f0(r.km)}{r.kmCalle ? ' 🛣️' : ''}</td><td>{f1(r.litros)}{r.utilitario ? ' (util.)' : ''}</td><td>{money(r.combustible)}</td>
                          <td>{r.personas}</td>
                          <td>{costoPers ? money(costoPers.porRuta[i]) : '—'}</td>
                          <td><b>{costoPers ? money(costoPers.porRuta[i] + r.combustible) : money(r.combustible)}</b></td>
                          <td>{r.recargas ? (r.alertaRecarga ? <span className="sim-warn" style={{ padding: '1px 6px' }} title={`Más de ${params.maxConRecarga} bultos con recarga: revisar`}>1 ⚠ revisar</span> : '1') : `no (≤${r.limiteRecarga})`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="sim-sub" style={{ marginTop: 8 }}>Tocá un camión para verlo solo en el mapa (puntos numerados en orden de visita). 🛣️ = km medidos por calles; sin eso, se estima con km en línea recta × factor de ruta ({params.factorRuta})
                    {factorCal ? <> · calibrado con tu historial: {factorCal}</> : null}.</div>
                </div>
                {tarjetaJornada}
                {tarjetaPlanilla}
                {tarjetaEditar}
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
                  {selGrado}
                  <TarjetasMarcas litros={sim.totales.litros} km={sim.totales.km} bultos={sim.totales.bultos} clientes={sim.totales.clientes} params={params}
                    onElegir={(marca, precio) => setParams((p) => ({ ...p, marca, precioDiesel: precio }))} />
                  <div className="sim-sub" style={{ marginTop: 8 }}>{notaPrecios} Elegí una tarjeta para que el costo por camión use ese precio.</div>
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
                <div className="sim-card">
                  <h3>🧪 Probar el motor con este día</h3>
                  <div className="sim-sub" style={{ marginBottom: 8 }}>Rearma los pedidos de este día, le pide al motor que los reparta <b>sin mirar este día en el historial</b> y compara con lo que el ruteador hizo de verdad.
                    Los mercados, camiones de terceros y salidas de 1-2 paradas se cuentan aparte (los decide una persona).</div>
                  <button className="sim-btn" onClick={() => { try { setPrueba(probarContraDia(diaSel, diaDatos, hist, ubicItems, params)); } catch (e) { aviso(e.message, 'err'); } }}>▶ Probar con el {fechaLarga(diaSel)}</button>
                  {prueba && prueba.fecha === diaSel && (
                    <div style={{ marginTop: 10 }}>
                      <div className="sim-kpis">
                        <div className="sim-kpi"><b>{prueba.motor.camiones} vs {prueba.real.camiones}</b><span>Camiones (motor vs real, sin los de aparte)</span></div>
                        <div className="sim-kpi"><b>{f0(prueba.motor.km)} vs {f0(prueba.real.km)}</b><span>Km (motor vs real)</span></div>
                        <div className="sim-kpi"><b>{f0(prueba.agrupamiento * 100)} %</b><span>Clientes que el motor junta como el ruteador</span></div>
                        <div className="sim-kpi"><b>{f0(prueba.choferClientes * 100)} %</b><span>Clientes con el mismo chofer</span></div>
                        <div className="sim-kpi"><b>{prueba.aparte.clientes} · {f0(prueba.aparte.bultos)} b</b><span>Se llevaron aparte</span></div>
                      </div>
                      <div className="sim-sub" style={{ margin: '8px 0 4px' }}>"Juntos" = qué parte de los clientes de la ruta real el motor deja en un mismo camión. El chofer del motor sale del historial sin ausencias, así que si ese día faltó alguien baja el porcentaje.</div>
                      <table className="sim-table">
                        <thead><tr><th>Ruta real</th><th>Clientes</th><th>Juntos en el motor</th><th>Camión del motor</th><th>Chofer del motor</th></tr></thead>
                        <tbody>{prueba.porRuta.map((o) => (
                          <tr key={o.ri}><td>{o.chofer}</td><td>{o.clientes}</td><td>{f0(o.juntos * 100)} %</td><td>#{o.camionSim}</td><td>{o.choferSim || '—'}</td></tr>
                        ))}</tbody>
                      </table>
                      {prueba.tiempos && prueba.tiempos.errMin !== null && <div className="sim-sub" style={{ marginTop: 6 }}>Tiempos: el modelo ({prueba.tiempos.ajustado ? 'aprendido sin este día' : 'valores típicos'}) se equivoca en promedio ±{f0(prueba.tiempos.errMin)} min por ruta en este día ({prueba.tiempos.rutas} rutas).</div>}
                      {prueba.aparte.lista.length > 0 && <div className="sim-sub" style={{ marginTop: 6 }}>Aparte: {prueba.aparte.lista.map((x) => `${x.n} (${f0(x.b)} b, ${x.chofer})`).join(' · ')}</div>}
                    </div>
                  )}
                </div>
                {costoDia && (
                  <div className="sim-card">
                    <h3>⛽ ¿Dónde conviene cargar? ({f0(costoDia.litros)} L del día)</h3>
                    {selGrado}
                  <TarjetasMarcas litros={costoDia.litros} km={resumenDia.km} bultos={resumenDia.bultos} clientes={resumenDia.paradas} params={params}
                      onElegir={(marca, precio) => setParams((p) => ({ ...p, marca, precioDiesel: precio }))} />
                    <div className="sim-sub" style={{ marginTop: 8 }}>{notaPrecios}</div>
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
