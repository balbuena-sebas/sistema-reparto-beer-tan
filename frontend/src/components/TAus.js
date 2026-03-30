import React, { useState } from 'react';
import { MesSelector } from './MesSelector';
import { MB } from './MB';
import { fd } from '../utils/helpers';

export const TAus = ({ aM, mes, setMes, regsAll = [], ausAll = [], onNew, onEdit, onDel, loggedInUser }) => {
  const [search, setSearch] = useState('');

  const filtered = aM.filter(a =>
    !search ||
    a.persona?.toLowerCase().includes(search.toLowerCase()) ||
    a.motivo?.toLowerCase().includes(search.toLowerCase())
  );

  const resumen = {};
  aM.forEach(a => {
    resumen[a.motivo] = (resumen[a.motivo] || 0) + (a.dias || 1);
  });

  return (
    <div className="dash-container">
      <div className="dash-header">
        <div>
          <h2 className="dash-title">Ausencias del Personal</h2>
          <p className="dash-sub">
            {aM.length} registros · {[...new Set(aM.map(a => a.persona))].length} personas
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
            <button className="btn-action btn-primary-action" onClick={onNew}>+ Nueva Ausencia</button>
          )}
        </div>
      </div>

      {/* Resumen por motivo */}
      <div className="aus-resumen">
        {Object.entries(resumen).map(([motivo, dias]) => (
          <div key={motivo} className="aus-chip">
            <MB m={motivo} />
            <span className="aus-chip-dias">{dias} día{dias !== 1 ? 's' : ''}</span>
          </div>
        ))}
      </div>

      <div className="filter-bar">
        <input
          className="filter-input"
          placeholder="🔍 Buscar por persona o motivo..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className="dash-card">
        <div className="table-wrap">
          <table className="dash-table">
            <thead>
              <tr>
                <th>Persona</th>
                <th>Motivo</th>
                <th>Desde</th>
                <th>Hasta</th>
                <th>Días</th>
                <th>Observaciones</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(a => (
                <tr key={a.id}>
                  <td><strong>{a.persona}</strong></td>
                  <td><MB m={a.motivo} /></td>
                  <td>{fd(a.fechaDesde)}</td>
                  <td>{a.fechaHasta ? fd(a.fechaHasta) : '—'}</td>
                  <td><span className="dias-badge">{a.dias || 1}</span></td>
                  <td><span className="obs-text">{a.observaciones || '—'}</span></td>
                  <td>
                    {(!loggedInUser || loggedInUser.role === 'admin') && (
                      <div className="action-btns">
                        <button className="btn-icon btn-edit" onClick={() => onEdit(a)}>✏</button>
                        <button className="btn-icon btn-del" onClick={() => { if (window.confirm('¿Eliminar esta ausencia?')) onDel(a.id); }}>🗑</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="empty-state">No hay ausencias registradas este mes</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};