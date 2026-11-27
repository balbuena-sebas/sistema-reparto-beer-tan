// components/TEjecutivo.js — Vista ejecutiva: el mes completo (o acumulado del mes en curso), su evolución y las localidades.
// Lee un resumen mensual muy liviano (/api/ejecutivo) que el backend arma desde Registros, Foxtrot y Rechazos.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../api/client';
import { fp, isT } from '../utils/helpers';
import { PARAMS_DEFAULT as P } from '../simulacion/engine';
import { Tile, Contar, Variacion, Barra, Semaforo, Evolucion, Spark, Fuentes } from './ejec/ui';

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const MESES_LARGO = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const mesLargo = (m) => `${MESES_LARGO[+m.slice(5) - 1]} ${m.slice(0, 4)}`;
const suma = (m, n) => { const [y, mm] = m.split('-').map(Number); const d = new Date(y, mm - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const hoyMes = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

const CAP_BULTOS = P.palletsPorCamion * P.bultosPorPallet;          // capacidad de un camión en bultos
const f0 = (n) => Math.round(n).toLocaleString('es-AR');
const f1 = (n) => n.toLocaleString('es-AR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const div = (a, b) => (b ? a / b : null);

// Suma varias filas (por ejemplo las localidades de una zona)
function juntar(filas) {
  if (!filas.length) return null;
  const o = { rep: 0, dias: 0, bul: 0, bol: 0, cos: 0, rec: 0, per: 0, hc: 0, ha: 0, km: 0, fx: 0 };
  filas.forEach((f) => { Object.keys(o).forEach((k) => { if (k === 'dias') o.dias = Math.max(o.dias, f.dias || 0); else o[k] += f[k] || 0; }); if (f.rch) o.rch = f.rch; if (f.fac) o.fac = f.fac; });
  return o;
}
// Indicadores derivados de una fila de resumen
function ind(a) {
  if (!a || (!a.rep && !a.fr && !a.rch)) return null;
  const hayReg = a.rep > 0;
  const bulCam = hayReg ? div(a.bul, a.rep) : null;
  return {
    hayReg, camiones: a.rep || a.fr || 0, pdv: a.fcl || 0, deFoxtrot: !hayReg && !!a.fr,
    bulCam, bolCam: hayReg ? div(a.bol, a.rep) : null, camDia: hayReg ? div(a.rep, a.dias) : null,
    ocup: bulCam != null ? (bulCam / CAP_BULTOS) * 100 : null,
    ocupKg: bulCam != null && P.capacidadKg ? ((bulCam * P.kgPorBulto) / P.capacidadKg) * 100 : null,
    cosBul: hayReg ? div(a.cos, a.bul) : null, cosCam: hayReg ? div(a.cos, a.rep) : null, cosPdv: hayReg ? div(a.cos, a.bol) : null,
    jornada: a.fx ? a.hc / a.fx : a.fr && a.fh ? a.fh / a.fr : null,
    horas: a.fx ? a.hc + a.ha : a.fh || null, soloChofer: !a.fx && !!a.fh,
    rechPct: a.rch && a.bul ? (a.rch.bul / a.bul) * 100 : null,
    pesoT: (a.bul * P.kgPorBulto) / 1000,
  };
}

const METRICAS = [
  { id: 'bulCam', lb: 'Bultos / camión', fmt: f0, v: (i) => i.bulCam, ref: CAP_BULTOS },
  { id: 'bolCam', lb: 'Destinos / camión', fmt: f1, v: (i) => i.bolCam },
  { id: 'ocup', lb: 'Ocupación %', fmt: (n) => `${f0(n)}%`, v: (i) => i.ocup, ref: 100 },
  { id: 'cosBul', lb: 'Costo / bulto', fmt: (n) => fp(n), v: (i) => i.cosBul, bajaBien: true },
  { id: 'camDia', lb: 'Camiones / día', fmt: f1, v: (i) => i.camDia },
  { id: 'rechPct', lb: 'Rechazos %', fmt: (n) => `${f1(n)}%`, v: (i) => i.rechPct, bajaBien: true },
  { id: 'jornada', lb: 'Jornada (h)', fmt: f1, v: (i) => i.jornada },
];

const nivelOcup = (o) => (o == null ? 'nd' : o >= 75 ? 'ok' : o >= 50 ? 'aviso' : 'mal');

export function TEjecutivo({ loggedInUser }) {
  const actual = hoyMes();
  const [n, setN] = useState(12);
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);
  const [mes, setMes] = useState(actual);
  const [zona, setZona] = useState('todas');
  const [met, setMet] = useState('bulCam');
  const [orden, setOrden] = useState({ k: 'bul', d: -1 });
  const [abierta, setAbierta] = useState(null);
  const esAdmin = String((loggedInUser && loggedInUser.role) || '').toLowerCase() === 'admin';

  const cargar = useCallback(async (forzar = false) => {
    setCargando(true); setError('');
    try {
      const r = await apiFetch(`/api/ejecutivo?desde=${suma(actual, -(n - 1))}&hasta=${actual}${forzar ? '&refrescar=1' : ''}`);
      setFilas(r.data || []);
    } catch (e) { setError(e.message || 'No se pudo cargar'); }
    setCargando(false);
  }, [n, actual]);
  useEffect(() => { cargar(false); }, [cargar]);

  // porMes[mes] = { '*': fila, Localidad: fila, ... }
  const porMes = useMemo(() => {
    const o = {};
    (filas || []).forEach((f) => { (o[f.mes] = o[f.mes] || {})[f.clave] = f; });
    return o;
  }, [filas]);
  const mesesConDatos = useMemo(() => Object.keys(porMes).filter((m) => porMes[m]['*']).sort().reverse(), [porMes]);
  const rango = useMemo(() => Array.from({ length: n }, (_, i) => suma(actual, -(n - 1 - i))), [n, actual]);

  // Fila del período (total o suma de la zona elegida)
  const filaDe = useCallback((m) => {
    const d = porMes[m]; if (!d) return null;
    if (zona === 'todas') return d['*'] || null;
    const locs = Object.keys(d).filter((k) => k !== '*' && (zona === 'tandil') === isT(k));
    return juntar(locs.map((k) => d[k]));
  }, [porMes, zona]);

  const a = filaDe(mes), i = ind(a);
  const mesPrev = suma(mes, -1);
  const ant = ind(filaDe(mesPrev));
  const enCurso = mes === actual;
  const cerrado = !enCurso && !!ant;

  // Localidades del período
  const localidades = useMemo(() => {
    const d = porMes[mes] || {};
    const prevs = rango.map((m) => porMes[m]);
    return Object.keys(d).filter((k) => k !== '*' && (zona === 'todas' || (zona === 'tandil') === isT(k))).map((k) => {
      const fila = d[k]; const x = ind(fila);
      return { nombre: k, fila, i: x, spark: prevs.map((p) => (p && p[k] ? ind(p[k])?.bulCam ?? null : null)) };
    });
  }, [porMes, mes, zona, rango]);
  const ordenadas = useMemo(() => {
    const val = (l) => ({ nombre: l.nombre.toLowerCase(), rep: l.fila.rep, bul: l.fila.bul, bulCam: l.i?.bulCam, bolCam: l.i?.bolCam, ocup: l.i?.ocup, cosBul: l.i?.cosBul, jornada: l.i?.jornada }[orden.k]);
    return [...localidades].sort((x, y) => { const p = val(x), q = val(y); if (p == null) return 1; if (q == null) return -1; return (p > q ? 1 : p < q ? -1 : 0) * orden.d; });
  }, [localidades, orden]);

  // Lo que conviene mirar
  const oportunidades = useMemo(() => {
    if (!i) return [];
    const out = [];
    localidades.forEach((l) => {
      if (!l.i) return;
      if (l.fila.rep >= 3 && l.i.ocup < 50) out.push({ t: 'aviso', s: l.i.ocup, ic: '📉', x: `${l.nombre} sale con ${f0(l.i.ocup)}% de ocupación en promedio (${l.fila.rep} camiones). Ver si se puede juntar con otro día o zona.` });
      if (l.fila.rep >= 2 && i.cosBul && l.i.cosBul > i.cosBul * 1.25) out.push({ t: 'mal', s: 100 - (l.i.cosBul / i.cosBul) * 10, ic: '💸', x: `${l.nombre} cuesta ${fp(l.i.cosBul)} por bulto, ${f0((l.i.cosBul / i.cosBul - 1) * 100)}% más que el promedio (${fp(i.cosBul)}).` });
      if (l.fila.rep >= 2 && l.i.ocup > 95) out.push({ t: 'mal', s: 0, ic: '⚠️', x: `${l.nombre} va al límite de carga (${f0(l.i.ocup)}% de la capacidad): conviene prever otro camión.` });
    });
    if (ant && i.bulCam && ant.bulCam && i.bulCam < ant.bulCam * 0.85) out.push({ t: 'aviso', s: 50, ic: '📦', x: `Los bultos por camión bajaron ${f0((1 - i.bulCam / ant.bulCam) * 100)}% contra ${mesLargo(mesPrev)}.` });
    if (ant && i.rechPct != null && ant.rechPct != null && i.rechPct > ant.rechPct * 1.2) out.push({ t: 'mal', s: 20, ic: '❌', x: `Los rechazos subieron a ${f1(i.rechPct)}% (antes ${f1(ant.rechPct)}%).` });
    return out.sort((p, q) => p.s - q.s).slice(0, 5);
  }, [localidades, i, ant, mesPrev]);

  const m = METRICAS.find((x) => x.id === met) || METRICAS[0];
  const puntos = rango.map((r) => { const x = ind(filaDe(r)); const v = x ? m.v(x) : null; return { etiqueta: MESES[+r.slice(5) - 1], valor: v != null && Number.isFinite(v) ? v : null, mes: r }; });

  const clic = (k) => setOrden((o) => (o.k === k ? { k, d: -o.d } : { k, d: k === 'nombre' ? 1 : -1 }));
  const Th = ({ k, children }) => <th onClick={() => clic(k)} aria-sort={orden.k === k ? (orden.d > 0 ? 'ascending' : 'descending') : 'none'}>{children}{orden.k === k ? (orden.d > 0 ? ' ▲' : ' ▼') : ''}</th>;

  const selMeses = useMemo(() => { const s = new Set([...mesesConDatos, actual]); return [...s].sort().reverse(); }, [mesesConDatos, actual]);
  const fuentes = [
    { nombre: 'Registros', ok: !!(a && a.rep), detalle: a && a.rep ? `${a.rep} repartos` : 'Sin registros de reparto en este mes' },
    { nombre: 'Foxtrot', ok: !!(a && (a.fx || a.fr)), detalle: a && a.fr ? `${a.fr} rutas de Foxtrot` : 'Sin datos de Foxtrot en este mes' },
    { nombre: 'Rechazos', ok: !!(a && a.rch), detalle: a && a.rch ? `${a.rch.n} líneas con rechazo` : 'Sin datos de Rechazos en este mes' },
    { nombre: 'Facturación', ok: !!(a && a.fac), detalle: 'Facturación por camión (se carga desde Importar)' },
  ];

  return (
    <div className="ej">
      <div className="ej-head">
        <div>
          <h2>📊 Ejecutivo</h2>
          <p>{enCurso ? `Acumulado de ${mesLargo(mes)}${a && a.dias ? ` · ${a.dias} días con reparto` : ''}` : `Mes completo · ${mesLargo(mes)}`}</p>
        </div>
        <div className="ej-ctrl">
          <select className="ej-sel" value={mes} onChange={(e) => { setMes(e.target.value); setAbierta(null); }} aria-label="Mes">
            {selMeses.map((x) => <option key={x} value={x}>{mesLargo(x)}{x === actual ? ' (en curso)' : ''}</option>)}
          </select>
          <div className="ej-seg" role="group" aria-label="Zona">
            {[['todas', 'Todas'], ['tandil', 'Tandil'], ['flores', 'Las Flores']].map(([k, lb]) => <button key={k} className={zona === k ? 'on' : ''} onClick={() => { setZona(k); setAbierta(null); }}>{lb}</button>)}
          </div>
          {esAdmin && <button className="ej-seg" style={{ border: 0, cursor: 'pointer', padding: '9px 12px', fontWeight: 600, fontSize: 13 }} onClick={() => cargar(true)} disabled={cargando} title="Vuelve a calcular todos los meses mostrados">↻ Recalcular</button>}
        </div>
      </div>

      {error && <div className="ej-card" role="alert"><b>No se pudo cargar el resumen.</b> <span style={{ color: '#6b7280' }}>{error}</span> <button className="ej-chip" onClick={() => cargar(false)}>Reintentar</button></div>}
      {!filas && !error && <div className="ej-cargando">Calculando el resumen…</div>}

      {filas && !a && !error && <div className="ej-card ej-vacio">No hay datos de {mesLargo(mes)}{zona !== 'todas' ? ' para esta zona' : ''}. Elegí otro mes.</div>}

      {a && i && (
        <>
          <Fuentes items={fuentes} />
          <div className="ej-grid">
            <Tile idx={0} icono="🚛" etiqueta="Camiones" detalle={i.hayReg ? `${f1(i.camDia)} por día · ${a.dias} días · ${a.bol} destinos` : 'Rutas de Foxtrot (sin Registros este mes)'}><Contar valor={i.camiones || null} /><small>{i.deFoxtrot ? 'rutas' : 'repartos'}</small></Tile>
            <Tile idx={1} icono="📦" etiqueta="Bultos" detalle={i.hayReg ? `${f0(i.bulCam)} por camión · ${f1(i.pesoT)} t` : 'Faltan los Registros de este mes'}
              variacion={cerrado && i.hayReg ? <Variacion actual={i.bulCam} previo={ant.bulCam} /> : null}><Contar valor={i.hayReg ? a.bul : null} /></Tile>
            <Tile idx={2} icono="🧾" etiqueta="PDV atendidos" detalle={i.pdv ? `${f1(i.pdv / (a.fr || 1))} por ruta · según Foxtrot` : 'Los PDV salen de Foxtrot (sin datos este mes)'}
              variacion={cerrado && i.pdv && ant.pdv && a.fr && ant.fr ? <Variacion actual={i.pdv / a.fr} previo={ant.pdv / ant.fr} /> : null}><Contar valor={i.pdv || null} /></Tile>
            <Tile idx={3} icono="🏭" etiqueta="Ocupación de bodega" tono={nivelOcup(i.ocup)} ayuda={`Bultos por camión sobre la capacidad (${P.palletsPorCamion} pallets ≈ ${f0(CAP_BULTOS)} bultos)`}
              detalle={i.hayReg ? `Peso ${f0(i.ocupKg)}% del máximo de ${f1(P.capacidadKg / 1000)} t` : 'Faltan los Registros de este mes'} variacion={cerrado && i.hayReg ? <Variacion actual={i.ocup} previo={ant.ocup} /> : null}>
              <Contar valor={i.ocup} fmt={(x) => `${f0(x)}%`} /><Barra pct={i.ocup} etiqueta="Ocupación" />
            </Tile>
            <Tile idx={4} icono="💰" etiqueta="Costo del reparto" detalle={i.hayReg ? `${fp(i.cosBul)} por bulto · ${fp(i.cosCam)} por camión` : 'Faltan los Registros de este mes'}
              variacion={ant && i.hayReg ? <Variacion actual={i.cosBul} previo={ant.cosBul} mejorSiBaja sufijo="costo/bulto vs mes anterior" /> : null}><Contar valor={i.hayReg ? a.cos : null} fmt={(x) => fp(x)} /></Tile>
            <Tile idx={5} icono="⏱️" etiqueta="Horas de personal" ayuda="Jornada real de Foxtrot del chofer, y la misma jornada por cada ayudante del camión"
              detalle={a.fx ? `Chofer ${f0(a.hc)} h · ayudantes ${f0(a.ha)} h${a.fx < a.rep ? ` · de ${a.fx}/${a.rep} repartos` : ''}` : i.soloChofer ? `Solo choferes (jornada Foxtrot de ${a.fr} rutas)` : 'Sin datos de Foxtrot en este mes'}>
              <Contar valor={i.horas} fmt={(x) => f0(x)} />{i.horas != null && <small>h</small>}
            </Tile>
            <Tile idx={6} icono="❌" etiqueta="Rechazos" tono={i.rechPct == null ? 'base' : i.rechPct > 3 ? 'mal' : 'ok'} detalle={a.rch ? `${fp(a.rch.imp)} · ${f0(a.rch.bul)} bultos rechazados${i.rechPct == null ? ' (el % necesita los Registros del mes)' : ''}` : 'Sin datos de Rechazos en este mes'}
              variacion={ant && i.rechPct != null ? <Variacion actual={i.rechPct} previo={ant.rechPct} mejorSiBaja /> : null}>
              {i.rechPct != null ? <Contar valor={i.rechPct} fmt={(x) => `${f1(x)}%`} /> : a.rch ? <Contar valor={a.rch.bul} fmt={(x) => `${f0(x)} bultos`} /> : <span className="ej-nd">sin datos</span>}
            </Tile>
            <Tile idx={7} icono="🧮" etiqueta="Costo / facturación" detalle={a.fac ? `Facturación ${fp(a.fac)}` : 'Falta cargar la facturación por camión'}>
              {a.fac ? <Contar valor={(a.cos / a.fac) * 100} fmt={(x) => `${f1(x)}%`} /> : <span className="ej-nd">sin datos</span>}
            </Tile>
          </div>

          <div className="ej-card">
            <h3>Evolución mes a mes</h3>
            <p className="sub">Tocá un mes para verlo arriba. Los meses sin datos quedan vacíos.</p>
            <div className="ej-chips" role="tablist">{METRICAS.map((x) => <button key={x.id} className={met === x.id ? 'on' : ''} onClick={() => setMet(x.id)}>{x.lb}</button>)}</div>
            <Evolucion puntos={puntos} fmt={m.fmt} sel={rango.indexOf(mes)} onSel={(idx) => { const r = rango[idx]; if (porMes[r]) { setMes(r); setAbierta(null); } }} linea={m.ref} />
            <div className="ej-seg" style={{ marginTop: 8 }} role="group" aria-label="Cantidad de meses">
              {[6, 12, 24].map((x) => <button key={x} className={n === x ? 'on' : ''} onClick={() => setN(x)}>{x} meses</button>)}
            </div>
          </div>

          <div className="ej-card">
            <h3>Qué conviene mirar</h3>
            <p className="sub">Detectado automáticamente en {mesLargo(mes)}{zona !== 'todas' ? ` · ${zona === 'tandil' ? 'Tandil' : 'Las Flores'}` : ''}.</p>
            <div className="ej-ops">
              {oportunidades.length ? oportunidades.map((o, k) => <div key={k} className={`ej-op ${o.t}`} style={{ '--i': k }}><span className="ic">{o.ic}</span><span>{o.x}</span></div>)
                : <div className="ej-op ok"><span className="ic">✅</span><span>Sin alertas: ocupación y costos dentro de lo normal en este período.</span></div>}
            </div>
          </div>

          <div className="ej-card">
            <h3>Localidades</h3>
            <p className="sub">Tocá una para ver su detalle. Ordená con los títulos.</p>
            {localidades.length ? (
              <div className="ej-scroll">
                <table className="ej-tabla">
                  <thead><tr><Th k="nombre">Localidad</Th><Th k="rep">Camiones</Th><Th k="bul">Bultos</Th><Th k="bulCam">Bult./cam.</Th><Th k="bolCam">Dest./cam.</Th><Th k="ocup">Ocup.</Th><Th k="cosBul">$/bulto</Th><Th k="jornada">Jornada</Th><th style={{ cursor: 'default' }}>Tendencia</th></tr></thead>
                  <tbody>
                    {ordenadas.map((l) => {
                      const peor = l.i && i.cosBul && l.i.cosBul > i.cosBul * 1.25 ? 'mal' : l.i && i.cosBul && l.i.cosBul > i.cosBul * 1.1 ? 'aviso' : 'ok';
                      return (
                        <React.Fragment key={l.nombre}>
                          <tr className={abierta === l.nombre ? 'abierta' : ''} onClick={() => setAbierta(abierta === l.nombre ? null : l.nombre)} tabIndex={0}
                            onKeyDown={(e) => { if (e.key === 'Enter') setAbierta(abierta === l.nombre ? null : l.nombre); }}>
                            <td className="nom">{l.nombre}</td>
                            <td>{l.fila.rep}</td><td>{f0(l.fila.bul)}</td>
                            <td>{l.i ? f0(l.i.bulCam) : '—'}</td><td>{l.i ? f1(l.i.bolCam) : '—'}</td>
                            <td><Semaforo nivel={nivelOcup(l.i?.ocup)} texto="Ocupación" /> {l.i ? `${f0(l.i.ocup)}%` : '—'}</td>
                            <td><Semaforo nivel={peor} texto="Costo por bulto vs promedio" /> {l.i ? fp(l.i.cosBul) : '—'}</td>
                            <td>{l.i?.jornada != null ? `${f1(l.i.jornada)} h` : '—'}</td>
                            <td><Spark valores={l.spark} /></td>
                          </tr>
                          {abierta === l.nombre && l.i && (
                            <tr><td colSpan={9} className="ej-detalle">
                              <div className="ej-mini">
                                <div><b>{l.fila.dias}</b><span>días con reparto</span></div>
                                <div><b>{f0(l.fila.bol)}</b><span>destinos cargados</span></div>
                                <div><b>{fp(l.fila.cos)}</b><span>costo del reparto</span></div>
                                <div><b>{fp(l.i.cosCam)}</b><span>por camión</span></div>
                                <div><b>{fp(l.i.cosPdv)}</b><span>por destino</span></div>
                                <div><b>{f1(l.i.pesoT)} t</b><span>peso estimado</span></div>
                                <div><b>{l.fila.rec}</b><span>recargas</span></div>
                                <div><b>{l.fila.km ? `${f0(l.fila.km)} km` : '—'}</b><span>recorridos (Foxtrot)</span></div>
                              </div>
                            </td></tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : <div className="ej-vacio">Sin localidades para este período.</div>}
          </div>
        </>
      )}
    </div>
  );
}
