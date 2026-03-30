// src/components/MesSelector.js
// Selector dinámico de meses — muestra solo meses con datos + mes actual
import React, { useMemo } from 'react';

const NOMBRES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'
];

export function MesSelector({ value, onChange, regs = [], aus = [], rechazos = [] }) {
  const meses = useMemo(() => {
    const hoy = new Date();
    const mesActual = `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}`;
    const set = new Set([mesActual]);
    regs    .forEach(r => { const m = (r.fecha||'').slice(0,7);     if (m.length===7) set.add(m); });
    aus     .forEach(a => { const m = (a.fechaDesde||'').slice(0,7); if (m.length===7) set.add(m); });
    rechazos.forEach(r => { const m = (r.fecha||'').slice(0,7);     if (m.length===7) set.add(m); });
    return [...set]
      .sort((a,b) => b.localeCompare(a))
      .slice(0, 24)
      .map(v => {
        const [y, m] = v.split('-');
        return { value: v, label: `${NOMBRES[+m-1]} ${y}` };
      });
  }, [regs, aus, rechazos]);

  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        padding: '6px 12px', borderRadius: 8,
        border: '1.5px solid #e5b84b', fontWeight: 600,
        fontSize: 14, background: '#fff', cursor: 'pointer',
        minWidth: 150,
      }}
    >
      {meses.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}