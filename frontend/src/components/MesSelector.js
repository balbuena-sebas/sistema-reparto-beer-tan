// src/components/MesSelector.js
// Selector dinámico de meses — muestra solo meses con datos + mes actual
import React, { useMemo } from 'react';

const NOMBRES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'
];

export function MesSelector({ value, onChange, regs = [], aus = [], rechazos = [], mesesGlobales = [] }) {
  const meses = useMemo(() => {
    // Si se proporciona mesesGlobales, usarlo directamente (prioridad)
    if (mesesGlobales && mesesGlobales.length > 0) {
      const set = new Set([...(mesesGlobales || []), value].filter(Boolean));
      const mesesOrdenados = [...set]
        .sort((a,b) => b.localeCompare(a))
        .slice(0, 24)
        .map(v => {
          const [y, m] = v.split('-');
          return { value: v, label: `${NOMBRES[+m-1]} ${y}` };
        });
      return [{ value: '', label: 'Últimos 6 meses' }, ...mesesOrdenados];
    }
    
    // Fallback: calcular dinámicamente desde los datos locales
    const set = new Set([value].filter(Boolean));
    regs.forEach(r => { const m = (r.fecha||'').slice(0,7); if (m.length===7) set.add(m); });
    aus.forEach(a => { const m = (a.fechaDesde||'').slice(0,7); if (m.length===7) set.add(m); });
    rechazos.forEach(r => { const m = (r.fecha||'').slice(0,7); if (m.length===7) set.add(m); });
    const mesesOrdenados = [...set]
      .sort((a,b) => b.localeCompare(a))
      .slice(0, 24)
      .map(v => {
        const [y, m] = v.split('-');
        return { value: v, label: `${NOMBRES[+m-1]} ${y}` };
      });

    return [{ value: '', label: 'Últimos 6 meses' }, ...mesesOrdenados];
  }, [value, regs, aus, rechazos, mesesGlobales]);

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