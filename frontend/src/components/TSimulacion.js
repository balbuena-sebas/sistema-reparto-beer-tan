// components/TSimulacion.js — Calendario de romaneo + simulación de reparto en vivo.
// Carga perezosa (lazy) desde App.js: MapLibre solo se descarga al abrir esta pestaña.
// El romaneo y la maestra de clientes se suben desde la pestaña Importar (CargaRuteo).
import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { apiFetch, suscribirRuteo } from '../api/client';
import { CapaSeleccion } from '../simulacion/seleccion';
import {
  PARAMS_DEFAULT, parsePedidos, construirUbicaciones, calibrarFactor, diffPedidos,
  indexarRechazos, cruzarRechazos, resumenRuteados, costearRuta, comparativaMarcas, resumenPorLocalidad,
  perfilesChoferes, asignarChoferes, zonaDelDia, simularConTope,
  planDesde, planMover, planJuntar, planPartir, planOrdenar, planOrdenAuto, aplicarPlan, construirZonas,
  probarContraDia, clientesEnRutaPropia, ajustarTiempos, minutosRuta,
  MOTIVOS, planMotivo, planDividir, planUnir, bitDia, diasDeMascara, afinidadLocalidades, veces, rutaAparte, aplicarPersonas,
} from '../simulacion/engine';
import { COLORES, VISTAS, crearMapa, cambiarVista, pintar, encuadrar, largoMaximo, posicionesAnim, pintarCamiones } from '../simulacion/mapa';
import { rutaPorCalles, claveRuta } from '../simulacion/calles';
import { motivoNoLaborable, calcDiasTrabajados } from './diasTrabajados';
import { Ayuda, Seccion, GLOSARIO } from '../simulacion/ui';
import { calcularChequeos } from '../simulacion/chequeos';
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
// Nombre de la zona de un camión: la localidad principal y, si pasa por otras, cuáles son ("Tandil (+ La Dulce)")
const zonaTxt = (r) => {
  const l = r.localidades || [];
  if (l.length <= 1) return cap(l[0] || 'Sin localidad');
  const pr = r.principal || l[0];
  return `${cap(pr)} (+ ${l.filter((x) => x !== pr).map(cap).join(', ')})`;
};

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
    maxCamiones: 7,                 // flota de 8 camiones, 1 en el taller
    autoelevador: [],
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
  const [frec, setFrec] = useState({});                           // frecuencia de entrega por cliente: { cod: máscara LU..SA }
  const [motivoNuevo, setMotivoNuevo] = useState('Comercial');    // motivo de no ruteo que se asigna al dejar clientes fuera
  const [dividiendo, setDividiendo] = useState(null);             // cliente cuya carga se está dividiendo entre camiones
  const [partesDiv, setPartesDiv] = useState({});                 // { idCamión: bultos } de la división en curso
  const [paso, setPaso] = useState(1);                           // paso visible: 1 Pedidos · 2 Camiones · 3 Clientes · 4 Costos
  const [chkAbierto, setChkAbierto] = useState(false);            // lista de "cosas para revisar"
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
  const cargarFrec = useCallback(async () => {
    try { const r = await apiFetch('/api/ruteo/frecuencia'); setFrec(r.data || {}); } catch { /* es de apoyo */ }
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

  useEffect(() => { cargarLista(); cargarUbic(); cargarPedidos(); cargarAprend(); cargarFrec(); }, [cargarLista, cargarUbic, cargarPedidos, cargarAprend, cargarFrec]);

  useEffect(() => {
    const parar = suscribirRuteo((ev, info) => {
      if (ev === 'pedidos') cargarPedidos();
      if (ev === 'ubicaciones') { cargarUbic(); cargarFrec(); }
      if (ev === 'aprendizaje') cargarAprend();
      if (ev === 'asignacion' && asigFn.current) asigFn.current();
      if (ev === 'dia') { cacheDias.current.delete(info.fecha); cargarLista(); setDiaSel((s) => { if (s === info.fecha) cargarDia(s); return s; }); }
    }, setEnVivo);
    return parar;
  }, [cargarPedidos, cargarUbic, cargarLista, cargarDia, cargarAprend, cargarFrec]);
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
    const fechas = lista.map((x) => x.fecha).sort().slice(-30).reverse();   // primero los más recientes
    (async () => {
      const h = {}; let i = 0;
      // 5 descargas a la vez; el historial se va sumando a medida que llega (el motor aprende con lo que ya está)
      const trabajador = async () => {
        while (vivo && i < fechas.length) {
          const f = fechas[i++];
          try { const d = await traerDia(f); if (d && vivo) { h[f] = d; if (Object.keys(h).length % 6 === 0) setHist({ ...h }); } } catch { /* sigue */ }
        }
      };
      await Promise.all([1, 2, 3, 4, 5].map(trabajador));
      if (vivo) setHist({ ...h });
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
  // Qué localidades salieron juntas en los romaneos reales (el motor solo junta las que ya lo hicieron)
  const afinidad = useMemo(() => afinidadLocalidades(hist, ubic), [hist, ubic]);
  // Lo habitual para el día de la semana del reparto: cuántos camiones propios y qué localidades
  const habitualDia = useMemo(() => {
    if (!fechaPedidos) return null;
    const dow = new Date(`${fechaPedidos}T12:00:00`).getDay();
    const dias = Object.entries(hist || {}).filter(([f]) => new Date(`${f}T12:00:00`).getDay() === dow).map(([, d]) => d);
    const propios = []; const locCuenta = {};
    dias.forEach((d) => {
      let n = 0, b = 0; const locsDia = new Set();
      d.rutas.forEach((r, ri) => {
        const pts = d.paradas.filter((x) => x[0] === ri);
        if (!pts.length || rutaAparte(r, pts.length)) return;
        n++; b += r.bultos || 0;
        pts.forEach((x) => { const u = ubic.get(x[2]); if (u && u.loc) locsDia.add(String(u.loc).toUpperCase()); });
      });
      if (n) { propios.push({ n, b }); locsDia.forEach((l) => { locCuenta[l] = (locCuenta[l] || 0) + 1; }); }
    });
    if (!propios.length) return null;
    const prom = (k) => propios.reduce((t, x) => t + x[k], 0) / propios.length;
    return { dias: propios.length, camiones: prom('n'), bultos: prom('b'), locs: Object.entries(locCuenta).filter(([, v]) => v / propios.length >= 0.4).map(([l]) => l) };
  }, [hist, ubic, fechaPedidos]);
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
  // Ayudantes de Config que están presentes ese día (null si Config no tiene la lista: entonces no se suma un 2º ayudante)
  const ayudantesPresentes = useMemo(() => {
    const lista = cfg?.ayudantes || []; if (!lista.length) return null;
    const aus = new Set([...ausAuto.keys(), ...ausentes.map(normN)]);
    return lista.filter((n) => !aus.has(normN(n))).length;
  }, [cfg, ausAuto, ausentes]);
  const paramsEf = useMemo(() => ({ ...params, ayudantesDisp: ayudantesPresentes }), [params, ayudantesPresentes]);
  const tiempos = useMemo(() => ajustarTiempos(hist), [hist]);       // minutos por parada / km / bulto aprendidos de los romaneos
  // El cálculo pesado se hace después de pintar lo que tocaste (así los campos no se traban) y se avisa mientras recalcula
  const paramsCalc = useDeferredValue(paramsEf), camionesCalc = useDeferredValue(camionesLoc), salenCalc = useDeferredValue(pedidosSalen);
  const calculando = paramsCalc !== paramsEf || camionesCalc !== camionesLoc || salenCalc !== pedidosSalen;
  const simAuto = useMemo(() => {
    if (!salenCalc.salen.length) return null;
    return simularConTope({ clientes: salenCalc.salen }, ubic, { ...paramsCalc, camionesPorLoc: camionesCalc, zonas, afinidad, fechaObjetivo: fechaPedidos, ausentes: ausEf, cubre, tiempos });
  }, [salenCalc, ubic, paramsCalc, camionesCalc, zonas, afinidad, fechaPedidos, ausEf, cubre, tiempos]);
  // Con reparto editado a mano manda el plan; si no, la propuesta del motor.
  const simBase = useMemo(() => aplicarPersonas(paramsEf, (simAuto && plan ? aplicarPlan(simAuto, plan, paramsEf) : simAuto), manual), [simAuto, plan, paramsEf, manual]);

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
    return { color: COLORES[i % COLORES.length], label: `Camión ${r.n} · ${zonaTxt(r)}${choferesRutas[i] && choferesRutas[i].chofer ? ` · ${choferesRutas[i].chofer}` : ''}`, puntos,
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
    // Una recarga la hacen el chofer y su(s) ayudante(s) del camión: sale lo que cuesta ese personal en el día
    const porRecarga = sim.rutas.map((r, i) => (r.recargas ? porRuta[i] : 0));
    const extra = sim.rutas.filter((r) => r.extraAyudante).length * (ay / dias);
    return { porRuta, total: porRuta.reduce((s, x) => s + x, 0), dias, ch, ay, porRecarga, recargas: porRecarga.reduce((s, x) => s + x, 0), extra, dia1: de(2) };
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

  const borrarPedidos = async () => {
    const previo = pedidos?.data; if (!previo) return;
    const anterior = { archivo: previo.archivo, cargadoEn: pedidos.updatedAt, clientes: previo.clientes.map((c) => [c.c, c.b, c.n]) };
    await apiFetch('/api/ruteo/pedidos', { method: 'PUT', headers: hdr, body: JSON.stringify({ archivo: '', fechaEntrega: previo.fechaEntrega, clientes: [], anterior, base: null, capas: {} }) });
    aviso('Pedidos borrados. Ya podés subir los nuevos.');
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
  // ── Datos derivados: se calculan UNA vez y los usan todas las pantallas (así no se repiten ni se contradicen) ──
  const pidDe = (r, i) => (r.planId != null ? r.planId : i + 1);        // id de camión (sin plan editado = su posición, igual que planDesde)
  const baseEdit = () => plan || planDesde(simAuto);                    // cualquier edición parte de la propuesta si todavía no hay plan
  const bitHoy = fechaPedidos ? bitDia(fechaPedidos) : 0;
  const noTocaCod = (c) => { const m = frec[c]; return !!m && !!bitHoy && !(m & bitHoy); };
  const motDe = (c) => (plan && plan.motivos && plan.motivos[c]) || '';
  const grandeB = (b) => b >= umbralGrande;
  const dentro = (f) => typeof f.cam === 'number';

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

  // Una fila por cliente del día: en qué camión está (número), fuera ('pend'), localidad que no sale ('loc') o sin ubicación ('sinub').
  const filas = [];
  if (sim) {
    sim.rutas.forEach((r, i) => r.paradas.forEach((p) => filas.push({ c: p.c, n: p.n, lat: p.lat, lon: p.lon, loc: p.loc || 'SIN LOCALIDAD', b: p.b, cam: pidDe(r, i), nCam: r.n, ruta: i, parte: !!p.parte })));
    ((sim.pendEdit && sim.pendEdit.clientes) || []).forEach((p) => filas.push({ c: p.c, n: p.n, lat: p.lat, lon: p.lon, loc: p.loc || 'SIN LOCALIDAD', b: p.b, cam: 'pend', nCam: 0 }));
    (sim.sinUbicacion || []).forEach((p) => filas.push({ c: p.c, n: p.n, loc: 'SIN UBICACIÓN', b: p.b, cam: 'sinub', nCam: 0 }));
    pedidosSalen.quedan.forEach((p) => filas.push({ c: p.c, n: p.n, loc: locDe(p.c), b: p.b, cam: 'loc', nCam: 0 }));
  }

  const chequeos = calcularChequeos({
    sim, pedidosN: (pedidos?.data?.clientes || []).length, sinUbicN: sim ? sim.sinUbicacion.length : 0,
    quedanN: pedidosSalen.quedan.length, quedanBultos: pedidosSalen.quedan.reduce((s, c) => s + c.b, 0),
    choferesRutas, personalPresente, tiempos,
    noTocanN: filas.filter((f) => dentro(f) && noTocaCod(f.c)).length,
    grandesFueraN: filas.filter((f) => dentro(f) && grandeB(f.b) && habitual(f.c) === 'fuera').length,
    fueraSinMotivoN: filas.filter((f) => f.cam === 'pend' && !motDe(f.c)).length,
    costoSinConfig: !!(costoPers && costoPers.total === 0), agregados: sim ? sim.agregados || 0 : 0,
    preciosViejos: Object.values(params.fechasMarca || {}).some((s) => String(s).includes('⚠')), precioError: precioInfo.estado === 'error',
  });
  const nErr = chequeos.filter((x) => x.nivel === 'error').length, nAv = chequeos.filter((x) => x.nivel === 'aviso').length;
  const avisosPaso = (n) => chequeos.filter((x) => x.paso === n && x.nivel !== 'info').length;

  // ── Edición manual del reparto (sobre la propuesta del motor) ─────────────
  const guardarPlan = (pl) => guardarAsig(ausentes, cubre, manual, excluidas, camionesLoc, pl);
  const moverA = (cods, v, motivo = motivoNuevo) => {
    if (!v || !sim || !cods.length) return;
    // Decisión sobre clientes grandes (sale / queda fuera): se guarda para sugerirla la próxima vez.
    const dePend = new Set(((sim.pendEdit && sim.pendEdit.clientes) || []).map((p) => p.c));
    const porCod = new Map(); sim.rutas.forEach((r) => r.paradas.forEach((p) => porCod.set(p.c, p))); ((sim.pendEdit && sim.pendEdit.clientes) || []).forEach((p) => porCod.set(p.c, p));
    const ev = cods.map((c) => porCod.get(c)).filter((p) => p && p.b >= umbralGrande && ((v === 'pend') !== dePend.has(p.c)))
      .map((p) => ({ c: p.c, n: p.n, d: v === 'pend' ? 'fuera' : 'sale', f: fechaPedidos || iso(new Date()), ...(v === 'pend' ? { m: motivo } : {}) }));
    if (ev.length) registrarAprend({ eventos: ev });
    let np = planMover(baseEdit(), cods, v === 'nuevo' || v === 'pend' ? v : Number(v));
    if (v === 'pend' && motivo) np = planMotivo(np, cods, motivo);
    guardarPlan(np);
    setSelCli((s) => s.filter((c) => !cods.includes(c)));
  };
  const abrirDividir = (c) => {
    const d = plan && plan.division && plan.division[c];
    setDividiendo(c); setPartesDiv(d ? Object.fromEntries(d.map((x) => [x.id, x.b])) : {}); setPaso(3);
  };
  const aplicarDivision = (c) => {
    const partes = Object.entries(partesDiv).map(([id, b]) => ({ id: Number(id), b: Number(b) })).filter((x) => x.b > 0);
    if (partes.length < 2) { aviso('Elegí al menos dos camiones con bultos para dividir la carga.', 'err'); return; }
    guardarPlan(planDividir(baseEdit(), c, partes));
    setDividiendo(null); setPartesDiv({}); setSelCli([]);
  };
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
      {sim && sim.rutas.map((x, k) => ({ x, id: pidDe(x, k) })).filter((o) => o.id !== idExcluir).map((o) => <option key={o.id} value={o.id}>Camión #{o.x.n} · {zonaTxt(o.x)}</option>)}
      <option value="nuevo">➕ Camión nuevo</option>
      <option value="pend">📅 Otro día</option>
    </>
  );
  // Un camión a la vez en el mapa Y en la planilla (un solo "foco" para toda la pantalla)
  const enfocar = (i) => {
    const nuevo = rutaSel === i ? null : i;
    setRutaSel(nuevo);
    if (modo === 'simulacion' && sim) setFEstado(nuevo === null ? (/^\d+$/.test(fEstado) ? 'todos' : fEstado) : String(pidDe(sim.rutas[nuevo], nuevo)));
  };
  const irA = (it) => {
    setPaso(it.paso);
    if (it.foco && it.foco.camion != null && sim && rutaSel !== it.foco.camion) enfocar(it.foco.camion);
    if (it.foco && it.foco.filtro) setFEstado(it.foco.filtro);
  };
  const irAPaso = (n) => { setPaso(n); if (typeof window !== 'undefined') { const el = document.querySelector('.sim-pasos'); if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: 'start', behavior: 'smooth' }); } };

  const PASOS = [
    { n: 1, ic: '📦', t: 'Pedidos', d: 'Recepción: qué se entrega y en qué localidades' },
    { n: 2, ic: '🚚', t: 'Flota y rutas', d: 'Despacho: qué camión sale, con qué chofer y cuánta carga' },
    { n: 3, ic: '👥', t: 'Paradas', d: 'Cada entrega: reasignar, dejar fuera o dividir' },
    { n: 4, ic: '💰', t: 'Costos', d: 'Cierre: cuánto cuesta la jornada' },
  ];
  const navPaso = (n) => (
    <div className="sim-paso-nav">
      {n > 1 ? <button type="button" className="sim-btn" onClick={() => irAPaso(n - 1)}>← {PASOS[n - 2].t}</button> : <span />}
      {n < 4 ? <button type="button" className="sim-btn pri" onClick={() => irAPaso(n + 1)}>{PASOS[n].t} →</button> : <span />}
    </div>
  );
  const encabezadoPaso = (n) => (
    <div className="sim-paso-h">
      <h3>{PASOS[n - 1].ic} Paso {n} · {PASOS[n - 1].t}</h3>
      <span className="sim-sub">{PASOS[n - 1].d}</span>
      <Ayuda clave={`paso${n}`} />
    </div>
  );
  const avisosDelPaso = (n) => chequeos.filter((x) => x.paso === n).map((x) => (
    <button type="button" key={x.id} className={`sim-chk-it ${x.nivel}`} onClick={() => irA(x)} title={x.detalle}>
      <span className="ic">{x.nivel === 'error' ? '⛔' : x.nivel === 'aviso' ? '⚠' : 'ℹ'}</span>
      <span><b>{x.titulo}</b>{x.detalle ? <span className="sim-sub"> — {x.detalle}</span> : null}</span>
    </button>
  ));

  // ── Calendario ────────────────────────────────────────────────────────────
  const tarjetaCal = (
    <div className="sim-calbox">
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
  );

  // ── PASO 1 · Pedidos ──────────────────────────────────────────────────────
  const tarjetaPedidos = (
    <section className="sim-card">
      <h3>Pedidos de mañana</h3>
      <div className="sim-form">
        <label className="sim-sub">Se entrega el
          <input className="sim-input" type="date" value={fechaNueva} onChange={(e) => setFechaNueva(e.target.value)} />
        </label>
        <label className="sim-sub">Pedidos hechos el día
          <input className="sim-input" type="date" value={fechaPed} onChange={(e) => setFechaPed(e.target.value)} />
        </label>
      </div>
      <input ref={refPed} type="file" accept=".xlsx,.xls,.csv" hidden
        onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) subirPedidos(f, fechaNueva, fechaPed); }} />
      <input ref={refPed2} type="file" accept=".xlsx,.xls,.csv" hidden
        onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) subirPedidos(f, fechaNueva, fechaPed, true); }} />
      <div className="sim-row" style={{ marginTop: 8 }}>
        <button className="sim-btn pri" disabled={ocupado || !fechaPed} onClick={() => refPed.current.click()}>📦 Subir pedidos del día (Excel)</button>
        {pedidos?.data && pedidos.data.clientes.length > 0 && (
          <button className="sim-btn" disabled={ocupado} title="Borra todos los pedidos cargados (de todas las fechas). Queda guardada la carga anterior para el cuadro de cambios."
            onClick={() => { if (window.confirm(`¿Borrar TODOS los pedidos cargados (${pedidos.data.clientes.length} clientes)? Los demás usuarios también los dejan de ver.`)) { setOcupado(true); borrarPedidos().catch((e) => aviso(e.message, 'err')).finally(() => setOcupado(false)); } }}>🗑 Borrar todos los pedidos</button>
        )}
        <button className="sim-btn" disabled={ocupado || !fechaPed || !pedidos?.data} onClick={() => refPed2.current.click()}
          title="Otro archivo de la misma fecha de pedido (ej. Tandil y zona + Las Flores y zona): se agrega sin borrar el anterior">➕ Sumar otro archivo (misma fecha)</button>
      </div>
      {pedidos?.data && pedidos.data.fechaEntrega === fechaNueva && Object.keys(capasDe(pedidos.data, fechaNueva)).length > 0 && (
        <div className="sim-capas">
          <b>Se entrega el {fechaLarga(fechaNueva)} · pedidos acumulados</b>
          {Object.entries(capasDe(pedidos.data, fechaNueva)).sort().map(([k, v]) => (
            <div key={k} className="sim-capa">{k ? `Hechos el ${fechaLarga(k)}` : 'Carga anterior'}: {v.clientes.length} cl. · {f0(v.clientes.reduce((t, c) => t + c.b, 0))} bultos{' '}
              <button className="sim-btn" disabled={ocupado} title="Quitar los pedidos de esta fecha" aria-label="Quitar estos pedidos"
                onClick={() => { if (window.confirm(`¿Quitar los pedidos hechos el ${k ? fechaLarga(k) : 'de la carga anterior'}?`)) { setOcupado(true); guardarPedidos({ clientes: [] }, '', fechaNueva, false, k, true).catch((e) => aviso(e.message, 'err')).finally(() => setOcupado(false)); } }}>🗑 Quitar</button></div>
          ))}
          <b>Total: {pedidos.data.clientes.length} clientes · {f0(pedidos.data.clientes.reduce((t, c) => t + c.b, 0))} bultos</b>
        </div>
      )}
      <div className="sim-sub" style={{ marginTop: 8 }}>
        {pedidos?.data ? <>Vigente: <b>{pedidos.data.archivo}</b> para el <b>{fechaLarga(pedidos.data.fechaEntrega)}</b>
          {pedidos.updatedBy ? <> · cargó {decodeURIComponent(pedidos.updatedBy)}</> : null}
          {pedidos.updatedAt ? <> · {new Date(pedidos.updatedAt).toLocaleString('es-AR')}</> : null}</> : 'Todavía no hay pedidos cargados.'}
        <br />Ubicaciones conocidas: {f0(ubicItems.length)} clientes. El romaneo del ruteador y la maestra de clientes se suben en <b>📂 Importar</b>.
      </div>
    </section>
  );

  const tarjetaLocs = pedidos?.data && (
    <section className="sim-card">
      <h3>📍 Localidades que salen{fechaPedidos ? ` el ${fechaLarga(fechaPedidos)}` : ''}</h3>
      <div className="sim-sub" style={{ marginBottom: 8 }}>Destildá las que ese día no se reparten (por ejemplo Cachari si se va el miércoles): se sacan de la simulación y quedan para otro día. A la derecha podés fijar cuántos camiones salen (vacío = lo calcula solo).</div>
      <div className="sim-row" style={{ marginBottom: 8 }}>
        <button className="sim-btn" disabled={!excluidas.length} onClick={() => guardarAsig(ausentes, cubre, manual, [])}>✔ Que salgan todas</button>
        <button className="sim-btn" disabled={excluidas.length === locsPedidos.length} onClick={() => guardarAsig(ausentes, cubre, manual, locsPedidos.map((o) => o.loc))}>✖ Ninguna</button>
        {habitualDia && habitualDia.locs.length > 0 && (
          <button className="sim-btn" title={`Según los últimos ${habitualDia.dias} días iguales del historial, estas localidades casi siempre salen ese día: ${habitualDia.locs.map(cap).join(', ')}`}
            onClick={() => guardarAsig(ausentes, cubre, manual, locsPedidos.filter((o) => o.loc !== 'SIN LOCALIDAD' && !habitualDia.locs.includes(o.loc)).map((o) => o.loc))}>🧠 Solo las que suelen salir este día</button>
        )}
        {Object.keys(camionesLoc).length > 0 && <button className="sim-btn" onClick={() => guardarAsig(ausentes, cubre, manual, excluidas, {})}>↩ Camiones automáticos en todas</button>}
      </div>
      <div className="sim-locs">
        {locsPedidos.map((o) => {
          const sale = !excluidas.includes(o.loc);
          return (
            <div key={o.loc} className={`sim-loc ${sale ? '' : 'off'}`} title={o.loc === 'SIN LOCALIDAD' ? `Clientes que no están en la maestra o no tienen localidad y no hay vecinos cerca para estimarla. Ej.: ${o.ej.join(' · ')}` : (o.est ? `${o.est} clientes no están en la maestra: se les estimó la localidad por los vecinos más cercanos.` : undefined)}>
              <label>
                <input type="checkbox" checked={sale}
                  onChange={() => guardarAsig(ausentes, cubre, manual, sale ? [...excluidas, o.loc] : excluidas.filter((x) => x !== o.loc))} />
                <span className="nom"><b>{cap(o.loc)}</b>
                  <span className="sim-sub">{o.clientes} cl. · {f0(o.bultos)} bultos{o.est ? ` · ${o.est} estimados` : ''}{o.loc === 'SIN LOCALIDAD' ? ' · no están en la maestra' : ''}</span></span>
              </label>
              {sale && (
                <span className="cam">
                  <input type="number" min="0" max="20" step="1" placeholder="auto" aria-label={`Camiones para ${cap(o.loc)} (vacío = automático)`}
                    value={camionesLoc[o.loc] || ''}
                    onChange={(e) => { const n = Math.floor(Number(e.target.value)) || 0; const cl = { ...camionesLoc }; if (n > 0) cl[o.loc] = Math.min(20, n); else delete cl[o.loc]; guardarAsig(ausentes, cubre, manual, excluidas, cl); }} />
                  <span className="sim-sub">camiones</span>
                </span>
              )}
            </div>
          );
        })}
      </div>
      {pedidosSalen.quedan.length > 0 && (
        <div className="sim-warn" style={{ marginTop: 8 }}>
          Quedan para otro día: {pedidosSalen.quedan.length} clientes · {f0(pedidosSalen.quedan.reduce((s, c) => s + c.b, 0))} bultos ({excluidas.map(cap).join(', ')}).
        </div>
      )}
    </section>
  );

  const bloquePaso1 = (
    <>
      {encabezadoPaso(1)}
      {tarjetaPedidos}
      {cambios && (cambios.salen + cambios.entran + cambios.cambian > 0) && (
        <div className="sim-msg">
          <b>Cambios desde la carga anterior</b> ({pedidos.data.anterior.archivo}):{' '}
          {cambios.salen > 0 && <>salieron <b>{cambios.salen}</b> clientes ({txtLoc(cambios.salenPorLoc)}). </>}
          {cambios.entran > 0 && <>Entraron <b>{cambios.entran}</b> nuevos ({txtLoc(cambios.entranPorLoc)}). </>}
          {cambios.cambian > 0 && <>{cambios.cambian} cambiaron de bultos. </>}
          Bultos: {f0(cambios.bultosAntes)} → <b>{f0(cambios.bultosAhora)}</b>.
        </div>
      )}
      {ubic.size === 0 && pedidos?.data && (
        <div className="sim-msg">
          <b>Todavía no hay ubicaciones de clientes.</b> Cargá la maestra de clientes y/o los romaneos del ruteador en <b>📂 Importar → 🧭 Ruteo</b>; con eso la simulación arma camiones, km y combustible y dibuja el mapa.
        </div>
      )}
      {tarjetaLocs}
      {!pedidos?.data && <div className="sim-card sim-empty">Subí el Excel de pedidos para simular la entrega.<br />Se calcula en tu navegador y lo ve en vivo cualquier usuario con acceso.</div>}
      {pedidos?.data && !sim && <div className="sim-card sim-empty">No sale ninguna localidad: tildá alguna arriba para simular.</div>}
      {ruteados && (
        <Seccion titulo="✅ Ya ruteados (salieron de la lista)" abierta={false} insignia={`${f0(ruteados.clientes)} cl.`}>
          <div className="sim-sub" style={{ marginBottom: 8 }}>
            {f0(ruteados.clientes)} clientes · {f0(ruteados.bultos)} bultos pedidos. Por localidad: {Object.entries(ruteados.porLoc).sort((a, b) => b[1].bultos - a[1].bultos)
              .map(([l, o]) => `${cap(l)} ${o.clientes} cl. / ${f0(o.bultos)} b`).join(' · ')}
          </div>
          {ruteados.porRuta ? (
            <div style={{ overflowX: 'auto' }}>
              <table className="sim-table">
                <thead><tr><th>Salió en</th><th>Vehículo</th><th>Clientes</th><th>Bultos pedidos</th>{rechPed && rechPed.length > 0 && <><th title="Bultos que se facturaron en la entrega (según la tabla de Rechazos)">Bultos entregados*</th><th title="Bultos que el cliente devolvió o no aceptó">Devueltos por clientes</th></>}<th>Km ruta</th><th>Horario</th></tr></thead>
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
            <div className="sim-sub">Todavía no está el romaneo del {fechaLarga(fechaPedidos)}. Cuando lo subas en <b>📂 Importar</b>, acá vas a ver en qué camión salió cada grupo{puedeVerRechazos ? ' y, después de la entrega, cómo salió realmente (rechazos).' : '.'}</div>
          )}
        </Seccion>
      )}
      <Seccion titulo="📅 Calendario y romaneos anteriores" abierta={false} insignia={lista.length ? `${lista.length} días` : ''}>{tarjetaCal}</Seccion>
      {navPaso(1)}
    </>
  );

  // ── PASO 2 · Camiones ─────────────────────────────────────────────────────
  const escJornada = sim ? Math.max(tiempos.limite * 1.15, 600, ...sim.rutas.map((r) => minutosRuta(tiempos, { paradas: r.paradas.length, km: r.km, bultos: r.bultos }))) : 600;
  const tarjetaCamion = (r, i) => {
    const id = pidDe(r, i), ch = choferesRutas[i];
    const base = tiempos.base, cond = tiempos.porKm * r.km, serv = tiempos.porParada * r.paradas.length + tiempos.porBulto * r.bultos, tot = base + cond + serv;
    const largo = tot > tiempos.limite, pj = (m) => `${(m / escJornada) * 100}%`;
    const abiertoC = abierto === id;
    const porLoc = new Map();
    r.paradas.forEach((p) => { const l = p.loc || 'SIN LOCALIDAD'; const o = porLoc.get(l) || { loc: l, cods: [], b: 0 }; o.cods.push(p.c); o.b += p.b; porLoc.set(l, o); });
    const pers = costoPers ? costoPers.porRuta[i] : null;
    return (
      <article key={id} className={`sim-cam ${rutaSel === i ? 'foco' : ''}`} style={{ borderLeftColor: COLORES[i % COLORES.length] }}>
        <header className="sim-cam-h">
          <span className="sim-chip" style={{ background: COLORES[i % COLORES.length] }} />
          <b>Camión #{r.n}</b>
          <span className="zona">{zonaTxt(r)}</span>
          {r.pocaCarga && <span className="sim-pill aviso" title="Muy poca carga y ningún camión cercano con lugar: conviene postergar o agrupar con otro día">poca carga</span>}
          {r.autoelevador && <span className="sim-pill" title={GLOSARIO.autoelevador}>autoelevador</span>}
          {r.extraAyudante && <span className="sim-pill" title="2º ayudante: con 3 personas este camión no necesita recarga">+1 ayudante</span>}
          {r.paradas.some((p) => p.parte) && <span className="sim-pill" title="Lleva la parte de un cliente dividido entre camiones">✂ carga dividida</span>}
        </header>
        <div className="sim-cam-chofer">
          <label>Chofer
            <select value={(ch && ch.chofer) || ''} title={(ch && ch.motivo) || ''}
              onChange={(e) => { const m = { ...manual }; if (e.target.value) m[claveAncla(r)] = e.target.value; else delete m[claveAncla(r)]; guardarAsig(ausentes, cubre, m); }}>
              <option value="">sin chofer</option>
              {perfiles.filter((p) => !p.mercado && !ausEf.includes(p.nombre)).map((p) => <option key={p.nombre} value={p.nombre}>{p.nombre}</option>)}
            </select>
          </label>
          {ch && ch.motivo && !manual[claveAncla(r)] && <span className="sim-sub">{ch.motivo}</span>}
          {!r.autoelevador && (
            <label>Personas
              <select value={manual[`n${claveAncla(r)}`] || ''} title="Cuántas personas salen en este camión. Con 3 no hace falta recarga hasta los bultos de Configuración."
                onChange={(e) => { const m = { ...manual }; if (e.target.value) m[`n${claveAncla(r)}`] = e.target.value; else delete m[`n${claveAncla(r)}`]; guardarAsig(ausentes, cubre, m); }}>
                <option value="">auto ({r.personasManual ? 'a mano' : r.personas})</option>
                <option value="2">2 (chofer + 1)</option>
                <option value="3">3 (chofer + 2)</option>
              </select>
            </label>
          )}
        </div>
        {r.recargas > 0 && !r.autoelevador && (
          <div className="sim-neg" role="alert">⛔ Lleva {f0(r.bultos)} bultos: pasa los {f0(r.limiteRecarga)} que entran sin recarga con {r.personas} personas. {r.personas < 3 && r.bultos <= params.limiteRecarga3 ? 'Ponele 3 personas o ' : ''}Hace 1 recarga (costo y tiempo extra).</div>
        )}
        {r.zonas && r.zonas.length > 1 && (
          <div className="sim-cam-zonasinfo" role="note">
            <div className="sim-sub"><b>Un solo viaje por {r.zonas.length} zonas</b> (en este orden de lejanía desde el depósito):</div>
            <ul>
              {r.zonas.map((z) => <li key={z.loc}><b>{cap(z.loc)}</b> · {z.clientes} cl. · {f0(z.bultos)} b · a {f0(z.kmDeposito)} km del depósito</li>)}
            </ul>
            <div className={`sim-sub ${r.sepKm > 40 ? 'mal' : ''}`}>
              {r.sepKm > 40 ? `⚠ Las zonas quedan a ${f0(r.sepKm)} km entre sí: es un viaje largo. ` : `Las zonas quedan a ${f0(r.sepKm)} km entre sí. `}
              {(() => {
                const pares = []; for (let a = 0; a < r.zonas.length; a++) for (let b = a + 1; b < r.zonas.length; b++) { const v = veces(afinidad, r.zonas[a].loc, r.zonas[b].loc); if (v) pares.push({ a: r.zonas[a].loc, b: r.zonas[b].loc, ...v }); }
                const nunca = pares.filter((x) => x.veces === 0);
                return nunca.length ? ` En el historial ${nunca.map((x) => `${cap(x.a)} y ${cap(x.b)}`).join(', ')} nunca salieron juntas: se juntaron por falta de camiones o por carga.` : pares.length ? ` En el historial salieron juntas: ${pares.map((x) => `${cap(x.a)} + ${cap(x.b)} ${x.veces} de ${Math.min(x.diasA, x.diasB)} días`).join(' · ')}.` : ' Sin historial para comparar.';
              })()}
              {' '}Podés cambiar cómo se juntan en «Juntar localidades» (arriba).
            </div>
          </div>
        )}
        <dl className="sim-cam-stats">
          <div><dt>Paradas</dt><dd>{r.paradas.length}</dd></div>
          <div><dt>Bultos</dt><dd>{f0(r.bultos)}</dd></div>
          <div><dt>Pallets</dt><dd>{f1(r.pallets)}</dd></div>
          <div><dt>Km{r.kmCalle ? ' 🛣️' : ''}</dt><dd>{f0(r.km)}</dd></div>
          <div><dt>Personas</dt><dd>{r.personas}</dd></div>
        </dl>
        <div className="sim-cam-barras">
          <div className="fila" title={GLOSARIO.ocupacion}>
            <span className="et">Ocupación</span>
            <div className="sim-bar"><i className={r.ocupacion > 0.8 ? 'alto' : r.ocupacion < 0.4 ? 'bajo' : ''} style={{ width: `${Math.min(100, r.ocupacion * 100)}%` }} /></div>
            <b className={r.ocupacion > 1 ? 'mal' : ''}>{f0(r.ocupacion * 100)} %</b>
          </div>
          <div className="fila" title={`Salida y carga ${f0(base)} min · conducción ${f0(cond)} min · paradas ${f0(serv)} min · límite habitual ${hm(tiempos.limite)}`}>
            <span className="et">Jornada</span>
            <div className="sim-jor">
              <i style={{ left: 0, width: pj(base), background: '#b0bec5' }} />
              <i style={{ left: pj(base), width: pj(cond), background: '#5c8dd6' }} />
              <i style={{ left: pj(base + cond), width: pj(serv), background: '#66bb6a' }} />
              <i className="lim" style={{ left: pj(tiempos.limite) }} />
            </div>
            <b className={largo ? 'mal' : ''}>{hm(tot)}{largo ? ' ⚠' : ''}</b>
          </div>
        </div>
        <div className="sim-cam-costo">
          <span>Combustible <b>{money(r.combustible)}</b> ({f1(r.litros)} L{r.utilitario ? ', util.' : ''})</span>
          {pers != null && <span>Personal <b>{money(pers)}</b></span>}
          <span className="tot">Total <b>{money(r.combustible + (pers || 0))}</b></span>
          <span className="rec">{r.recargas ? (r.alertaRecarga ? <span className="sim-pill aviso" title={`Más de ${params.maxConRecarga} bultos con recarga: revisar`}>🔁 1 recarga ⚠ revisar</span> : <span className="sim-pill">🔁 1 recarga</span>) : <span className="sim-sub">sin recarga (hasta {r.limiteRecarga} bultos)</span>}</span>
        </div>
        <footer className="sim-cam-f">
          <button type="button" className="sim-btn" aria-pressed={rutaSel === i} onClick={() => enfocar(i)}>📍 {rutaSel === i ? 'Ver todos' : 'Ver en el mapa'}</button>
          <button type="button" className="sim-btn" onClick={() => { setRutaSel(i); setFEstado(String(id)); irAPaso(3); }}>👥 Sus clientes</button>
          <button type="button" className="sim-btn" aria-expanded={abiertoC} onClick={() => setAbierto(abiertoC ? null : id)}>{abiertoC ? '▾ Menos' : '▸ Juntar, partir, orden'}</button>
        </footer>
        {abiertoC && (
          <div className="sim-cam-det">
            <div className="sim-sub">Zonas de este camión (pasá una zona entera a otro camión):</div>
            <div className="sim-cam-zonas">
              {[...porLoc.values()].map((o) => (
                <span key={o.loc}><b>{cap(o.loc)}</b> <span className="sim-sub">{o.cods.length} cl. · {f0(o.b)} b</span>{' '}
                  <select value="" aria-label={`Mover ${cap(o.loc)} a otro camión`} onChange={(e) => moverA(o.cods, e.target.value)}><option value="">mover a…</option>{opcionesDestino(id)}</select></span>
              ))}
            </div>
            <div className="sim-row" style={{ margin: '8px 0' }}>
              <select value="" aria-label="Juntar con otro camión" onChange={(e) => { if (e.target.value) guardarPlan(planJuntar(baseEdit(), id, Number(e.target.value))); }}>
                <option value="">Juntar con…</option>
                {sim.rutas.map((x, k) => ({ x, k })).filter(({ k }) => pidDe(sim.rutas[k], k) !== id).map(({ x, k }) => <option key={pidDe(x, k)} value={pidDe(x, k)}>Camión #{x.n}</option>)}
              </select>
              <button className="sim-btn" disabled={r.paradas.length < 2} onClick={() => guardarPlan(planPartir(baseEdit(), id, r, params.deposito))}>✂️ Partir en 2</button>
            </div>
            <div className="sim-sub">Orden de visita: {r.ordenManual ? 'fijado a mano' : 'automático (el más corto)'}{' '}
              {r.ordenManual && <button className="sim-btn" onClick={() => guardarPlan(planOrdenAuto(baseEdit(), id))}>Volver al automático</button>}</div>
            <ol className="sim-orden">
              {r.paradas.map((p, k) => {
                const cods = r.paradas.map((x) => x.c);
                const mv = (d) => { const n = cods.slice(); const t = n[k]; n[k] = n[k + d]; n[k + d] = t; guardarPlan(planOrdenar(baseEdit(), id, n)); };
                return (
                  <li key={p.c}>
                    <span className="n">{k + 1}</span>
                    <span className="nom">{p.n}<span className="sim-sub"> · {cap(p.loc)} · {f1(p.b)} b</span></span>
                    <button className="sim-btn" disabled={k === 0} aria-label="Subir en el orden" onClick={() => mv(-1)}>↑</button>
                    <button className="sim-btn" disabled={k === r.paradas.length - 1} aria-label="Bajar en el orden" onClick={() => mv(1)}>↓</button>
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </article>
    );
  };

  const bloquePaso2 = sim && (
    <>
      {encabezadoPaso(2)}
      {avisosDelPaso(2).length > 0 && <div className="sim-chk-lista">{avisosDelPaso(2)}</div>}
      <section className="sim-card">
        <div className="sim-row">
          <span className="sim-sub"><b>Camiones disponibles</b> <Ayuda clave="tope" /></span>
          <input type="number" min="0" aria-label="Camiones disponibles" style={{ width: 64 }} value={params.maxCamiones || 0} onChange={(e) => setParams((p) => ({ ...p, maxCamiones: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))} />
          <button className="sim-btn" onClick={() => setParams((p) => ({ ...p, maxCamiones: Math.max(0, perfiles.filter((x) => !x.mercado && !ausEf.includes(x.nombre) && x.ultimo >= haceDias(fechaPedidos, 10)).length) }))}>Usar choferes presentes</button>
          <button className="sim-btn" onClick={() => setParams((p) => ({ ...p, maxCamiones: 0 }))}>Sin tope</button>
          <button className="sim-btn" aria-label="Un camión menos" onClick={() => setParams((p) => ({ ...p, maxCamiones: Math.max(1, (p.maxCamiones || sim.rutas.length) - 1) }))}>− 1</button>
          <button className="sim-btn" aria-label="Un camión más" onClick={() => setParams((p) => ({ ...p, maxCamiones: (p.maxCamiones || sim.rutas.length) + 1 }))}>+ 1</button>
          {calculando && <span className="sim-pill aviso" role="status">⏳ recalculando…</span>}
        </div>
        <div className="sim-row" style={{ marginTop: 6 }}>
          <label className="sim-sub"><b>Máx. bultos por camión</b>{' '}
            <input type="number" min="0" style={{ width: 80 }} value={params.maxBultosCamion || 0} title="0 = sin tope. Si no alcanzan los camiones disponibles, el sistema carga más a los que hay en vez de agregar camiones."
              onChange={(e) => setParams((p) => ({ ...p, maxBultosCamion: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))} /></label>
          {sim.rutas.some((r) => r.recargas > 0 && !r.autoelevador && r.bultos <= params.limiteRecarga3 && r.personas < 3) && (
            <button className="sim-btn" title="Les pone un 2º ayudante a los camiones que de otro modo harían recarga"
              onClick={() => { const m = { ...manual }; sim.rutas.forEach((r) => { if (r.recargas > 0 && !r.autoelevador && r.bultos <= params.limiteRecarga3 && r.personas < 3) m[`n${claveAncla(r)}`] = '3'; }); guardarAsig(ausentes, cubre, m); }}>👥 Poner 3 personas donde hay recarga</button>
          )}
          {sim.rutas.some((r) => r.personasManual) && <button className="sim-btn" onClick={() => { const m = { ...manual }; Object.keys(m).forEach((k) => { if (k[0] === 'n') delete m[k]; }); guardarAsig(ausentes, cubre, m); }}>↩ Personas automáticas</button>}
        </div>
        <div className="sim-row" style={{ marginTop: 8 }}>
          <label className="sim-sub"><b>Juntar localidades</b>{' '}
            <select value={params.mezclarLocalidades === false ? 'nunca' : (params.modoMezcla || 'historial')} aria-label="Cómo juntar localidades en un camión"
              onChange={(e) => setParams((p) => ({ ...p, mezclarLocalidades: e.target.value !== 'nunca', modoMezcla: e.target.value === 'nunca' ? 'historial' : e.target.value }))}>
              <option value="historial">Solo las que ya salieron juntas (recomendado)</option>
              <option value="libre">Libre: por cercanía y ahorro de km</option>
              <option value="nunca">Nunca: un camión por localidad</option>
            </select>
          </label>
        </div>
        {habitualDia && (
          <div className="sim-sub" style={{ marginTop: 6 }}>📈 <b>Lo habitual</b>: en los últimos {habitualDia.dias} {new Date(`${fechaPedidos}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'long' })} salieron en promedio {f1(habitualDia.camiones)} camiones propios con {f0(habitualDia.bultos / (habitualDia.camiones || 1))} bultos cada uno
            {habitualDia.locs.length ? <> · localidades que casi siempre salen ese día: {habitualDia.locs.map(cap).join(', ')}</> : null}.</div>
        )}
        <div className="sim-sub" style={{ marginTop: 6 }}>Hacen falta {sim.tope ? sim.tope.necesarios : sim.rutas.length} con la carga normal ({f0(params.maxBultosCamion || 0)} bultos máx.) · el sistema armó {sim.rutas.length}.{sim.tope && sim.tope.ajuste ? <> <b>Para no agregar camiones: {sim.tope.ajuste}.</b></> : null} Tocá «Ver en el mapa» en un camión para verlo solo.</div>
      </section>
      <div className="sim-cams">{sim.rutas.map((r, i) => tarjetaCamion(r, i))}</div>
      <div className="sim-sub">▮ gris: salida y carga · ▮ azul: conducción · ▮ verde: paradas · ┃ rojo: límite habitual de jornada. {GLOSARIO.km}</div>

      <Seccion titulo="👷 Personal del día" ayuda="personal" abierta={false} insignia={`${personalPresente} presentes`} tono={sim.totales.personas > personalPresente ? 'aviso' : ''}>
        <div className="sim-sub" style={{ marginBottom: 6 }}>Cada chofer sale por su zona habitual (aprendida del historial)
          {fechaPedidos ? <> · zona del {zonaDelDia(fechaPedidos) || '—'}</> : null}. Si alguien no vino, destildalo y elegí quién cubre su zona. Se comparte en vivo con los demás.</div>
        <label className="sim-sub" style={{ display: 'block', marginBottom: 6 }}>
          <input type="checkbox" checked={(params.autoelevador || []).includes('LAS FLORES')}
            onChange={(e) => setParams((p) => ({ ...p, autoelevador: e.target.checked ? ['LAS FLORES'] : [] }))} /> Las Flores se descarga con autoelevador <Ayuda clave="autoelevador" />
        </label>
        {perfiles.filter((p) => !p.mercado).slice(0, 16).map((p) => {
          const auto = ausAuto.get(normN(p.nombre)); const falta = !!auto || ausentes.includes(p.nombre);
          return (
            <div key={p.nombre} className="sim-pers">
              <label>
                <input type="checkbox" checked={!falta} disabled={!!auto}
                  onChange={() => guardarAsig(falta ? ausentes.filter((x) => x !== p.nombre) : [...ausentes, p.nombre], cubre, manual)} /> <b>{p.nombre}</b>
              </label>
              <span className="sim-sub">{p.etiqueta}{p.deZonaDelDia ? ' · zona de hoy' : ''}</span>
              {!falta && ausEf.length > 0 && (
                <select value={cubre[p.nombre] || ''} aria-label={`Zona que cubre ${p.nombre}`} onChange={(e) => { const c = { ...cubre }; if (e.target.value) c[p.nombre] = e.target.value; else delete c[p.nombre]; guardarAsig(ausentes, c, manual); }}>
                  <option value="">cubre su propia zona</option>
                  {ausEf.map((a) => <option key={a} value={a}>cubre la zona de {a}</option>)}
                </select>
              )}
              {falta && <span className="sim-pill aviso">{auto ? `Ausencias: ${auto}` : 'no vino'}</span>}
            </div>
          );
        })}
        {perfiles.length === 0 && <div className="sim-sub">Todavía no hay romaneos cargados para aprender las zonas de los choferes.</div>}
        <div className="sim-sub" style={{ marginTop: 6 }}>
          Presentes según Config y Ausencias: <b>{personalPresente}</b> · la simulación necesita <b>{sim.totales.personas}</b> ({sim.rutas.length} camiones × chofer + {params.ayudantesPorCamion} ayudante{params.ayudantesPorCamion === 1 ? '' : 's'}).
        </div>
      </Seccion>
      {navPaso(2)}
    </>
  );

  // ── PASO 3 · Clientes (planilla) ──────────────────────────────────────────
  const q = fTxt.trim().toLowerCase();
  const visibles = sim ? filas.filter((f) => (!q || `${f.c} ${f.n} ${f.loc}`.toLowerCase().includes(q)) && (!fLoc || f.loc === fLoc)
    && (fEstado === 'todos' || (fEstado === 'fuera' ? (f.cam === 'pend' || f.cam === 'loc') : fEstado === 'grandes' ? grandeB(f.b) : fEstado === 'notoca' ? noTocaCod(f.c) : String(f.cam) === fEstado)))
    .sort((x, y) => { const k = ordenPl.k; const a = k === 'n' || k === 'loc' ? String(x[k]) : x[k], b = k === 'n' || k === 'loc' ? String(y[k]) : y[k]; return (a < b ? -1 : a > b ? 1 : 0) * ordenPl.d; }) : [];
  const editables = visibles.filter(dentro).concat(visibles.filter((f) => f.cam === 'pend'));
  const selSet = new Set(selCli);
  const todosSel = editables.length > 0 && editables.every((f) => selSet.has(f.c));
  const grandes = filas.filter((f) => grandeB(f.b));
  const thP = (k, t) => <th style={{ cursor: 'pointer' }} onClick={() => setOrdenPl((o) => ({ k, d: o.k === k ? -o.d : (k === 'b' ? -1 : 1) }))}>{t}{ordenPl.k === k ? (ordenPl.d > 0 ? ' ▲' : ' ▼') : ''}</th>;
  const fichas = [
    ['todos', 'Todos', filas.length, ''],
    ['fuera', '🚫 Fuera', filas.filter((f) => f.cam === 'pend' || f.cam === 'loc').length, ''],
    ['grandes', '⚠ Grandes', grandes.length, ''],
    ['notoca', '📅 Hoy no tocan', filas.filter((f) => noTocaCod(f.c)).length, ''],
  ];

  const panelDividir = dividiendo !== null && sim && (() => {
    const tot = ((simAuto ? simAuto.rutas : []).flatMap((r) => r.paradas).find((x) => x.c === dividiendo) || {}).b || filas.filter((f) => f.c === dividiendo).reduce((t, f) => t + f.b, 0);
    const nom = (filas.find((f) => f.c === dividiendo) || {}).n || dividiendo;
    const marc = sim.rutas.map((x, k) => pidDe(x, k)).filter((id) => partesDiv[id] !== undefined);
    const suma = marc.reduce((t, id) => t + (Number(partesDiv[id]) || 0), 0);
    const parejo = () => { const n = marc.length || 0; if (!n) return; const o = {}; marc.forEach((id) => { o[id] = Math.round((tot / n) * 10) / 10; }); setPartesDiv(o); };
    return (
      <div className="sim-dividir">
        <b>✂ Dividir la carga de {nom} (cód. {dividiendo}) · {f1(tot)} bultos</b> <Ayuda clave="dividir" />
        <div className="sim-sub" style={{ margin: '4px 0' }}>Tildá los camiones que van a llevar una parte y poné los bultos de cada uno.</div>
        <div className="sim-row">
          {sim.rutas.map((x, k) => { const id = pidDe(x, k); const on = partesDiv[id] !== undefined; return (
            <label key={id} className="sim-sub sim-parte">
              <input type="checkbox" checked={on} onChange={(e) => setPartesDiv((o) => { const n = { ...o }; if (e.target.checked) n[id] = 0; else delete n[id]; return n; })} /> #{x.n} {zonaTxt(x)}
              {on && <> <input type="number" min="0" value={partesDiv[id]} style={{ width: 70 }} aria-label={`Bultos en el camión ${x.n}`} onChange={(e) => setPartesDiv((o) => ({ ...o, [id]: e.target.value }))} /> b</>}
            </label>); })}
        </div>
        <div className="sim-row" style={{ marginTop: 6 }}>
          <button className="sim-btn" onClick={parejo}>Repartir parejo</button>
          <span className="sim-sub" style={{ color: Math.abs(suma - tot) > 0.6 ? '#b45309' : undefined }}>Suma {f1(suma)} de {f1(tot)} bultos{Math.abs(suma - tot) > 0.6 ? ' (se ajusta en proporción)' : ''}</span>
          <button className="sim-btn pri" onClick={() => aplicarDivision(dividiendo)}>Aplicar división</button>
          {plan && plan.division && plan.division[dividiendo] && (
            <select value="" aria-label="Volver a un solo camión" onChange={(e) => { if (e.target.value) { guardarPlan(planUnir(plan, dividiendo, e.target.value === 'nuevo' ? 'nuevo' : Number(e.target.value))); setDividiendo(null); } }}>
              <option value="">Volver a un solo camión…</option>{sim.rutas.map((x, k) => <option key={pidDe(x, k)} value={pidDe(x, k)}>#{x.n}</option>)}
            </select>)}
          <button className="sim-btn" onClick={() => { setDividiendo(null); setPartesDiv({}); }}>Cancelar</button>
        </div>
      </div>);
  })();

  const bloquePaso3 = sim && (
    <>
      {encabezadoPaso(3)}
      {avisosDelPaso(3).length > 0 && <div className="sim-chk-lista">{avisosDelPaso(3)}</div>}
      <section className="sim-card">
        <div className="sim-fichas" role="group" aria-label="Filtrar clientes">
          {fichas.map(([k, t, n]) => <button key={k} type="button" className={`sim-ficha ${fEstado === k ? 'on' : ''}`} aria-pressed={fEstado === k} onClick={() => setFEstado(fEstado === k ? 'todos' : k)}>{t} <b>{n}</b></button>)}
          <select value={/^\d+$/.test(fEstado) ? fEstado : ''} aria-label="Ver un solo camión" onChange={(e) => { setFEstado(e.target.value || 'todos'); if (!e.target.value) setRutaSel(null); }}>
            <option value="">Todos los camiones</option>
            {sim.rutas.map((r, i) => <option key={pidDe(r, i)} value={String(pidDe(r, i))}>Camión #{r.n} · {zonaTxt(r)}</option>)}
          </select>
        </div>
        <div className="sim-row" style={{ margin: '8px 0' }}>
          <input placeholder="Buscar cliente, código o localidad…" aria-label="Buscar cliente" value={fTxt} onChange={(e) => setFTxt(e.target.value)} style={{ flex: '1 1 180px', minWidth: 140 }} />
          <select value={fLoc} aria-label="Filtrar por localidad" onChange={(e) => setFLoc(e.target.value)}><option value="">Todas las localidades</option>{[...new Set(filas.map((f) => f.loc))].sort().map((l) => <option key={l} value={l}>{cap(l)}</option>)}</select>
        </div>
        <div className="sim-row" style={{ marginBottom: 8 }}>
          <button className="sim-btn" onClick={() => setSelCli(todosSel ? [] : editables.map((f) => f.c))}>{todosSel ? 'Desmarcar visibles' : `Marcar visibles (${editables.length})`}</button>
          {(() => { const lst = grandes.filter((f) => dentro(f) && habitual(f.c) === 'fuera').map((f) => f.c);
            return lst.length > 0 && <button className="sim-btn" title="Según el historial, estos clientes grandes casi siempre se llevan aparte o no salen en el ruteo" onClick={() => moverA(lst, 'pend')}>🧠 Dejar fuera los que suelen ir aparte ({lst.length})</button>; })()}
          {(() => { const lst = filas.filter((f) => dentro(f) && noTocaCod(f.c)).map((f) => f.c);
            return lst.length > 0 && <button className="sim-btn" title="Según la hoja Frecuencia del ruteador, estos clientes no tienen entrega este día de la semana" onClick={() => moverA(lst, 'pend')}>📅 Dejar fuera los que hoy no tocan ({lst.length})</button>; })()}
          {grandes.some(dentro) && <button className="sim-btn" onClick={() => setSelCli(grandes.filter((f) => dentro(f) || f.cam === 'pend').map((f) => f.c))}>Marcar los grandes</button>}
          <span className="sim-sub">Grande desde <input type="number" min="1" value={umbralGrande} style={{ width: 70 }} aria-label="Bultos desde los que un cliente es grande" onChange={(e) => setUmbralGrande(Math.max(1, Math.floor(Number(e.target.value)) || 1))} onBlur={() => { if (umbralGrande !== aprend.umbral) registrarAprend({ umbral: umbralGrande }); }} /> bultos <Ayuda clave="grande" /></span>
        </div>
        {panelDividir}
        <div className="sim-tabla">
          <table className="sim-table">
            <thead><tr><th></th>{thP('n', 'Cliente')}{thP('loc', 'Localidad')}{thP('b', 'Bultos')}{thP('cam', 'Camión')}<th>Frec. <Ayuda clave="frecuencia" /></th><th>Motivo <Ayuda clave="motivo" /></th></tr></thead>
            <tbody>
              {visibles.map((f, vi) => {
                const edit = dentro(f) || f.cam === 'pend';
                const fuera = f.cam === 'pend' || f.cam === 'loc';
                const color = dentro(f) ? COLORES[f.ruta % COLORES.length] : '#b0bec5';
                return (
                  <tr key={`${f.c}-${f.cam}-${vi}`} className={`${fuera ? 'fuera' : ''} ${grandeB(f.b) ? 'grande' : ''} ${selSet.has(f.c) ? 'marcado' : ''}`}>
                    <td><input type="checkbox" disabled={!edit} aria-label={`Marcar ${f.n}`} checked={selSet.has(f.c)} onChange={() => setSelCli((a) => (a.includes(f.c) ? a.filter((x) => x !== f.c) : [...a, f.c]))} /></td>
                    <td className="cli">
                      <span className="sim-chip" style={{ background: color }} />
                      {f.lat ? <button type="button" className="sim-btn sim-mini" title="Ver en el mapa" aria-label={`Ver ${f.n} en el mapa`} onClick={() => { const m = mapRef.current; if (m && m.flyTo) m.flyTo({ center: [f.lon, f.lat], zoom: 14 }); }}>📍</button> : null}
                      {' '}<span className="sim-sub">{f.c}</span> {f.n}
                      {f.parte && <span className="sim-pill" title="Carga dividida entre camiones">✂ parte</span>}
                      {grandeB(f.b) && <span className="sim-pill aviso" title={GLOSARIO.grande}>⚠ grande</span>}
                      {dentro(f) && (grandeB(f.b) || f.parte) && <button type="button" className="sim-btn sim-mini" title="Dividir la carga de este cliente entre varios camiones" aria-label={`Dividir la carga de ${f.n}`} onClick={() => abrirDividir(f.c)}>✂</button>}
                      {grandeB(f.b) && aprend.grandes[f.c] && (() => { const h = aprend.grandes[f.c]; return <span className="sim-sub" title="Según romaneos reales y tus decisiones"> historial: salió {h.s || 0} · aparte/fuera {h.f || 0}{(h.ds || h.df) ? ` · vos: sale ${h.ds || 0} / fuera ${h.df || 0}` : ''}</span>; })()}
                    </td>
                    <td>{cap(f.loc)}</td><td>{f1(f.b)}</td>
                    <td>{edit ? (
                      <select value={f.cam === 'pend' ? 'pend' : String(f.cam)} aria-label={`Camión de ${f.n}`} onChange={(e) => moverA([f.c], e.target.value)}>
                        {sim.rutas.map((x, k) => <option key={pidDe(x, k)} value={String(pidDe(x, k))}>#{x.n}{choferesRutas[k] && choferesRutas[k].chofer ? ` · ${choferesRutas[k].chofer.split(' ')[0]}` : ''}</option>)}
                        <option value="nuevo">➕ Nuevo</option><option value="pend">🚫 Fuera</option>
                      </select>
                    ) : f.cam === 'loc' ? 'Localidad fuera' : 'Sin ubicación'}</td>
                    <td>{frec[f.c] ? <span className="sim-sub" style={noTocaCod(f.c) ? { color: '#b45309', fontWeight: 600 } : undefined} title={noTocaCod(f.c) ? 'Hoy no es día de entrega de este cliente' : 'Días de entrega'}>{noTocaCod(f.c) ? '📅 ' : ''}{diasDeMascara(frec[f.c])}</span> : ''}</td>
                    <td>{f.cam === 'pend' ? (
                      <select value={motDe(f.c)} aria-label={`Motivo para ${f.n}`} onChange={(e) => guardarPlan(planMotivo(baseEdit(), [f.c], e.target.value))}><option value="">— elegí —</option>{MOTIVOS.map((m) => <option key={m} value={m}>{m}</option>)}</select>
                    ) : ''}</td>
                  </tr>
                );
              })}
              {visibles.length === 0 && <tr><td colSpan="7" className="sim-sub">Ningún cliente con ese filtro.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="sim-sub" style={{ marginTop: 6 }}>Mostrando {visibles.length} de {filas.length} clientes. Los marcados aparecen con borde naranja en el mapa y abajo te queda la barra para moverlos.</div>
      </section>
      {sim.pendEdit && sim.pendEdit.clientes.length > 0 && (
        <div className="sim-warn">
          <b>Quedan para otro día (por tu edición): {sim.pendEdit.clientes.length} clientes · {f0(sim.pendEdit.bultos)} bultos.</b>
          <div style={{ marginTop: 4 }}>
            {[...sim.pendEdit.clientes.reduce((m, p) => { const l = p.loc || 'SIN LOCALIDAD'; const o = m.get(l) || { loc: l, cods: [], b: 0 }; o.cods.push(p.c); o.b += p.b; return m.set(l, o); }, new Map()).values()].map((o) => (
              <span key={o.loc} style={{ marginRight: 14 }}>{cap(o.loc)} {o.cods.length} cl. · {f0(o.b)} bultos{' '}
                <select value="" aria-label={`Devolver ${cap(o.loc)} a un camión`} onChange={(e) => moverA(o.cods, e.target.value)}><option value="">devolver a…</option>{sim.rutas.map((x, k) => <option key={pidDe(x, k)} value={pidDe(x, k)}>Camión #{x.n} · {zonaTxt(x)}</option>)}<option value="nuevo">➕ Camión nuevo</option></select></span>
            ))}
          </div>
        </div>
      )}
      {navPaso(3)}
    </>
  );

  // ── PASO 4 · Costos ───────────────────────────────────────────────────────
  const bloquePaso4 = sim && (
    <>
      {encabezadoPaso(4)}
      {avisosDelPaso(4).length > 0 && <div className="sim-chk-lista">{avisosDelPaso(4)}</div>}
      <Seccion titulo="💰 Costo del día" ayuda="costo">
        <div className="sim-kpis">
          <div className="sim-kpi"><b>{money(sim.totales.combustible)}</b><span>Combustible · {f0(sim.totales.litros)} L</span></div>
          {costoPers && costoPers.total > 0 && <div className="sim-kpi"><b>{money(costoPers.total)}</b><span>Personal · {costoPers.dias} días hábiles</span></div>}
          {costoPers && costoPers.total > 0 && <div className="sim-kpi tot"><b>{money(costoPers.total + sim.totales.combustible)}</b><span>Combustible + personal</span></div>}
          {costoPers && costoPers.total > 0 && sim.totales.bultos > 0 && <div className="sim-kpi"><b>{money((costoPers.total + sim.totales.combustible) / sim.totales.bultos)}</b><span>por bulto</span></div>}
          {costoPers && costoPers.total > 0 && sim.totales.clientes > 0 && <div className="sim-kpi"><b>{money((costoPers.total + sim.totales.combustible) / sim.totales.clientes)}</b><span>por cliente</span></div>}
          <div className="sim-kpi"><b>{f0(sim.totales.km)}</b><span>Km {sim.conCalle === sim.rutas.length && sim.conCalle > 0 ? 'por calles' : 'estimados'}</span></div>
        </div>
        {costoPers && costoPers.total > 0 && sim.totales.recargas > 0 && (
          <div className="sim-dato">🔁 <b>{sim.totales.recargas} recarga{sim.totales.recargas === 1 ? '' : 's'}</b> · personal de esos camiones: {money(costoPers.recargas)} en total, <b>{money(costoPers.recargas / sim.totales.recargas)} c/u</b> (chofer + ayudante(s) a valor de un día) <Ayuda clave="recarga" /></div>
        )}
        {costoPers && costoPers.total > 0 && costoPers.extra > 0 && (
          <div className="sim-dato">👷 2º ayudante en {sim.rutas.filter((r) => r.extraAyudante).length} camión(es): {money(costoPers.extra)} (ya sumado al personal) · evita la recarga</div>
        )}
        {sim.totales.recargas === 0 && <div className="sim-dato">🔁 Ningún camión necesita recarga <Ayuda clave="recarga" /></div>}
        {costoPers && costoPers.total === 0 && <div className="sim-dato aviso">Cargá el costo de chofer y ayudante en Configuración para ver el personal y cuánto sale cada recarga.</div>}
      </Seccion>

      <Seccion titulo="📍 Por localidad" insignia={`${resumenLoc.length}`}>
        <div style={{ overflowX: 'auto' }}>
          <table className="sim-table">
            <thead><tr><th>Localidad</th><th>Camiones</th><th>Km</th><th>Litros</th><th>Combustible</th><th>$/cliente</th><th>$/bulto</th><th>Recargas</th></tr></thead>
            <tbody>
              {resumenLoc.map((o) => (
                <tr key={o.loc}><td>{cap(o.loc)}</td><td>{o.camiones}</td><td>{f0(o.km)}</td><td>{f1(o.litros)}</td>
                  <td>{money(o.combustible)}</td><td>{money(o.combustible / (o.clientes || 1))}</td><td>{money(o.combustible / (o.bultos || 1))}</td><td>{o.recargas}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="sim-sub" style={{ marginTop: 8 }}>Km de cada localidad = parte de la ruta según sus bultos. El costo usa la estación elegida abajo.</div>
      </Seccion>

      {sim.totales.litros > 0 && (
        <Seccion titulo={`⛽ ¿Dónde conviene cargar? (${f0(sim.totales.litros)} L)`}>
          {selGrado}
          <TarjetasMarcas litros={sim.totales.litros} km={sim.totales.km} bultos={sim.totales.bultos} clientes={sim.totales.clientes} params={params}
            onElegir={(marca, precio) => setParams((p) => ({ ...p, marca, precioDiesel: precio }))} />
          <div className="sim-sub" style={{ marginTop: 8 }}>{notaPrecios} Elegí una tarjeta para que el costo de cada camión use ese precio.</div>
        </Seccion>
      )}

      <Seccion titulo="⚙ Parámetros del cálculo" abierta={false}>
        <div className="sim-params">
          {[['bultosPorPallet', 'Bultos por pallet'], ['palletsPorCamion', 'Pallets por camión'], ['llenado', 'Llenado objetivo (0–1)'],
            ['factorRuta', 'Factor de ruta'], ['consumoCamion', 'Consumo camión (L/100 km)'], ['consumoUtil', 'Consumo utilitario (L/100 km)'],
            ['ayudantesPorCamion', 'Ayudantes por camión'], ['limiteRecarga2', 'Sin recarga hasta (2 pers.)'], ['limiteRecarga3', 'Sin recarga hasta (3 pers.)'], ['maxCamiones', 'Camiones disponibles (0 = sin tope)'], ['maxParadas', 'Máx. paradas por camión'], ['maxBultosCamion', 'Máx. bultos por camión (0 = sin tope)'], ['radioAgrupKm', 'Juntar zonas hasta (km)']].map(([k, et]) => (
            <label key={k}>{et}
              <input type="number" step="any" value={params[k]} onChange={(e) => setParams((p) => ({ ...p, [k]: Number(e.target.value) }))} />
            </label>
          ))}
          {factorCal && <button className="sim-btn" onClick={() => setParams((p) => ({ ...p, factorRuta: factorCal }))}>Usar factor del historial ({factorCal})</button>}
        </div>
        <div className="sim-sub" style={{ marginTop: 10 }}>
          Los límites de recarga vienen de Configuración. Factor de ruta: {params.factorRuta}{factorCal ? ` (calibrado con tu historial: ${factorCal})` : ''}.
          Modelo probado con 17 días reales del ruteador (23/10 al 14/11): pallets con ±2 % de error, camiones dentro de ±1 en 15 de 17 días
          y km sin sesgo (mediana 1,00; por día varía). Es una estimación: el ruteador real optimiza con horarios y recargas que acá no se conocen.
        </div>
      </Seccion>
      {navPaso(4)}
    </>
  );

  // ── Barra flotante: UNA sola para mover los clientes marcados (planilla o mapa), siempre a la vista ──
  const barraSel = modo === 'simulacion' && sim && selCli.length > 0 && (() => {
    const por = new Map(); sim.rutas.forEach((r) => r.paradas.forEach((p) => por.set(p.c, p))); ((sim.pendEdit && sim.pendEdit.clientes) || []).forEach((p) => por.set(p.c, p));
    const bs = selCli.reduce((t, c) => t + ((por.get(c) || {}).b || 0), 0);
    return (
      <div className="sim-flota" role="region" aria-label="Clientes marcados">
        <div className="sim-flota-h"><b>{selCli.length} cliente{selCli.length === 1 ? '' : 's'} · {f0(bs)} bultos</b>
          <button type="button" className="sim-btn sim-mini" onClick={() => setSelCli([])} aria-label="Desmarcar todos">✖ Desmarcar</button></div>
        <div className="sim-flota-b">
          <span className="sim-sub">Pasarlos al camión:</span>
          {sim.rutas.map((r, i) => <button key={pidDe(r, i)} type="button" className="sim-btn" style={{ borderLeft: `6px solid ${COLORES[i % COLORES.length]}` }} onClick={() => moverA(selCli, pidDe(r, i))}>#{r.n}</button>)}
          <button type="button" className="sim-btn" onClick={() => moverA(selCli, 'nuevo')}>➕ Nuevo</button>
          <span className="sim-flota-sep" />
          <select value={motivoNuevo} onChange={(e) => setMotivoNuevo(e.target.value)} aria-label="Motivo de no ruteo">{MOTIVOS.map((m) => <option key={m} value={m}>Motivo: {m}</option>)}</select>
          <button type="button" className="sim-btn" onClick={() => moverA(selCli, 'pend')}>🚫 Dejar fuera</button>
          {selCli.length === 1 && filas.some((f) => f.c === selCli[0] && dentro(f)) && <button type="button" className="sim-btn" onClick={() => abrirDividir(selCli[0])}>✂ Dividir carga</button>}
        </div>
      </div>
    );
  })();

  // ── Mapa: barra de herramientas ARRIBA (no encima), referencias y camiones como filtro ──
  const leyenda = rutasMapa.length > 0 && (
    <div className="sim-leyenda" role="group" aria-label="Camiones en el mapa">
      {rutasMapa.map((r, i) => (
        <button key={i} type="button" className={`sim-ley ${rutaSel === i ? 'on' : ''}`} aria-pressed={rutaSel === i} title={r.label} onClick={() => enfocar(i)}>
          <span className="sim-chip" style={{ background: r.color }} />{String(r.label).split(' · ').slice(0, 2).join(' · ')}
        </button>
      ))}
      {rutaSel != null && <button type="button" className="sim-ley todos" onClick={() => enfocar(rutaSel)}>Ver todos</button>}
    </div>
  );
  const colMapa = (
    <div className="sim-mapcol" data-tut="sim-mapa">
      <div className="sim-maptools">
        <div className="sim-seg sim-vistas" role="group" aria-label="Tipo de mapa">
          {Object.entries(VISTAS).map(([k, v]) => (
            <button key={k} className={vista === k ? 'on' : ''} onClick={() => elegirVista(k)}>{v.label}</button>
          ))}
          <button className={callesOn ? 'on' : ''} onClick={() => setCallesOn((v) => !v)} title="Dibuja el recorrido real por calles y rutas (OSRM)">🛣️ Por calles</button>
        </div>
        {modo === 'simulacion' && sim && (
          <div className="sim-seg" role="group" aria-label="Herramienta de selección">
            {[['', '✋ Mover', 'Mover el mapa'], ['circulo', '⭕ Círculo', 'Círculo: arrastrá desde el centro'], ['lazo', '✏️ Lazo', 'Lazo: dibujá alrededor de los clientes'], ['rect', '▭ Rectángulo', 'Rectángulo']].map(([k, t, tt]) => (
              <button key={k || 'mano'} className={herr === k ? 'on' : ''} title={tt} aria-pressed={herr === k} onClick={() => setHerr(k)}>{t}</button>
            ))}
          </div>
        )}
      </div>
      {modo === 'simulacion' && sim && herr && <div className="sim-msg">Arrastrá sobre el mapa para marcar clientes (con <b>Shift</b> sumás a los ya marcados). <b>Esc</b> para salir. Después elegí el camión en la barra de abajo.</div>}
      {leyenda}
      <div className="sim-map-wrap">
        <div style={{ position: 'relative' }}>
          <div ref={mapDiv} className="sim-map" />
          <CapaSeleccion herramienta={modo === 'simulacion' ? herr : ''} getPuntos={puntosElegibles} onSeleccion={alSeleccionar} onCancelar={() => setHerr('')}
            proyectar={(p) => { const q2 = mapRef.current.project([p.lon, p.lat]); return [q2.x, q2.y]; }} />
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
      <div className="sim-refs" aria-label="Referencias del mapa">
        <span><i className="d" style={{ background: '#666' }} /> cliente (el color es el camión)</span>
        <span><i className="d gr" /> cliente grande</span>
        <span><i className="d fu" /> fuera del reparto</span>
        <span><i className="d ma" /> marcado</span>
        <span>⌂ depósito</span>
      </div>
    </div>
  );

  // ── Cabecera: resumen vivo + "revisá antes de cerrar" + pasos ─────────────
  const cabeceraSim = sim && (
    <>
      <div className="sim-resumen" data-tut="sim-resumen">
        <div className="sim-res-datos">
          <div><b>{f0(sim.totales.clientes)}</b><span>Clientes</span></div>
          <div><b>{f0(sim.totales.bultos)}</b><span>Bultos</span></div>
          <div><b>{sim.totales.camiones}{sim.tope && sim.tope.max > 0 ? <small>/{sim.tope.max}</small> : null}</b><span>Camiones</span></div>
          <div><b>{sim.totales.personas}</b><span>Personas</span></div>
          <div><b>{f0(sim.totales.km)}</b><span>Km</span></div>
          <div><b>{costoPers && costoPers.total > 0 ? money((costoPers.total + sim.totales.combustible) / (sim.totales.bultos || 1)) : '—'}</b><span>$/bulto</span></div>
        </div>
        <div className="sim-res-estado">
          <span className={`sim-pill ${plan ? 'edit' : ''}`}>{plan ? '✏️ Editado a mano' : '🤖 Propuesta automática'}</span>
          <Ayuda clave="editado" />
          {plan && <button type="button" className="sim-btn sim-mini" onClick={() => { if (window.confirm('Se descartan tus cambios y vuelve la propuesta automática del motor. ¿Seguro?')) { setSelCli([]); setAbierto(null); guardarPlan(null); } }}>↩ Volver al automático</button>}
        </div>
      </div>
    </>
  );
  const bloqueChequeos = (
    <div className={`sim-chk ${nErr ? 'err' : nAv ? 'warn' : 'ok'}`} data-tut="sim-chk">
      <button type="button" className="sim-chk-t" aria-expanded={chkAbierto} onClick={() => setChkAbierto((v) => !v)}>
        {nErr + nAv === 0 ? '✔ Todo en orden: no hay nada para corregir' : `${nErr ? '⛔' : '⚠'} ${nErr + nAv} cosa${nErr + nAv === 1 ? '' : 's'} para revisar antes de cerrar`}
        <span className="fl">{chkAbierto ? '▾' : '▸'}</span>
      </button>
      {chkAbierto && chequeos.length > 0 && (
        <div className="sim-chk-lista">
          {chequeos.map((x) => (
            <button type="button" key={x.id} className={`sim-chk-it ${x.nivel}`} onClick={() => irA(x)} title={x.detalle}>
              <span className="ic">{x.nivel === 'error' ? '⛔' : x.nivel === 'aviso' ? '⚠' : 'ℹ'}</span>
              <span><b>{x.titulo}</b>{x.detalle ? <span className="sim-sub"> — {x.detalle}</span> : null}</span>
              <span className="ir">Paso {x.paso} →</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
  const nav = (
    <nav className="sim-pasos" aria-label="Pasos de la simulación" data-tut="sim-pasos">
      {PASOS.map((p) => (
        <button key={p.n} type="button" className={paso === p.n ? 'on' : ''} aria-current={paso === p.n ? 'step' : undefined} onClick={() => irAPaso(p.n)} data-tut={`sim-paso-${p.n}`}>
          <span className="n">{p.n}</span><span className="t">{p.ic} {p.t}</span>
          {avisosPaso(p.n) > 0 && <span className="sim-pill aviso" aria-label={`${avisosPaso(p.n)} avisos`}>{avisosPaso(p.n)}</span>}
        </button>
      ))}
    </nav>
  );

  // ── Modo "Romaneo por día" (lo que hizo el ruteador): mismo orden de pantalla, sin pasos ──
  const contenidoCalendario = (
    <>
      <section className="sim-card">{tarjetaCal}</section>
      {!diaSel ? <div className="sim-card sim-empty">Elegí un día azul del calendario para ver el romaneo del ruteador.</div> :
        !diaDatos ? <div className="sim-card sim-empty">Cargando {diaSel}…</div> : (
          <>
            <section className="sim-card">
              <h3>{diaSel === hoyISO ? '🚚 Repartiendo hoy' : 'Romaneo'} · {fechaLarga(diaSel)}</h3>
              <div className="sim-kpis">
                <div className="sim-kpi"><b>{diaDatos.rutas.length}</b><span>Rutas</span></div>
                <div className="sim-kpi"><b>{f0(resumenDia.paradas)}</b><span>Paradas</span></div>
                <div className="sim-kpi"><b>{f0(resumenDia.bultos)}</b><span>Bultos</span></div>
                <div className="sim-kpi"><b>{f1(resumenDia.pallets)}</b><span>Pallets</span></div>
                <div className="sim-kpi"><b>{f0(resumenDia.km)}</b><span>Km</span></div>
                {costoDia && <div className="sim-kpi"><b>{money(costoDia.combustible)}</b><span>Combustible ({f0(costoDia.litros)} L)</span></div>}
                {costoDia && <div className="sim-kpi"><b>{costoDia.recargas}</b><span>Recargas</span></div>}
                {cruceDia && <div className="sim-kpi"><b>{f0(cruceDia.total.b)}</b><span title="Bultos facturados ese día según la tabla de Rechazos (incluye los que después el cliente devolvió)">Bultos facturados</span></div>}
                {cruceDia && <div className="sim-kpi"><b>{f0(cruceDia.total.r)}</b><span title="Bultos que el cliente no aceptó en la puerta y volvieron al camión">Devueltos por clientes{cruceDia.total.b ? ` (${f1(cruceDia.total.r / cruceDia.total.b * 100)} %)` : ''}</span></div>}
              </div>
              {puedeVerRechazos && rechDia && rechDia.length === 0 && <div className="sim-sub" style={{ marginTop: 8 }}>No hay rechazos cargados para este día (se cargan en 📂 Importar).</div>}
            </section>
            <section className="sim-card" style={{ overflowX: 'auto' }}>
              <h3>Rutas del día</h3>
              <div className="sim-sub" style={{ marginBottom: 6 }}>Tocá una ruta para verla sola en el mapa.</div>
              <table className="sim-table">
                <thead><tr><th>Ruta</th><th>Chofer</th><th>Vehículo</th><th>Paradas</th><th>Bultos plan</th><th>Pallets</th><th>Ocupación</th><th>Km</th><th>Combustible</th><th>Recarga</th><th>Horario</th>{cruceDia && <><th title="Bultos que se facturaron en la entrega (según la tabla de Rechazos)">Bultos entregados*</th><th title="Bultos que el cliente devolvió o no aceptó">Devueltos por clientes</th></>}</tr></thead>
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
              {cruceDia && <div className="sim-sub" style={{ marginTop: 8 }}>* «Bultos entregados» = bultos facturados a los clientes de esa ruta; «Devueltos por clientes» = los que el cliente rechazó en la puerta (cargados en la tabla de Rechazos). Ambos se cruzan por código de cliente con las paradas de cada ruta; «Bultos plan» es lo que decía el romaneo antes de salir.</div>}
            </section>
            <Seccion titulo="🧪 Probar el motor con este día" abierta={false}>
              <div className="sim-sub" style={{ marginBottom: 8 }}>Rearma los pedidos de este día, le pide al motor que los reparta <b>sin mirar este día en el historial</b> y compara con lo que el ruteador hizo de verdad.
                Los mercados, camiones de terceros y salidas de 1-2 paradas se cuentan aparte (los decide una persona).</div>
              <button className="sim-btn pri" onClick={() => { try { setPrueba(probarContraDia(diaSel, diaDatos, hist, ubicItems, params)); } catch (e) { aviso(e.message, 'err'); } }}>▶ Probar con el {fechaLarga(diaSel)}</button>
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
                  <div style={{ overflowX: 'auto' }}>
                    <table className="sim-table">
                      <thead><tr><th>Ruta real</th><th>Clientes</th><th>Juntos en el motor</th><th>Camión del motor</th><th>Chofer del motor</th></tr></thead>
                      <tbody>{prueba.porRuta.map((o) => (
                        <tr key={o.ri}><td>{o.chofer}</td><td>{o.clientes}</td><td>{f0(o.juntos * 100)} %</td><td>#{o.camionSim}</td><td>{o.choferSim || '—'}</td></tr>
                      ))}</tbody>
                    </table>
                  </div>
                  {prueba.tiempos && prueba.tiempos.errMin !== null && <div className="sim-sub" style={{ marginTop: 6 }}>Tiempos: el modelo ({prueba.tiempos.ajustado ? 'aprendido sin este día' : 'valores típicos'}) se equivoca en promedio ±{f0(prueba.tiempos.errMin)} min por ruta en este día ({prueba.tiempos.rutas} rutas).</div>}
                  {prueba.aparte.lista.length > 0 && <div className="sim-sub" style={{ marginTop: 6 }}>Aparte: {prueba.aparte.lista.map((x) => `${x.n} (${f0(x.b)} b, ${x.chofer})`).join(' · ')}</div>}
                </div>
              )}
            </Seccion>
            {costoDia && (
              <Seccion titulo={`⛽ ¿Dónde conviene cargar? (${f0(costoDia.litros)} L del día)`} abierta={false}>
                {selGrado}
                <TarjetasMarcas litros={costoDia.litros} km={resumenDia.km} bultos={resumenDia.bultos} clientes={resumenDia.paradas} params={params}
                  onElegir={(marca, precio) => setParams((p) => ({ ...p, marca, precioDiesel: precio }))} />
                <div className="sim-sub" style={{ marginTop: 8 }}>{notaPrecios}</div>
              </Seccion>
            )}
          </>
        )}
    </>
  );

  const pasoActual = paso === 1 ? bloquePaso1 : paso === 2 ? bloquePaso2 : paso === 3 ? bloquePaso3 : bloquePaso4;
  const sinSim = (
    <div className="sim-card sim-empty">Primero cargá los pedidos y elegí qué localidades salen (<b>paso 1</b>); con eso se arma la propuesta de camiones.</div>
  );

  return (
    <div className={`sim ${selCli.length > 0 && modo === 'simulacion' ? 'con-barra' : ''}`}>
      <div className="sim-grid">
        <div className="sim-head">
          <div className="sim-top">
            <div>
              <h2 className="sim-title">🧭 Planificación de reparto (simulación)</h2>
              <div className="sim-sub">{modo === 'simulacion' ? 'Planificá el reparto de mañana en 4 pasos: Pedidos → Flota y rutas → Paradas → Costos. El resumen y los avisos se actualizan solos.' : 'Lo que hizo el ruteador cada día, con su mapa.'}</div>
            </div>
            <div className="sim-row">
              <span className={`sim-live ${enVivo ? 'on' : 'off'}`}>{enVivo ? '● En vivo' : '○ Reconectando…'}</span>
              <div className="sim-seg" role="group" aria-label="Qué querés ver">
                <button className={modo === 'simulacion' ? 'on' : ''} onClick={() => setModo('simulacion')}>📦 Simular mañana</button>
                <button className={modo === 'calendario' ? 'on' : ''} onClick={() => setModo('calendario')}>📅 Romaneos pasados</button>
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
          {modo === 'simulacion' && cabeceraSim}
          {modo === 'simulacion' && bloqueChequeos}
          {modo === 'simulacion' && nav}
        </div>

        {colMapa}

        <div className="sim-cont">
          {modo === 'simulacion' ? (paso === 1 || sim ? pasoActual : sinSim) : contenidoCalendario}
        </div>
      </div>
      {barraSel}
    </div>
  );
}

export default TSimulacion;
