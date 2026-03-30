import React, { useState } from 'react';
import { MesSelector } from './MesSelector';
import { RB } from './RB';
import { fn, fd } from '../utils/helpers';
import { RepCard } from './TDash';

export const TRegs = ({ rM, mes, setMes, regsAll = [], ausAll = [], onNew, onEdit, onDel, loggedInUser }) => {
  const [search, setSearch]   = useState('');
  const [sortBy, setSortBy]   = useState('fecha');
  const [selected, setSelected] = useState(null);

  const filtered = rM
    .filter(r =>
      !search ||
      r.chofer?.toLowerCase().includes(search.toLowerCase()) ||
      r.localidad?.toLowerCase().includes(search.toLowerCase()) ||
      r.destino?.toLowerCase().includes(search.toLowerCase()) ||
      r.patente?.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      if (sortBy === 'fecha')  return (b.fecha || '').localeCompare(a.fecha || '');
      if (sortBy === 'bultos') return (+b.bultos || 0) - (+a.bultos || 0);
      if (sortBy === 'chofer') return (a.chofer || '').localeCompare(b.chofer || '');
      return 0;
    });

  const totalBultos   = rM.reduce((s, r) => s + (+r.bultos || 0), 0);
  const totalRecargas = rM.reduce((s, r) => s + (r.nRecargas || 0), 0);

  return (
    <div className="dash-container">
      <div className="dash-header">
        <div>
          <h2 className="dash-title">Registros de Reparto</h2>
          <p className="dash-sub">
            {rM.length} repartos · {fn(totalBultos)} bultos · {fn(totalRecargas)} recargas
            {loggedInUser && loggedInUser.role !== 'admin' && (
              <span style={{ marginLeft: 16, fontSize: 12, fontWeight: 700, color: '#64748b' }}>
                👤 Viendo: <strong>{loggedInUser.nombre}</strong>
              </span>
            )}
          </p>
        </div>
        <div className="dash-header-right">
          <MesSelector value={mes} onChange={setMes} regs={regsAll} aus={ausAll} />
          {(!loggedInUser || loggedInUser.role === 'admin') && (
            <button className="btn-action btn-primary-action" onClick={onNew}>+ Nuevo Registro</button>
          )}
        </div>
      </div>

      <div className="filter-bar">
        <input
          className="filter-input"
          placeholder="🔍 Buscar por chofer, localidad, destino o patente..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="filter-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="fecha">Ordenar: Fecha</option>
          <option value="bultos">Ordenar: Bultos</option>
          <option value="chofer">Ordenar: Chofer</option>
        </select>
      </div>

      <div className="dash-card">
        <div className="card-header">
          <span className="card-title">{filtered.length} registros</span>
          <span className="card-badge">👆 Click en una fila para ver detalle</span>
        </div>
        <div className="table-wrap">
          <table className="dash-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Chofer</th>
                <th>Ayudantes</th>
                <th>Patente</th>
                <th>Localidad</th>
                <th>Destino</th>
                <th>Bultos</th>
                <th>Recarga</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id} onClick={() => setSelected(r)} style={{ cursor: 'pointer' }}>
                  <td>{fd(r.fecha)}</td>
                  <td><strong>{r.chofer}</strong></td>
                  <td><span className="ay-list">{[r.ay1, r.ay2].filter(Boolean).join(', ') || '—'}</span></td>
                  <td><span className="pat-badge">{r.patente}</span></td>
                  <td><span className="loc-badge">{r.localidad?.split(' (')[0]}</span></td>
                  <td>{r.destino}</td>
                  <td><strong style={{ color: 'var(--accent)', fontSize: 15 }}>{fn(r.bultos)}</strong></td>
                  <td><RB r={r.recCant} /></td>
                  <td onClick={e => e.stopPropagation()}>
                    {(loggedInUser?.permisos?.editar_contenido === true) && (
                      <div className="action-btns">
                        <button className="btn-icon btn-edit" onClick={() => onEdit(r)} title="Editar">✏</button>
                        <button className="btn-icon btn-del"  onClick={() => { if (window.confirm('¿Eliminar este registro?')) onDel(r.id); }} title="Eliminar">🗑</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={9} className="empty-state">No se encontraron registros</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <RepCard
          r={selected}
          onClose={() => setSelected(null)}
          onEdit={r => { onEdit(r); setSelected(null); }}
          onDel={id => { onDel(id); setSelected(null); }}
          loggedInUser={loggedInUser}
        />
      )}
    </div>
  );
};