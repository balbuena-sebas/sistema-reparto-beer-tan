import React, { useState, useEffect } from 'react';
import { tod, cDias } from '../utils/helpers';

export const MAus = ({ d, cfg, all, onSave, onClose, loggedInUser }) => {
  const empty = { persona: '', motivo: '', fechaDesde: tod(), fechaHasta: '', observaciones: '' };
  const [form, setForm] = useState(d ? { ...d } : empty);

  useEffect(() => { if (d) setForm({ ...d }); }, [d]);

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const dias = cDias(form.fechaDesde, form.fechaHasta);

  const handleSave = () => {
    if (!form.persona) return alert('La persona es obligatoria');
    if (!form.motivo) return alert('El motivo es obligatorio');
    if (!form.fechaDesde) return alert('La fecha desde es obligatoria');
    onSave({
      ...form,
      id: form.id || Date.now(),
      dias
    });
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box">
        <div className="modal-header">
          <h3 className="modal-title">{d ? 'Editar Ausencia' : 'Nueva Ausencia'}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="modal-grid">
            <div className="modal-field" style={{ gridColumn: '1 / -1' }}>
              <label>Persona *</label>
              <select className="filter-select" value={form.persona} onChange={e => setF('persona', e.target.value)}>
                <option value="">— Seleccionar —</option>
                {(all || []).map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="modal-field" style={{ gridColumn: '1 / -1' }}>
              <label>Motivo *</label>
              <select className="filter-select" value={form.motivo} onChange={e => setF('motivo', e.target.value)}>
                <option value="">— Seleccionar —</option>
                {(cfg.motivosAusencia || []).map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="modal-field">
              <label>Fecha Desde *</label>
              <input type="date" className="filter-input" value={form.fechaDesde} onChange={e => setF('fechaDesde', e.target.value)} />
            </div>
            <div className="modal-field">
              <label>Fecha Hasta</label>
              <input type="date" className="filter-input" value={form.fechaHasta} onChange={e => setF('fechaHasta', e.target.value)} />
            </div>
            <div className="modal-field" style={{ gridColumn: '1 / -1' }}>
              <label>Observaciones</label>
              <textarea className="filter-input" rows={3} value={form.observaciones} onChange={e => setF('observaciones', e.target.value)} placeholder="Notas opcionales..." />
            </div>
          </div>
          <div className="modal-preview">
            <span className="preview-label">Días calculados: <strong style={{ color: '#e8b84b' }}>{dias}</strong></span>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-action btn-ghost" onClick={onClose}>Cancelar</button>
          {loggedInUser?.permisos?.editar_contenido === true && (
            <button className="btn-action btn-primary-action" onClick={handleSave}>
              {d ? '✓ Actualizar' : '+ Guardar Ausencia'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
