// simulacion/seleccion.js — Selección de clientes sobre el mapa con círculo, lazo o rectángulo.
// La geometría es pura (se prueba aparte); CapaSeleccion es una capa transparente encima del mapa que dibuja la forma.
import React, { useRef, useEffect } from 'react';

export const enRect = ([x, y], [x1, y1], [x2, y2]) => x >= Math.min(x1, x2) && x <= Math.max(x1, x2) && y >= Math.min(y1, y2) && y <= Math.max(y1, y2);
export const enCirculo = ([x, y], [cx, cy], r) => Math.hypot(x - cx, y - cy) <= r;
export function enPoligono([x, y], poly) {
  let dentro = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}
// forma: { tipo: 'circulo'|'lazo'|'rect', ini: [x,y], fin: [x,y], pts: [[x,y],…] } en píxeles del mapa
export function codsEnForma(puntos, forma, proyectar) {
  const out = new Set();
  const r = forma.tipo === 'circulo' ? Math.hypot(forma.fin[0] - forma.ini[0], forma.fin[1] - forma.ini[1]) : 0;
  for (const p of puntos) {
    const q = proyectar(p);
    const ok = forma.tipo === 'circulo' ? enCirculo(q, forma.ini, r)
      : forma.tipo === 'rect' ? enRect(q, forma.ini, forma.fin)
        : forma.pts.length >= 3 && enPoligono(q, forma.pts);
    if (ok) out.add(p.cod);
  }
  return [...out];
}

export function CapaSeleccion({ herramienta, getPuntos, proyectar, onSeleccion, onCancelar }) {
  const cv = useRef(null), est = useRef(null);
  useEffect(() => {
    const el = cv.current; if (!el) return undefined;
    const ajustar = () => { const r = el.parentElement.getBoundingClientRect(); el.width = r.width; el.height = r.height; };
    ajustar(); window.addEventListener('resize', ajustar);
    const tecla = (e) => { if (e.key === 'Escape') onCancelar && onCancelar(); };
    window.addEventListener('keydown', tecla);
    return () => { window.removeEventListener('resize', ajustar); window.removeEventListener('keydown', tecla); };
  }, [herramienta, onCancelar]);
  if (!herramienta) return null;
  const pos = (e) => { const r = cv.current.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const forma = () => {
    const s = est.current; if (!s) return null;
    return { tipo: herramienta, ini: s.ini, fin: s.fin, pts: s.pts };
  };
  const dibujar = () => {
    const el = cv.current, g = el.getContext('2d'); g.clearRect(0, 0, el.width, el.height);
    const f = forma(); if (!f) return;
    g.lineWidth = 2; g.strokeStyle = '#ff9800'; g.fillStyle = 'rgba(255,152,0,0.15)'; g.setLineDash([6, 4]); g.beginPath();
    if (f.tipo === 'circulo') g.arc(f.ini[0], f.ini[1], Math.hypot(f.fin[0] - f.ini[0], f.fin[1] - f.ini[1]), 0, Math.PI * 2);
    else if (f.tipo === 'rect') g.rect(f.ini[0], f.ini[1], f.fin[0] - f.ini[0], f.fin[1] - f.ini[1]);
    else { f.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); }
    g.fill(); g.stroke();
  };
  return (
    <canvas ref={cv} className="sim-lazo" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'crosshair', touchAction: 'none', zIndex: 5 }}
      onPointerDown={(e) => { cv.current.setPointerCapture(e.pointerId); const p = pos(e); est.current = { ini: p, fin: p, pts: [p] }; dibujar(); }}
      onPointerMove={(e) => { if (!est.current) return; const p = pos(e); est.current.fin = p; est.current.pts.push(p); dibujar(); }}
      onPointerUp={(e) => {
        if (!est.current) return;
        const f = forma(); est.current = null; dibujar();
        const cods = codsEnForma(getPuntos(), f, proyectar);
        onSeleccion(cods, e.shiftKey);
      }} />
  );
}
