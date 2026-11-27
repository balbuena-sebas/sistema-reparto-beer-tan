// components/ejec/ui.js — piezas visuales compartidas del formato "ejecutivo" (sin librerías, muy livianas).
// Reutilizables en cualquier pestaña: tarjeta de indicador, número animado, barra, semáforo y gráfico de evolución.
import React, { useEffect, useRef, useState } from 'react';
import './ejecutivo.css';

const PREFIERE_QUIETO = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

// Número que "sube" hasta su valor. fmt recibe el número y devuelve el texto.
export function Contar({ valor, fmt = (n) => Math.round(n).toLocaleString('es-AR'), ms = 700 }) {
  const [v, setV] = useState(PREFIERE_QUIETO() ? valor : 0);
  const desde = useRef(0);
  useEffect(() => {
    if (valor == null || Number.isNaN(valor)) return undefined;
    if (PREFIERE_QUIETO()) { setV(valor); return undefined; }
    const ini = desde.current, t0 = performance.now();
    let raf;
    const paso = (t) => {
      const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      setV(ini + (valor - ini) * e);
      if (k < 1) raf = requestAnimationFrame(paso); else desde.current = valor;
    };
    raf = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(raf);
  }, [valor, ms]);
  if (valor == null || Number.isNaN(valor)) return <span className="ej-nd">sin datos</span>;
  return <span>{fmt(v)}</span>;
}

// Variación contra otro período. mejorSiBaja: en costos, bajar es bueno.
export function Variacion({ actual, previo, mejorSiBaja = false, sufijo = 'vs mes anterior' }) {
  if (actual == null || previo == null || !previo) return null;
  const p = ((actual - previo) / Math.abs(previo)) * 100;
  if (!Number.isFinite(p)) return null;
  const bueno = mejorSiBaja ? p < 0 : p > 0;
  const neutro = Math.abs(p) < 0.5;
  return (
    <span className={`ej-var ${neutro ? 'n' : bueno ? 'ok' : 'mal'}`} title={sufijo}>
      {neutro ? '＝' : p > 0 ? '▲' : '▼'} {Math.abs(p).toLocaleString('es-AR', { maximumFractionDigits: 1 })}%
      <small> {sufijo}</small>
    </span>
  );
}

// Tarjeta de indicador: etiqueta, valor grande, detalle y variación.
export function Tile({ icono, etiqueta, children, detalle, variacion, tono = 'base', ayuda, idx = 0, onClick, activa }) {
  return (
    <div className={`ej-tile t-${tono} ${onClick ? 'click' : ''} ${activa ? 'activa' : ''}`} style={{ '--i': idx }} title={ayuda}
      onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}>
      <div className="ej-tile-top"><span className="ej-ic">{icono}</span><span className="ej-et">{etiqueta}</span></div>
      <div className="ej-val">{children}</div>
      {detalle && <div className="ej-det">{detalle}</div>}
      {variacion}
    </div>
  );
}

// Barra de progreso con color por umbral (verde / amarillo / rojo). pct 0..100+
export function Barra({ pct, bajo = 50, alto = 75, invertida = false, etiqueta }) {
  if (pct == null) return <div className="ej-barra vacia" />;
  const v = Math.max(0, Math.min(100, pct));
  let c = pct >= alto ? 'ok' : pct >= bajo ? 'aviso' : 'mal';
  if (invertida) c = pct <= bajo ? 'ok' : pct <= alto ? 'aviso' : 'mal';
  return (
    <div className="ej-barra" role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} aria-label={etiqueta}>
      <i className={c} style={{ width: `${v}%` }} />
    </div>
  );
}

export const Semaforo = ({ nivel, texto }) => <span className={`ej-sem ${nivel}`} title={texto}>{nivel === 'ok' ? '●' : nivel === 'aviso' ? '●' : nivel === 'mal' ? '●' : '○'}</span>;

// Gráfico de barras de evolución (SVG propio). puntos: [{ etiqueta, valor|null }]
export function Evolucion({ puntos, fmt = (n) => n.toLocaleString('es-AR'), color = 'var(--ej-acento)', sel, onSel, linea }) {
  const [hover, setHover] = useState(null);
  const vals = puntos.map((p) => p.valor).filter((v) => v != null && Number.isFinite(v));
  const max = Math.max(1, ...vals, linea || 0);
  const W = Math.max(280, puntos.length * 38), H = 150, B = 22, T = 14;
  const bw = Math.min(26, (W / puntos.length) * 0.62);
  const x = (i) => (W / puntos.length) * (i + 0.5);
  const y = (v) => T + (H - B - T) * (1 - v / max);
  const act = hover != null ? hover : sel;
  return (
    <div className="ej-evo">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Evolución mensual" preserveAspectRatio="xMidYMid meet">
        {linea != null && <line x1="0" x2={W} y1={y(linea)} y2={y(linea)} className="ej-ref" />}
        {puntos.map((p, i) => {
          const hay = p.valor != null && Number.isFinite(p.valor);
          const top = hay ? y(p.valor) : H - B;
          return (
            <g key={p.etiqueta + i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => onSel && onSel(i)} style={{ cursor: onSel ? 'pointer' : 'default' }}>
              <rect x={x(i) - (W / puntos.length) / 2} y={0} width={W / puntos.length} height={H} fill="transparent" />
              {hay
                ? <rect className={`ej-bar ${act === i ? 'on' : ''}`} x={x(i) - bw / 2} y={top} width={bw} height={Math.max(2, H - B - top)} rx="4" style={{ '--i': i, fill: color }} />
                : <rect x={x(i) - bw / 2} y={H - B - 3} width={bw} height="3" rx="1.5" className="ej-bar-nd" />}
              <text x={x(i)} y={H - 6} textAnchor="middle" className={`ej-x ${act === i ? 'on' : ''}`}>{p.etiqueta}</text>
              {act === i && hay && <text x={x(i)} y={Math.max(10, top - 5)} textAnchor="middle" className="ej-v">{fmt(p.valor)}</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// Mini línea para tablas
export function Spark({ valores, color = 'var(--ej-acento)' }) {
  const v = valores.filter((n) => n != null && Number.isFinite(n));
  if (v.length < 2) return <span className="ej-nd">—</span>;
  const w = 70, h = 22, mx = Math.max(...v), mn = Math.min(...v), rg = mx - mn || 1;
  const pts = valores.map((n, i) => (n == null ? null : [(w / (valores.length - 1)) * i, h - 3 - ((n - mn) / rg) * (h - 6)])).filter(Boolean);
  return <svg className="ej-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true"><polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

// Chips de estado de los datos del período (qué fuentes tienen datos)
export function Fuentes({ items }) {
  return (
    <div className="ej-fuentes">
      {items.map((f) => (
        <span key={f.nombre} className={`ej-chip ${f.ok ? 'ok' : 'nd'}`} title={f.detalle}>{f.ok ? '✓' : '○'} {f.nombre}</span>
      ))}
    </div>
  );
}
