import React, { useState, useEffect, useMemo } from 'react';
import { cRec, cFTE, tod } from '../utils/helpers';
import { RB } from './RB';

// ─── Destino vacío por defecto ────────────────────────────────────────────────
const DESTINO_VACIO = () => ({ destino: '', bultos: '', costo: '', clark: false });
const MAX_DESTINOS = 8;

// ─── Calcula quién no está disponible en una fecha dada ──────────────────────
function calcDisponibilidad(fecha, aus) {
  if (!fecha || !aus?.length) return {};
  const mapa = {};
  aus.forEach(a => {
    if (!a.persona || !a.fechaDesde) return;
    const hasta = a.fechaHasta || a.fechaDesde;
    if (fecha >= a.fechaDesde && fecha <= hasta)
      mapa[a.persona] = { motivo: a.motivo, fechaDesde: a.fechaDesde, fechaHasta: hasta, dias: a.dias || 1 };
  });
  return mapa;
}

// ─── Select con disponibilidad visual ────────────────────────────────────────
const SelectDisponible = ({ label, value, onChange, opciones, noDisponible, placeholder = '— Ninguno —', requerido = false }) => (
  <div>
    <label style={{ display: 'block', fontSize: 13, fontWeight: 800, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
      {label}{requerido && <span style={{ color: 'var(--red)', marginLeft: 3 }}>*</span>}
    </label>
    <select className="filter-select" style={{ width: '100%' }} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {opciones.map(nombre => {
        const nd = noDisponible[nombre];
        return <option key={nombre} value={nombre} disabled={!!nd} style={{ color: nd ? '#94a3b8' : 'inherit' }}>
          {nd ? `⚠ ${nombre} — ${nd.motivo}` : nombre}
        </option>;
      })}
    </select>
    {value && noDisponible[value] && (
      <div style={{ marginTop: 6, padding: '6px 12px', background: '#fff7e0', border: '1px solid #f59e0b', borderRadius: 8, fontSize: 13, color: '#78350f', fontWeight: 700 }}>
        ⚠ {value} — <strong>{noDisponible[value].motivo}</strong>
      </div>
    )}
  </div>
);

// ─── Banner de no disponibles ─────────────────────────────────────────────────
const BannerNoDisponibles = ({ noDisponible, onContinuar, onCambiarFecha }) => {
  const lista = Object.entries(noDisponible);
  if (lista.length === 0) return null;
  const iconoMotivo = m => m === 'Vacaciones' ? '🏖' : m === 'Enfermedad' ? '🤒' : m === 'Licencia' ? '📄' : m === 'Accidente' ? '🚑' : '📅';

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(10,16,32,0.55)', backdropFilter: 'blur(4px)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, animation: 'fadeIn .15s' }}>
      <div style={{ background: '#fff', borderRadius: 22, maxWidth: 480, width: '100%', overflow: 'hidden', boxShadow: '0 20px 60px rgba(10,16,32,0.2)', animation: 'slideUp .2s' }}>
        <div style={{ background: 'linear-gradient(135deg, #7f1d1d, #b91c1c)', padding: '24px 28px', color: '#fff' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>⚠️</div>
          <div style={{ fontSize: 20, fontWeight: 900 }}>Personal no disponible</div>
          <div style={{ fontSize: 14, opacity: 0.85, marginTop: 4, fontWeight: 600 }}>Hay ausencias registradas para la fecha seleccionada</div>
        </div>
        <div style={{ padding: '20px 28px' }}>
          {lista.map(([nombre, info]) => (
            <div key={nombre} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
                {iconoMotivo(info.motivo)}
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>{nombre}</div>
                <div style={{ fontSize: 13, color: '#7f1d1d', fontWeight: 700 }}>{info.motivo} · {info.fechaDesde}{info.dias > 1 ? ` al ${info.fechaHasta}` : ''}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ padding: '16px 28px 24px', display: 'flex', gap: 10, justifyContent: 'flex-end', borderTop: '2px solid var(--border)' }}>
          <button className="btn-action btn-ghost" onClick={onCambiarFecha}>← Cambiar fecha</button>
          <button className="btn-action btn-primary-action" onClick={onContinuar} style={{ background: '#b91c1c' }}>Entendido, continuar igual</button>
        </div>
      </div>
    </div>
  );
};

// ─── Fila de un destino ───────────────────────────────────────────────────────
const FilaDestino = ({ idx, row, onChange, onRemove, destinos, fte, cfg, canRemove }) => {
  const recCant = (row.destino || row.bultos) && !row.clark
    ? cRec(row.bultos, fte, cfg.param1, cfg.param2, cfg.param3)
    : null;
  const showRec = recCant && recCant !== 'Sin recarga' && !recCant.startsWith('Pendiente');
  const bg = row.clark ? '#f0fdf4' : idx % 2 === 0 ? '#f8fafc' : '#fff';
  const border = row.clark ? '#4ade80' : '#e2e8f0';
  // Override del CSS global: padding chico, min-width:0 para que quepan en la celda
  const inputSt = { width:'100%', minWidth:0, padding:'7px 8px', fontSize:13, textAlign:'right',
    fontFamily:'inherit', background:'#fff', border:'2px solid #e2e8f0', borderRadius:8,
    boxSizing:'border-box', color:'#0a1020' };
  const selectSt = { width:'100%', minWidth:0, padding:'7px 10px', fontSize:13,
    fontFamily:'inherit', background:'#fff', border:'2px solid #e2e8f0', borderRadius:8,
    boxSizing:'border-box', color:'#0a1020', cursor:'pointer' };
  return (
    <>
      <tr style={{ background: bg }}>
        <td style={{ textAlign:'center', padding:'8px 4px', fontSize:12, fontWeight:800,
          color:'#94a3b8', borderLeft:`3px solid ${border}`, verticalAlign:'middle' }}>
          {idx + 1}
        </td>
        <td style={{ padding:'6px 8px', verticalAlign:'middle' }}>
          <select style={selectSt}
            value={row.destino} onChange={e => onChange(idx, 'destino', e.target.value)}>
            <option value="">— Destino —</option>
            {destinos.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </td>
        <td style={{ padding:'6px 6px', verticalAlign:'middle' }}>
          <input type="number" style={inputSt}
            placeholder="0" value={row.bultos} onChange={e => onChange(idx, 'bultos', e.target.value)} />
        </td>
        <td style={{ padding:'6px 6px', verticalAlign:'middle' }}>
          <input type="number" style={inputSt}
            placeholder="0" value={row.costo} onChange={e => onChange(idx, 'costo', e.target.value)} />
        </td>
        <td style={{ textAlign:'center', padding:'6px 4px', verticalAlign:'middle',
          borderRight:`3px solid ${border}` }}>
          <label style={{ display:'flex', flexDirection:'column', alignItems:'center',
            gap:3, cursor:'pointer', margin:0 }}>
            <input type="checkbox" checked={row.clark}
              onChange={e => onChange(idx, 'clark', e.target.checked)}
              style={{ width:16, height:16, accentColor:'#166534', cursor:'pointer', margin:0 }} />
            <span style={{ fontSize:9, fontWeight:800, lineHeight:1, whiteSpace:'nowrap',
              color: row.clark ? '#166534' : '#94a3b8', textTransform:'uppercase' }}>Clark</span>
          </label>
        </td>
        <td style={{ textAlign:'center', padding:'6px 4px', verticalAlign:'middle',
          borderRight:`3px solid ${border}` }}>
          <button onClick={() => onRemove(idx)} disabled={!canRemove}
            style={{ width:26, height:26, display:'inline-flex', alignItems:'center',
              justifyContent:'center', background: canRemove ? '#fee2e2' : 'transparent',
              border:'none', color: canRemove ? '#b91c1c' : '#cbd5e1', borderRadius:6,
              cursor: canRemove ? 'pointer' : 'default', fontWeight:900, fontSize:15, padding:0 }}>
            ×
          </button>
        </td>
      </tr>
      {showRec && (
        <tr style={{ background: bg }}>
          <td style={{ borderLeft:`3px solid ${border}`, padding:0 }} />
          <td colSpan={5} style={{ padding:'2px 8px 8px', borderRight:`3px solid ${border}` }}>
            <RB r={recCant} />
          </td>
        </tr>
      )}
    </>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// MODAL REGISTRO
// ══════════════════════════════════════════════════════════════════════════════
export const MReg = ({ d, cfg, aus = [], onSave, onClose, loggedInUser }) => {

  // Retrocompatibilidad: registro viejo con campos planos → convertir a multi-destino
  const iniciarDestinos = (reg) => {
    if (!reg) return [DESTINO_VACIO()];
    if (reg.destinos && Array.isArray(reg.destinos) && reg.destinos.length > 0) return reg.destinos;
    return [{ destino: reg.destino || '', bultos: reg.bultos || '', costo: reg.costoReparto || '', clark: false }];
  };

  const [form, setForm]               = useState(d
    ? { fecha: d.fecha, chofer: d.chofer || '', ay1: d.ay1 || '', ay2: d.ay2 || '', patente: d.patente || '', localidad: d.localidad || '' }
    : { fecha: tod(), chofer: '', ay1: '', ay2: '', patente: '', localidad: '' }
  );
  const [destinos, setDestinos]       = useState(iniciarDestinos(d));
  const [showBanner, setShowBanner]   = useState(false);
  const [bannerVisto, setBannerVisto] = useState(false);

  useEffect(() => {
    if (d) {
      setForm({ fecha: d.fecha, chofer: d.chofer || '', ay1: d.ay1 || '', ay2: d.ay2 || '', patente: d.patente || '', localidad: d.localidad || '' });
      setDestinos(iniciarDestinos(d));
    }
  }, [d]);

  const setF  = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const fte   = cFTE(form.chofer, form.ay1, form.ay2);
  const noDisponible  = useMemo(() => calcDisponibilidad(form.fecha, aus), [form.fecha, aus]);
  const hayNoDisp     = Object.keys(noDisponible).length > 0;

  // ── Totales calculados en tiempo real ────────────────────────────────────
  const totales = useMemo(() => {
    const filas           = destinos.filter(r => r.destino || r.bultos);
    const totalBultos     = filas.reduce((s, r) => s + (+r.bultos || 0), 0);
    const totalBultosClark = filas.filter(r => r.clark).reduce((s, r) => s + (+r.bultos || 0), 0);
    const totalBultosRec  = filas.filter(r => !r.clark).reduce((s, r) => s + (+r.bultos || 0), 0);
    const totalCosto      = filas.reduce((s, r) => s + (+r.costo || 0), 0);

    // Recarga por cada destino sin Clark
    const recsPorDestino = filas
      .filter(r => !r.clark && (r.destino || r.bultos))
      .map(r => ({
        destino: r.destino || `(fila sin nombre)`,
        recCant: cRec(r.bultos, fte, cfg.param1, cfg.param2, cfg.param3),
      }));

    const totalRecargas = recsPorDestino.reduce((s, r) => {
      return s + (r.recCant === '1 recarga' ? 1 : r.recCant === '3 recargas' ? 3 : 0);
    }, 0);

    return { totalBultos, totalBultosClark, totalBultosRec, totalCosto, recsPorDestino, totalRecargas };
  }, [destinos, fte, cfg]);

  // ── Manejo de filas ───────────────────────────────────────────────────────
  const updateDestino = (idx, campo, valor) =>
    setDestinos(prev => prev.map((r, i) => i === idx ? { ...r, [campo]: valor } : r));

  const addDestino = () => {
    if (destinos.length < MAX_DESTINOS) setDestinos(prev => [...prev, DESTINO_VACIO()]);
  };

  const removeDestino = (idx) => {
    if (destinos.length > 1) setDestinos(prev => prev.filter((_, i) => i !== idx));
  };

  // ── Guardar ───────────────────────────────────────────────────────────────
  const handleSave = () => {
    if (!form.chofer) return alert('El chofer es obligatorio');
    if (!form.fecha)  return alert('La fecha es obligatoria');
    const afectados = [form.chofer, form.ay1, form.ay2].filter(p => p && noDisponible[p]);
    if (afectados.length > 0 && !bannerVisto) { setShowBanner(true); return; }
    guardar();
  };

  const guardar = () => {
    const filas = destinos.filter(r => r.destino || r.bultos || r.costo);
    const primerDest = filas.find(r => !r.clark) || filas[0] || DESTINO_VACIO();
    onSave({
      ...form,
      id: d?.id || Date.now(),
      // Campos planos para compatibilidad con el resto del sistema
      destino:      primerDest.destino,
      bultos:       totales.totalBultos,
      costoReparto: totales.totalCosto,
      recSN:        totales.totalRecargas > 0 ? 'SI' : 'NO',
      nRecargas:    totales.totalRecargas,
      recCant:      totales.totalRecargas === 0 ? 'Sin recarga'
                  : totales.totalRecargas === 1 ? '1 recarga'
                  : `${totales.totalRecargas} recargas`,
      fte,
      // Datos completos
      destinos:     filas,
      bultosClark:  totales.totalBultosClark,
      bultosRec:    totales.totalBultosRec,
    });
    onClose();
  };

  return (
    <>
      <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
        <div className="modal-box" style={{ maxWidth: 860 }}>

          <div className="modal-header">
            <h3 className="modal-title">{d ? 'Editar Registro' : 'Nuevo Registro de Reparto'}</h3>
            <button className="modal-close" onClick={onClose}>×</button>
          </div>

          <div className="modal-body">

            {/* Aviso ausencias */}
            {hayNoDisp && (
              <div style={{ marginBottom: 14, padding: '12px 16px', background: '#fff7e0', border: '2px solid #f59e0b', borderRadius: 10 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#78350f', marginBottom: 5 }}>⚠ Personal con ausencia:</div>
                {Object.entries(noDisponible).map(([n, i]) => (
                  <div key={n} style={{ fontSize: 13, color: '#92400e', fontWeight: 600, marginTop: 2 }}>• <strong>{n}</strong> — {i.motivo}</div>
                ))}
              </div>
            )}

            {/* ─ Datos generales ─ */}
            <div style={{ background: 'var(--bg3)', border: '2px solid var(--border)', borderRadius: 12, padding: '14px 16px', marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Datos generales</div>
              <div className="modal-grid">
                <div className="modal-field">
                  <label>Fecha <span style={{ color: 'var(--red)' }}>*</span></label>
                  <input type="date" className="filter-input" value={form.fecha}
                    onChange={e => { setF('fecha', e.target.value); setBannerVisto(false); }} />
                </div>
                <div className="modal-field">
                  <label>Patente</label>
                  <select className="filter-select" style={{ width: '100%' }} value={form.patente} onChange={e => setF('patente', e.target.value)}>
                    <option value="">— Seleccionar —</option>
                    {(cfg.patentes || []).map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div className="modal-field" style={{ gridColumn: '1 / -1' }}>
                  <SelectDisponible label="Chofer" value={form.chofer} onChange={v => setF('chofer', v)}
                    opciones={[...(cfg.choferes || []), ...(cfg.operarios || [])]} noDisponible={noDisponible} placeholder="— Seleccionar chofer —" requerido />
                </div>
                <div className="modal-field">
                  <SelectDisponible label="Ayudante 1" value={form.ay1} onChange={v => setF('ay1', v)}
                    opciones={[...(cfg.ayudantes || []), ...(cfg.operarios || [])]} noDisponible={noDisponible} />
                </div>
                <div className="modal-field">
                  <SelectDisponible label="Ayudante 2" value={form.ay2} onChange={v => setF('ay2', v)}
                    opciones={[...(cfg.ayudantes || []), ...(cfg.operarios || [])]} noDisponible={noDisponible} />
                </div>
                <div className="modal-field">
                  <label>Localidad</label>
                  <select className="filter-select" style={{ width: '100%' }} value={form.localidad} onChange={e => setF('localidad', e.target.value)}>
                    <option value="">— Seleccionar —</option>
                    {(cfg.localidades || []).map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* ─ Tabla de destinos ─ */}
            <div style={{ background: 'var(--bg3)', border: '2px solid var(--border)', borderRadius: 12, padding: '14px 16px', marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  Destinos · {destinos.length}/{MAX_DESTINOS}
                </div>
                <button onClick={addDestino} disabled={destinos.length >= MAX_DESTINOS}
                  style={{ background: destinos.length < MAX_DESTINOS ? '#e8f3ff' : 'var(--bg3)', border: '2px solid var(--border)', color: destinos.length < MAX_DESTINOS ? '#005fa3' : 'var(--text3)', borderRadius: 8, padding: '5px 14px', cursor: destinos.length < MAX_DESTINOS ? 'pointer' : 'default', fontSize: 13, fontWeight: 800 }}>
                  + Agregar destino
                </button>
              </div>

              <table style={{ width:'100%', borderCollapse:'collapse', tableLayout:'fixed',
                border:'2px solid #e2e8f0', borderRadius:10, overflow:'hidden' }}>
                <colgroup>
                  <col style={{ width:36 }} />   {/* # */}
                  <col />                          {/* Destino — toma el resto */}
                  <col style={{ width:96 }} />    {/* Bultos */}
                  <col style={{ width:116 }} />   {/* Costo $ */}
                  <col style={{ width:60 }} />    {/* Clark */}
                  <col style={{ width:38 }} />    {/* × */}
                </colgroup>
                <thead>
                  <tr style={{ background:'#f1f5f9', borderBottom:'2px solid #e2e8f0' }}>
                    {[
                      ['#',       'center'],
                      ['Destino', 'left'  ],
                      ['Bultos',  'center'],
                      ['Costo $', 'center'],
                      ['Clark',   'center'],
                      ['',        'center'],
                    ].map(([h, align], i) => (
                      <th key={i} style={{ fontSize:11, fontWeight:800, color:'#64748b',
                        textTransform:'uppercase', letterSpacing:'0.06em',
                        textAlign:align, padding:'8px 8px',
                        borderBottom:'2px solid #e2e8f0' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {destinos.map((row, idx) => (
                    <FilaDestino key={idx} idx={idx} row={row}
                      onChange={updateDestino} onRemove={removeDestino}
                      destinos={cfg.destinos || []} fte={fte} cfg={cfg}
                      canRemove={destinos.length > 1} />
                  ))}
                </tbody>
              </table>

              <div style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600, marginTop: 4, padding: '0 4px' }}>
                🏭 <strong>Clark</strong>: los bultos se cuentan en el total pero <strong>no generan recarga</strong>
              </div>
            </div>

            {/* ─ Resumen ─ */}
            <div style={{ background: '#f0f9ff', border: '2px solid #60a5fa', borderRadius: 14, padding: '16px 18px' }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#1e40af', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>Resumen del reparto</div>

              {/* KPIs */}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
                {[
                  { label: 'Equipo', value: `${fte} pers.`, sub: `${form.chofer ? '1 chofer' : '—'}${form.ay1 ? ' · 1 ay.' : ''}${form.ay2 ? ' · 2 ay.' : ''}`, color: '#1e40af', bg: '#dbeafe' },
                  { label: 'Total bultos', value: totales.totalBultos || '—', sub: [totales.totalBultosClark > 0 && `${totales.totalBultosClark} Clark`, totales.totalBultosRec > 0 && `${totales.totalBultosRec} sin Clark`].filter(Boolean).join(' · ') || ' ', color: '#b87c00', bg: '#fef9c3' },
                  { label: 'Costo total', value: totales.totalCosto > 0 ? `$${totales.totalCosto.toLocaleString('es-AR')}` : '—', sub: `${destinos.filter(r => +r.costo > 0).length} destino(s)`, color: '#5b21b6', bg: '#ede9fe' },
                  { label: 'Recargas', value: totales.totalRecargas > 0 ? totales.totalRecargas : '—', sub: totales.totalRecargas > 0 ? `${totales.recsPorDestino.filter(r => r.recCant !== 'Sin recarga').length} destino(s)` : 'sin recarga', color: totales.totalRecargas > 0 ? '#b91c1c' : '#166534', bg: totales.totalRecargas > 0 ? '#fee2e2' : '#dcfce7' },
                ].map(k => (
                  <div key={k.label} style={{ background: k.bg, border: `2px solid ${k.color}30`, borderRadius: 12, padding: '10px 16px', minWidth: 120, flex: 1 }}>
                    <div style={{ fontSize: 11, color: k.color, fontWeight: 800, textTransform: 'uppercase', marginBottom: 3 }}>{k.label}</div>
                    <div style={{ fontSize: 22, fontWeight: 900, fontFamily: 'var(--font-mono)', color: k.color }}>{k.value}</div>
                    <div style={{ fontSize: 11, color: k.color, fontWeight: 600, opacity: 0.8, marginTop: 2 }}>{k.sub}</div>
                  </div>
                ))}
              </div>

              {/* Detalle recargas por destino */}
              {totales.recsPorDestino.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: '#1e40af', marginBottom: 8 }}>Recarga por destino:</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {totales.recsPorDestino.map((dr, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: '2px solid #bfdbfe', borderRadius: 10, padding: '7px 14px' }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text2)' }}>{dr.destino}</span>
                        <RB r={dr.recCant} />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {totales.recsPorDestino.length === 0 && (
                <div style={{ fontSize: 13, color: 'var(--text3)', fontWeight: 600 }}>
                  Completá al menos un destino con bultos para ver el cálculo de recargas
                </div>
              )}
            </div>

          </div>

          <div className="modal-footer">
            <button className="btn-action btn-ghost" onClick={onClose}>Cancelar</button>
            {loggedInUser?.permisos?.editar_contenido === true && (
              <button className="btn-action btn-primary-action" onClick={handleSave}>
                {d ? '✓ Actualizar' : '+ Guardar Registro'}
              </button>
            )}
          </div>

        </div>
      </div>

      {showBanner && (
        <BannerNoDisponibles
          noDisponible={noDisponible}
          onContinuar={() => { setShowBanner(false); setBannerVisto(true); guardar(); }}
          onCambiarFecha={() => setShowBanner(false)}
        />
      )}
    </>
  );
};