// components/ejec/MapaEntregas.js — Mapa de las entregas reales del mes (según el romaneo del ruteador).
// Un círculo por cliente: el tamaño es el peso entregado y el color la localidad. Se carga solo cuando se pide.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../api/client';
import { isT } from '../../utils/helpers';
import { PARAMS_DEFAULT as P } from '../../simulacion/engine';
import { COLORES, crearMapa, cambiarVista, pintarEntregas, encuadrarPuntos } from '../../simulacion/mapa';

const f0 = (n) => Math.round(n).toLocaleString('es-AR');

export default function MapaEntregas({ mes, zona }) {
  const caja = useRef(null); const mapRef = useRef(null);
  const [datos, setDatos] = useState(null); const [error, setError] = useState(''); const [sinMapa, setSinMapa] = useState('');
  const [ocultas, setOcultas] = useState([]); const [vista, setVista] = useState('calle');

  useEffect(() => {
    let vivo = true; setDatos(null); setError(''); setOcultas([]);
    apiFetch(`/api/ejecutivo/mapa?mes=${mes}`).then((r) => { if (vivo) setDatos(r); }).catch((e) => { if (vivo) setError(e.message || 'No se pudo cargar'); });
    return () => { vivo = false; };
  }, [mes]);

  // Localidades ordenadas por peso: a las más grandes les toca el color más fuerte
  const locs = useMemo(() => {
    const m = new Map();
    ((datos && datos.data) || []).filter((p) => zona === 'todas' || (zona === 'tandil') === isT(p.l)).forEach((p) => {
      const o = m.get(p.l) || { nombre: p.l, kg: 0, n: 0 }; o.kg += p.kg; o.n += 1; m.set(p.l, o);
    });
    return [...m.values()].sort((a, b) => b.kg - a.kg).map((l, i) => ({ ...l, color: COLORES[i % COLORES.length] }));
  }, [datos, zona]);
  const puntos = useMemo(() => {
    const col = new Map(locs.map((l) => [l.nombre, l.color]));
    return ((datos && datos.data) || []).filter((p) => col.has(p.l) && !ocultas.includes(p.l)).map((p) => ({
      lat: p.la, lon: p.lo, kg: p.kg, color: col.get(p.l), titulo: p.n || `Cliente ${p.c}`,
      detalle: `${p.l} · ${p.v} visita${p.v === 1 ? '' : 's'} · ${f0(p.kg)} kg${p.ch ? ` · ${p.ch}` : ''}` }));
  }, [datos, locs, ocultas]);

  useEffect(() => {
    if (!caja.current) return undefined;
    const map = crearMapa(caja.current, P.deposito, (m) => setSinMapa(m || 'No cargó el mapa base'));
    mapRef.current = map;
    return () => { clearTimeout(map._vigia); map._removed = true; map.remove(); mapRef.current = null; };
  }, []);
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    pintarEntregas(map, puntos);
    if (!ocultas.length) encuadrarPuntos(map, puntos, P.deposito);
  }, [puntos, ocultas.length]);

  const alternar = (n) => setOcultas((o) => (o.includes(n) ? o.filter((x) => x !== n) : [...o, n]));
  const cambiar = (v) => { setVista(v); const map = mapRef.current; if (map) cambiarVista(map, v, () => pintarEntregas(map, puntos)); };

  return (
    <div className="ej-mapa">
      <div className="ej-seg" role="group" aria-label="Tipo de mapa">
        {[['calle', 'Calle'], ['hib', 'Satélite']].map(([k, lb]) => <button key={k} className={vista === k ? 'on' : ''} onClick={() => cambiar(k)}>{lb}</button>)}
      </div>
      <div ref={caja} className="ej-mapa-lienzo" role="img" aria-label="Mapa de entregas del mes" />
      {!datos && !error && <div className="ej-cargando">Cargando entregas…</div>}
      {error && <div className="ej-op mal"><span className="ic">⚠️</span><span>{error}</span></div>}
      {sinMapa && <div className="ej-op"><span className="ic">ℹ️</span><span>El mapa base no cargó ({sinMapa}). Se muestra un fondo simple.</span></div>}
      {datos && !datos.data.length && <div className="ej-vacio">No hay romaneos cargados de este mes. Se suben desde Importar.</div>}
      {datos && datos.data.length > 0 && (
        <>
          <p className="sub" style={{ margin: '6px 0' }}>{f0(puntos.length)} clientes · {datos.dias} días de romaneo · el tamaño del círculo es el peso entregado.</p>
          <div className="ej-chips" aria-label="Localidades">
            {locs.map((l) => (
              <button key={l.nombre} className={ocultas.includes(l.nombre) ? '' : 'on'} onClick={() => alternar(l.nombre)} title={`${l.n} clientes · ${f0(l.kg)} kg`}>
                <i className="ej-punto" style={{ background: l.color }} /> {l.nombre}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
