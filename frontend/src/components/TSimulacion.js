// components/TSimulacion.js — Calendario de romaneo + simulación de reparto en vivo.
// Carga perezosa (lazy) desde App.js: MapLibre solo se descarga al abrir esta pestaña.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { apiFetch, suscribirRuteo } from '../api/client';
import {
  PARAMS_DEFAULT, parseRomaneo, parsePedidos, parseMaestra, construirUbicaciones,
  calibrarFactor, simular,
} from '../simulacion/engine';
import { COLORES, VISTAS, crearMapa, cambiarVista, pintar, encuadrar } from '../simulacion/mapa';
import '../simulacion/simulacion.css';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DOW = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const f0 = (n) => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(n || 0);
const f1 = (n) => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(n || 0);
const money = (n) => '$ ' + f0(n);
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hhmm = (m) => (m == null ? '—' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
const fechaLarga = (s) => (s ? new Date(s + 'T12:00:00').toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }) : '');

function proximoDiaHabil(desde = new Date()) {
  const d = new Date(desde); d.setDate(d.getDate() + 1);
  if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return iso(d);
}
const leerArchivo = (file) => new Promise((ok, mal) => {
  const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => mal(r.error); r.readAsArrayBuffer(file);
});
const cede = () => new Promise((r) => setTimeout(r, 0));

export function TSimulacion({ loggedInUser }) {
  const rol = String(loggedInUser?.role || '').toLowerCase();
  const permisos = loggedInUser?.permisos || {};
  const puedeCargarRuteo = rol === 'admin' || permisos.importar === true;
  const usuario = loggedInUser?.nombre || '';
  const hdr = useMemo(() => ({ 'x-user-name': encodeURIComponent(usuario) }), [usuario]);

  const [modo, setModo] = useState('simulacion');
  const [vista, setVista] = useState('calle');
  const [msg, setMsg] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [enVivo, setEnVivo] = useState(false);

  const [lista, setLista] = useState([]);                 // [{fecha, paradas, bultos}]
  const [diaSel, setDiaSel] = useState(null);
  const [diaDatos, setDiaDatos] = useState(null);
  const cacheDias = useRef(new Map());
  const [cursor, setCursor] = useState(() => { const h = new Date(); return { y: h.getFullYear(), m: h.getMonth() }; });

  const [ubicItems, setUbicItems] = useState([]);
  const [pedidos, setPedidos] = useState(null);           // { version, updatedAt, updatedBy, data }
  const [params, setParams] = useState(PARAMS_DEFAULT);
  const [factorCal, setFactorCal] = useState(null);
  const [rutaSel, setRutaSel] = useState(null);

  const mapDiv = useRef(null); const mapRef = useRef(null); const datosMapa = useRef(null);
  const aviso = (texto, tipo = 'ok') => setMsg({ texto, tipo });

  // ── Carga de datos ───────────────────────────────────────────────────────
  const cargarLista = useCallback(async () => {
    try { const r = await apiFetch('/api/ruteo/dias'); setLista(r.data || []); } catch (e) { aviso(e.message, 'err'); }
  }, []);
  const cargarUbic = useCallback(async () => {
    try { const r = await apiFetch('/api/ruteo/ubicaciones'); setUbicItems(r.data || []); } catch (e) { aviso(e.message, 'err'); }
  }, []);
  const cargarPedidos = useCallback(async () => {
    try { const r = await apiFetch('/api/ruteo/pedidos'); setPedidos(r.data ? r : null); } catch (e) { aviso(e.message, 'err'); }
  }, []);
  const cargarDia = useCallback(async (fecha) => {
    setDiaSel(fecha);
    if (cacheDias.current.has(fecha)) { setDiaDatos(cacheDias.current.get(fecha)); return; }
    try {
      const r = await apiFetch(`/api/ruteo/dia/${fecha}`);
      if (r.data) cacheDias.current.set(fecha, r.data);
      setDiaDatos(r.data);
    } catch (e) { aviso(e.message, 'err'); }
  }, []);

  useEffect(() => { cargarLista(); cargarUbic(); cargarPedidos(); }, [cargarLista, cargarUbic, cargarPedidos]);

  // Tiempo real: SSE (con reintento) + respaldo por consulta cada 20 s si el canal está caído
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

  // ── Cálculos ─────────────────────────────────────────────────────────────
  const ubic = useMemo(() => construirUbicaciones(ubicItems, diaDatos ? { [diaSel]: diaDatos } : {}), [ubicItems, diaDatos, diaSel]);

  useEffect(() => { // calibra km reales vs línea recta con los días ya cargados en pantalla
    const dias = {}; cacheDias.current.forEach((v, k) => { dias[k] = v; });
    if (Object.keys(dias).length) setFactorCal(calibrarFactor(dias, params.deposito));
  }, [diaDatos, params.deposito]);

  const sim = useMemo(() => {
    if (!pedidos?.data?.clientes?.length) return null;
    return simular({ clientes: pedidos.data.clientes }, ubic, { ...params, factorRuta: params.factorRuta });
  }, [pedidos, ubic, params]);

  const rutasSimMapa = useMemo(() => (sim ? sim.rutas.map((r, i) => ({
    color: COLORES[i % COLORES.length], label: `Camión ${r.n} · ${r.localidades.join(' + ')}`,
    puntos: r.paradas.map((p, k) => ({ lat: p.lat, lon: p.lon, seq: k + 1, titulo: p.n,
      detalle: `Cód. ${p.c} · ${f1(p.b)} bultos · ${f1(p.pallets)} pallets · ${p.loc || ''}` })),
  })) : []), [sim]);

  const rutasDiaMapa = useMemo(() => {
    if (!diaDatos) return [];
    return diaDatos.rutas.map((r, i) => ({
      color: COLORES[i % COLORES.length], label: `${r.chofer || 'Ruta'} · ${r.veh}`,
      puntos: diaDatos.paradas.filter((p) => p[0] === i).map((p) => ({ lat: p[4], lon: p[5], seq: p[1], titulo: p[3],
        detalle: `Cód. ${p[2]} · ${f0(p[6])} kg · llega ${hhmm(p[9])}` })),
    }));
  }, [diaDatos]);

  const rutasMapa = modo === 'simulacion' ? rutasSimMapa : rutasDiaMapa;

  // ── Mapa ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapDiv.current) return undefined;
    const map = crearMapa(mapDiv.current, params.deposito); mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const redibujar = useCallback(() => {
    const map = mapRef.current; if (!map || !datosMapa.current) return;
    pintar(map, datosMapa.current);
  }, []);
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    datosMapa.current = { deposito: params.deposito, rutas: rutasMapa, soloRuta: rutaSel };
    redibujar();
    if (rutasMapa.length) encuadrar(map, datosMapa.current);
  }, [rutasMapa, rutaSel, params.deposito, redibujar]);
  useEffect(() => { setRutaSel(null); }, [modo, diaSel, pedidos?.version]);
  const elegirVista = (k) => { setVista(k); if (mapRef.current) cambiarVista(mapRef.current, k, redibujar); };

  // ── Cargas de archivos ───────────────────────────────────────────────────
  const subirPedidos = async (file, fechaEntrega) => {
    setOcupado(true);
    try {
      const wb = XLSX.read(await leerArchivo(file), { type: 'array' });
      const m = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
      const ped = parsePedidos(m);
      await apiFetch('/api/ruteo/pedidos', { method: 'PUT', headers: hdr,
        body: JSON.stringify({ archivo: file.name, fechaEntrega, clientes: ped.clientes }) });
      aviso(`Pedidos cargados: ${ped.total.clientes} clientes, ${f0(ped.total.bultos)} bultos. Todos los usuarios con acceso lo ven al instante.`);
      await cargarPedidos();
    } catch (e) { aviso(e.message, 'err'); }
    setOcupado(false);
  };

  const subirRomaneos = async (files) => {
    setOcupado(true);
    try {
      let nDias = 0; const ubicNuevas = new Map();
      for (const file of files) {
        aviso(`Leyendo ${file.name}…`); await cede();
        const wb = XLSX.read(await leerArchivo(file), { type: 'array', sheets: ['Romaneiro'] });
        if (!wb.Sheets.Romaneiro) throw new Error(`${file.name}: no tiene la hoja "Romaneiro".`);
        const dias = parseRomaneo(XLSX.utils.sheet_to_json(wb.Sheets.Romaneiro));
        for (const d of Object.values(dias)) {
          await apiFetch(`/api/ruteo/dia/${d.fecha}`, { method: 'PUT', headers: hdr,
            body: JSON.stringify({ rutas: d.rutas, paradas: d.paradas, resumen: d.resumen }) });
          cacheDias.current.delete(d.fecha); nDias++;
          d.paradas.forEach((p) => ubicNuevas.set(p[2], [p[2], p[4], p[5], p[3], '']));
        }
      }
      if (ubicNuevas.size) await apiFetch('/api/ruteo/ubicaciones', { method: 'PUT', headers: hdr, body: JSON.stringify({ items: [...ubicNuevas.values()] }) });
      aviso(`Romaneo guardado: ${nDias} día(s).`); await cargarLista();
    } catch (e) { aviso(e.message, 'err'); }
    setOcupado(false);
  };

  const subirMaestra = async (file) => {
    setOcupado(true);
    try {
      aviso('Leyendo maestra de clientes…'); await cede();
      const wb = XLSX.read(await leerArchivo(file), { type: 'array' });
      const items = parseMaestra(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]));
      if (!items.length) throw new Error('No encontré clientes con coordenadas (columnas Cliente, Coord X, Coord Y).');
      await apiFetch('/api/ruteo/ubicaciones', { method: 'PUT', headers: hdr, body: JSON.stringify({ items }) });
      aviso(`Maestra cargada: ${f0(items.length)} clientes con ubicación.`); await cargarUbic();
    } catch (e) { aviso(e.message, 'err'); }
    setOcupado(false);
  };

  // ── Calendario ───────────────────────────────────────────────────────────
  const mapaLista = useMemo(() => new Map(lista.map((x) => [x.fecha, x])), [lista]);
  const celdas = useMemo(() => {
    const prim = new Date(cursor.y, cursor.m, 1); const off = (prim.getDay() + 6) % 7;
    const n = new Date(cursor.y, cursor.m + 1, 0).getDate(); const out = [];
    for (let i = 0; i < off; i++) out.push(null);
    for (let d = 1; d <= n; d++) out.push(iso(new Date(cursor.y, cursor.m, d)));
    return out;
  }, [cursor]);
  const mover = (dm) => setCursor((c) => { const d = new Date(c.y, c.m + dm, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const hoyISO = iso(new Date());
  const fechaPedidos = pedidos?.data?.fechaEntrega;

  const [fechaNueva, setFechaNueva] = useState(proximoDiaHabil());
  const refPed = useRef(null); const refRom = useRef(null); const refMae = useRef(null);

  const resumenDia = diaDatos && {
    paradas: diaDatos.paradas.length, bultos: diaDatos.rutas.reduce((s, r) => s + r.bultos, 0),
    pallets: diaDatos.rutas.reduce((s, r) => s + r.pallets, 0), km: diaDatos.rutas.reduce((s, r) => s + r.km, 0),
  };

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
                const clic = () => {
                  if (x) { setModo('calendario'); cargarDia(f); }
                  else if (esPed) setModo('simulacion');
                };
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
            <h3>Cargar archivos</h3>
            <div style={{ display: 'grid', gap: 8 }}>
              <label className="sim-sub">Entrega de los pedidos
                <input className="sim-input" type="date" value={fechaNueva} onChange={(e) => setFechaNueva(e.target.value)} />
              </label>
              <input ref={refPed} type="file" accept=".xlsx,.xls,.csv" hidden
                onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) subirPedidos(f, fechaNueva); }} />
              <button className="sim-btn pri" disabled={ocupado} onClick={() => refPed.current.click()}>📦 Subir pedidos (Excel)</button>
              {puedeCargarRuteo && (<>
                <input ref={refRom} type="file" accept=".xlsb,.xlsx" multiple hidden
                  onChange={(e) => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) subirRomaneos(fs); }} />
                <button className="sim-btn" disabled={ocupado} onClick={() => refRom.current.click()}>🗂️ Subir romaneo del ruteador</button>
                <input ref={refMae} type="file" accept=".xlsx,.xls" hidden
                  onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) subirMaestra(f); }} />
                <button className="sim-btn" disabled={ocupado} onClick={() => refMae.current.click()}>👥 Subir maestra de clientes</button>
              </>)}
              <div className="sim-sub">
                {pedidos?.data ? <>Pedidos vigentes: <b>{pedidos.data.archivo}</b> para el <b>{fechaLarga(pedidos.data.fechaEntrega)}</b>
                  {pedidos.updatedBy ? <> · cargó {decodeURIComponent(pedidos.updatedBy)}</> : null}
                  {pedidos.updatedAt ? <> · {new Date(pedidos.updatedAt).toLocaleString('es-AR')}</> : null}</> : 'Todavía no hay pedidos cargados.'}
                <br />Ubicaciones conocidas: {f0(ubicItems.length)} clientes.
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
            </div>
            <div ref={mapDiv} className="sim-map" />
          </div>

          {modo === 'simulacion' ? (
            !sim ? <div className="sim-card sim-empty">Subí el Excel de pedidos para simular la entrega.<br />Se calcula en tu navegador y lo ve en vivo cualquier usuario con acceso.</div> : (
              <>
                <div className="sim-card">
                  <h3>Simulación · {fechaLarga(fechaPedidos)}</h3>
                  <div className="sim-kpis">
                    <div className="sim-kpi"><b>{f0(sim.totales.clientes)}</b><span>Clientes</span></div>
                    <div className="sim-kpi"><b>{f0(sim.totales.bultos)}</b><span>Bultos</span></div>
                    <div className="sim-kpi"><b>{f1(sim.totales.pallets)}</b><span>Pallets</span></div>
                    <div className="sim-kpi"><b>{sim.totales.camiones}</b><span>Camiones</span></div>
                    <div className="sim-kpi"><b>{sim.totales.personas}</b><span>Personas</span></div>
                    <div className="sim-kpi"><b>{f0(sim.totales.km)}</b><span>Km estimados</span></div>
                    <div className="sim-kpi"><b>{money(sim.totales.combustible)}</b><span>Combustible</span></div>
                  </div>
                  {sim.sinUbicacion.length > 0 && (
                    <div className="sim-warn" style={{ marginTop: 10 }}>
                      {sim.sinUbicacion.length} cliente(s) sin ubicación (no entran en el mapa ni en los km): {sim.sinUbicacion.slice(0, 6).map((c) => c.n).join(', ')}{sim.sinUbicacion.length > 6 ? '…' : ''}
                    </div>
                  )}
                </div>
                <div className="sim-card" style={{ overflowX: 'auto' }}>
                  <h3>Camiones sugeridos</h3>
                  <table className="sim-table">
                    <thead><tr><th>Camión</th><th>Zona</th><th>Paradas</th><th>Bultos</th><th>Pallets</th><th>Ocupación</th><th>Km</th><th>Combustible</th></tr></thead>
                    <tbody>
                      {sim.rutas.map((r, i) => (
                        <tr key={r.n} className={`click ${rutaSel === i ? 'rsel' : ''}`} onClick={() => setRutaSel(rutaSel === i ? null : i)}>
                          <td><span className="sim-chip" style={{ background: COLORES[i % COLORES.length] }} />#{r.n}</td>
                          <td>{r.localidades.join(' + ')}</td><td>{r.paradas.length}</td><td>{f0(r.bultos)}</td><td>{f1(r.pallets)}</td>
                          <td><div className="sim-bar"><i className={r.ocupacion > 0.8 ? 'alto' : r.ocupacion < 0.4 ? 'bajo' : ''} style={{ width: `${Math.min(100, r.ocupacion * 100)}%` }} /></div></td>
                          <td>{f0(r.km)}</td><td>{money(r.combustible)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="sim-sub" style={{ marginTop: 8 }}>Tocá un camión para verlo solo en el mapa. Estimación: km en línea recta × factor de ruta ({params.factorRuta})
                    {factorCal ? <> · calibrado con tu historial: {factorCal}</> : null}.</div>
                </div>
                <div className="sim-card">
                  <h3>Parámetros (ajustables)</h3>
                  <div className="sim-params">
                    {[['bultosPorPallet', 'Bultos por pallet'], ['palletsPorCamion', 'Pallets por camión'], ['llenado', 'Llenado objetivo (0–1)'],
                      ['factorRuta', 'Factor de ruta'], ['consumoLKm', 'Consumo (L/km)'], ['precioDiesel', 'Gasoil ($/L)'],
                      ['ayudantesPorCamion', 'Ayudantes por camión'], ['radioAgrupKm', 'Juntar zonas hasta (km)']].map(([k, et]) => (
                      <label key={k}>{et}
                        <input type="number" step="any" value={params[k]} onChange={(e) => setParams((p) => ({ ...p, [k]: Number(e.target.value) }))} />
                      </label>
                    ))}
                    {factorCal && <button className="sim-btn" onClick={() => setParams((p) => ({ ...p, factorRuta: factorCal }))}>Usar factor del historial ({factorCal})</button>}
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
                  </div>
                </div>
                <div className="sim-card" style={{ overflowX: 'auto' }}>
                  <h3>Rutas del día</h3>
                  <table className="sim-table">
                    <thead><tr><th>Ruta</th><th>Chofer</th><th>Vehículo</th><th>Paradas</th><th>Bultos</th><th>Pallets</th><th>Ocupación</th><th>Km</th><th>Horario</th></tr></thead>
                    <tbody>
                      {diaDatos.rutas.map((r, i) => (
                        <tr key={i} className={`click ${rutaSel === i ? 'rsel' : ''}`} onClick={() => setRutaSel(rutaSel === i ? null : i)}>
                          <td><span className="sim-chip" style={{ background: COLORES[i % COLORES.length] }} />{i + 1}</td>
                          <td>{r.chofer}</td><td>{r.veh}</td><td>{r.entregas}</td><td>{f0(r.bultos)}</td><td>{f1(r.pallets)}</td>
                          <td><div className="sim-bar"><i className={r.cap && r.pallets / r.cap > 0.8 ? 'alto' : r.cap && r.pallets / r.cap < 0.4 ? 'bajo' : ''} style={{ width: `${Math.min(100, r.cap ? (r.pallets / r.cap) * 100 : 0)}%` }} /></div></td>
                          <td>{f1(r.km)}</td><td>{hhmm(r.ini)}–{hhmm(r.fin)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
