// src/components/TNotas.js — Tablero de notas por persona y mes (estilo Kanban/Trello)
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { MesSelector } from './MesSelector';
import { fn } from '../utils/helpers';
import { getNotas, crearNota, actualizarNota, eliminarNota } from '../api/client';

// ── Categorías disponibles ────────────────────────────────────────────────────
const CATEGORIAS = [
  { id: 'Aviso',           icon: '📢', color: '#0369a1', bg: '#e0f2fe', border: '#7dd3fc' },
  { id: 'Reclamo',         icon: '⚠️',  color: '#b91c1c', bg: '#fee2e2', border: '#fca5a5' },
  { id: 'Recordatorio',    icon: '🔔', color: '#b87c00', bg: '#fff7e0', border: '#fcd34d' },
  { id: 'Nota libre',      icon: '📝', color: '#475569', bg: '#f1f5f9', border: '#cbd5e1' },
  { id: 'Tarea pendiente', icon: '✅', color: '#166534', bg: '#dcfce7', border: '#86efac' },
  { id: 'Seguimiento',     icon: '👁',  color: '#5b21b6', bg: '#ede9fe', border: '#c4b5fd' },
  { id: 'Bloqueo',         icon: '🚫', color: '#7f1d1d', bg: '#fecaca', border: '#f87171' },
];

const CAT_MAP = Object.fromEntries(CATEGORIAS.map(c => [c.id, c]));
const getCat = (id) => CAT_MAP[id] || CATEGORIAS[3];

// ── Badge categoría ───────────────────────────────────────────────────────────
const CatBadge = ({ cat }) => {
  const c = getCat(cat);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
      background: c.bg, color: c.color, border: `1px solid ${c.border}`,
      whiteSpace: 'nowrap',
    }}>
      {c.icon} {c.id}
    </span>
  );
};

// ── Modal nueva/editar nota ───────────────────────────────────────────────────
const ModalNota = ({ nota, personas, mes, onGuardar, onCerrar }) => {
  const [form, setForm] = useState({
    persona:   nota?.persona   || '',
    mes:       nota?.mes       || mes,
    fecha:     nota?.fecha     || new Date().toISOString().split('T')[0],
    categoria: nota?.categoria || 'Nota libre',
    texto:     nota?.texto     || '',
    prioridad: nota?.prioridad || 'normal',
  });
  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const cat = getCat(form.categoria);

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(10,16,32,.5)', backdropFilter:'blur(4px)',
      zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
      onClick={e => e.target === e.currentTarget && onCerrar()}>
      <div style={{ background:'#fff', borderRadius:22, maxWidth:560, width:'100%',
        maxHeight:'92vh', overflowY:'auto', boxShadow:'0 20px 60px rgba(10,16,32,.18)' }}>
        <div style={{ background:`linear-gradient(135deg, ${cat.color} 0%, ${cat.color}dd 100%)`,
          padding:'20px 24px', color:'#fff', borderRadius:'22px 22px 0 0',
          display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div style={{ fontSize:18, fontWeight:900 }}>{cat.icon} {nota ? 'Editar nota' : 'Nueva nota'}</div>
          <button onClick={onCerrar} style={{ background:'rgba(255,255,255,.2)', border:'none',
            color:'#fff', borderRadius:8, width:32, height:32, fontSize:18, cursor:'pointer', fontWeight:900 }}>×</button>
        </div>
        <div style={{ padding:'22px 24px', display:'flex', flexDirection:'column', gap:16 }}>
          <div>
            <label style={{ display:'block', fontSize:12, fontWeight:800, color:'#64748b',
              textTransform:'uppercase', letterSpacing:'.06em', marginBottom:6 }}>Persona *</label>
            <select className="filter-select" style={{ width:'100%' }}
              value={form.persona} onChange={e => setF('persona', e.target.value)}>
              <option value="">— Seleccionar —</option>
              {personas.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            <div>
              <label style={{ display:'block', fontSize:12, fontWeight:800, color:'#64748b',
                textTransform:'uppercase', letterSpacing:'.06em', marginBottom:6 }}>Categoría</label>
              <select className="filter-select" style={{ width:'100%' }}
                value={form.categoria} onChange={e => setF('categoria', e.target.value)}>
                {CATEGORIAS.map(c => <option key={c.id} value={c.id}>{c.icon} {c.id}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display:'block', fontSize:12, fontWeight:800, color:'#64748b',
                textTransform:'uppercase', letterSpacing:'.06em', marginBottom:6 }}>Prioridad</label>
              <select className="filter-select" style={{ width:'100%' }}
                value={form.prioridad} onChange={e => setF('prioridad', e.target.value)}>
                <option value="normal">⚪ Normal</option>
                <option value="urgente">🔴 Urgente</option>
              </select>
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            <div>
              <label style={{ display:'block', fontSize:12, fontWeight:800, color:'#64748b',
                textTransform:'uppercase', letterSpacing:'.06em', marginBottom:6 }}>Fecha</label>
              <input type="date" className="filter-input" style={{ width:'100%' }}
                value={form.fecha} onChange={e => setF('fecha', e.target.value)} />
            </div>
            <div>
              <label style={{ display:'block', fontSize:12, fontWeight:800, color:'#64748b',
                textTransform:'uppercase', letterSpacing:'.06em', marginBottom:6 }}>Mes</label>
              <input type="month" className="filter-input" style={{ width:'100%' }}
                value={form.mes} onChange={e => setF('mes', e.target.value)} />
            </div>
          </div>
          <div>
            <label style={{ display:'block', fontSize:12, fontWeight:800, color:'#64748b',
              textTransform:'uppercase', letterSpacing:'.06em', marginBottom:6 }}>Contenido *</label>
            <textarea style={{ width:'100%', minHeight:100, padding:'10px 14px', fontSize:14,
              border:'2px solid var(--border)', borderRadius:10, fontFamily:'var(--font-head)',
              resize:'vertical', boxSizing:'border-box', lineHeight:1.6 }}
              placeholder="Escribí la nota acá..."
              value={form.texto} onChange={e => setF('texto', e.target.value)} />
          </div>
        </div>
        <div style={{ padding:'0 24px 22px', display:'flex', gap:10, justifyContent:'flex-end' }}>
          <button className="btn-action btn-ghost" onClick={onCerrar}>Cancelar</button>
          <button className="btn-action btn-primary-action" onClick={() => {
            if (!form.persona) return alert('Seleccioná una persona');
            if (!form.texto.trim()) return alert('Escribí el contenido');
            onGuardar(form);
          }}>{nota ? '✓ Guardar cambios' : '+ Crear nota'}</button>
        </div>
      </div>
    </div>
  );
};

// ── Card individual ───────────────────────────────────────────────────────────
const CardNota = ({ nota, onEditar, onResolver, onEliminar, loggedInUser }) => {
  const cat      = getCat(nota.categoria);
  const resuelta = nota.estado === 'resuelta';
  const urgente  = nota.prioridad === 'urgente';
  const canEdit  = !loggedInUser || loggedInUser.role === 'admin';
  return (
    <div style={{
      background: resuelta ? '#f8fafc' : '#fff',
      border: `2px solid ${resuelta ? '#e2e8f0' : urgente ? '#fca5a5' : cat.border}`,
      borderLeft: `5px solid ${resuelta ? '#cbd5e1' : urgente ? '#b91c1c' : cat.color}`,
      borderRadius: 14, padding: '14px 16px', opacity: resuelta ? 0.7 : 1, transition: 'all .15s',
    }}>
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:8, gap:8 }}>
        <div style={{ display:'flex', flexWrap:'wrap', gap:6, alignItems:'center' }}>
          <CatBadge cat={nota.categoria} />
          {urgente && !resuelta && (
            <span style={{ fontSize:11, fontWeight:800, padding:'2px 8px', borderRadius:8,
              background:'#fee2e2', color:'#b91c1c', border:'1px solid #fca5a5' }}>🔴 URGENTE</span>
          )}
          {resuelta && (
            <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:8,
              background:'#dcfce7', color:'#166534', border:'1px solid #86efac' }}>✅ Resuelta</span>
          )}
        </div>
        {canEdit && (
          <div style={{ display:'flex', gap:6, flexShrink:0 }}>
            {!resuelta && (
              <button onClick={() => onResolver(nota.id)} title="Marcar como resuelta"
                style={{ width:30, height:30, borderRadius:8, border:'2px solid #86efac',
                  background:'#dcfce7', color:'#166534', cursor:'pointer', fontSize:14,
                  display:'flex', alignItems:'center', justifyContent:'center' }}>✓</button>
            )}
            {!resuelta && (
              <button onClick={() => onEditar(nota)} title="Editar"
                style={{ width:30, height:30, borderRadius:8, border:'2px solid #f59e0b',
                  background:'#fef3c7', color:'#78350f', cursor:'pointer', fontSize:13,
                  display:'flex', alignItems:'center', justifyContent:'center' }}>✏</button>
            )}
            <button onClick={() => { if (window.confirm('¿Eliminar esta nota?')) onEliminar(nota.id); }}
              style={{ width:30, height:30, borderRadius:8, border:'2px solid #fca5a5',
                background:'#fee2e2', color:'#b91c1c', cursor:'pointer', fontSize:13,
                display:'flex', alignItems:'center', justifyContent:'center' }}>🗑</button>
          </div>
        )}
      </div>
      <p style={{ fontSize:14, fontWeight:500, color: resuelta ? '#94a3b8' : '#1e293b',
        lineHeight:1.6, margin:'0 0 10px',
        textDecoration: resuelta ? 'line-through' : 'none' }}>
        {nota.texto}
      </p>
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:'#94a3b8', fontWeight:600 }}>
        <span>📅 {nota.fecha || nota.mes}</span>
        {resuelta && nota.updatedAt && (
          <span>Resuelta: {new Date(nota.updatedAt).toLocaleDateString('es-AR')}</span>
        )}
      </div>
    </div>
  );
};

// ── Columna de persona ────────────────────────────────────────────────────────
const ColumnaPersona = ({ persona, notas, onEditar, onResolver, onEliminar, onNueva, loggedInUser }) => {
  const activas   = notas.filter(n => n.estado === 'activa');
  const resueltas = notas.filter(n => n.estado === 'resuelta');
  const urgentes  = activas.filter(n => n.prioridad === 'urgente').length;
  const [mostrarResueltas, setMostrarResueltas] = useState(false);

  const ordenadas = [...activas].sort((a, b) => {
    if (a.prioridad === 'urgente' && b.prioridad !== 'urgente') return -1;
    if (b.prioridad === 'urgente' && a.prioridad !== 'urgente') return  1;
    return new Date(b.creadoEn || 0) - new Date(a.creadoEn || 0);
  });

  return (
    <div style={{ background:'var(--bg3)', border:'2px solid var(--border)', borderRadius:18,
      minWidth:280, maxWidth:340, flex:'1 1 280px', display:'flex', flexDirection:'column',
      maxHeight:'calc(100vh - 240px)' }}>
      <div style={{ padding:'14px 16px 10px', borderBottom:'2px solid var(--border)',
        background:'var(--bg2)', borderRadius:'16px 16px 0 0' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
          <span style={{ fontSize:15, fontWeight:900, color:'var(--text)' }}>{persona}</span>
          <div style={{ display:'flex', gap:6, alignItems:'center' }}>
            {urgentes > 0 && (
              <span style={{ fontSize:11, fontWeight:800, padding:'2px 8px', borderRadius:10,
                background:'#fee2e2', color:'#b91c1c' }}>🔴 {urgentes}</span>
            )}
            <span style={{ fontSize:12, fontFamily:'var(--font-mono)', fontWeight:700,
              color:'var(--text3)', background:'var(--bg3)', padding:'2px 8px', borderRadius:8 }}>
              {activas.length}
            </span>
          </div>
        </div>
        <button onClick={() => onNueva(persona)}
          style={{ width:'100%', padding:'7px 0', background:'var(--accent)', color:'#fff',
            border:'none', borderRadius:8, fontSize:13, fontWeight:800, cursor:'pointer',
            display: (!loggedInUser || loggedInUser.role === 'admin') ? 'block' : 'none' }}>
          + Nueva nota
        </button>
      </div>
      <div style={{ flex:1, overflowY:'auto', padding:'10px 12px',
        display:'flex', flexDirection:'column', gap:10 }}>
        {ordenadas.length === 0 && (
          <div style={{ textAlign:'center', padding:'24px 0', color:'#94a3b8', fontSize:13, fontWeight:600 }}>
            Sin notas activas
          </div>
        )}
        {ordenadas.map(n => (
          <CardNota key={n.id} nota={n} onEditar={onEditar} onResolver={onResolver} onEliminar={onEliminar} loggedInUser={loggedInUser} />
        ))}
        {resueltas.length > 0 && (
          <div style={{ marginTop:4 }}>
            <button onClick={() => setMostrarResueltas(v => !v)}
              style={{ width:'100%', padding:'6px 0', background:'transparent',
                border:'2px dashed var(--border)', borderRadius:8, fontSize:12,
                fontWeight:700, color:'var(--text3)', cursor:'pointer' }}>
              {mostrarResueltas ? '▲' : '▼'} {resueltas.length} resuelta{resueltas.length !== 1 ? 's' : ''}
            </button>
            {mostrarResueltas && resueltas.map(n => (
              <div key={n.id} style={{ marginTop:8 }}>
                <CardNota nota={n} onEditar={onEditar} onResolver={onResolver} onEliminar={onEliminar} loggedInUser={loggedInUser} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
export const TNotas = ({ cfg, mes, setMes, regsAll = [], ausAll = [], loggedInUser, notify }) => {
  const [notas,           setNotas]           = useState([]);
  const [cargando,        setCargando]        = useState(true);
  const [modal,           setModal]           = useState(null);
  const [filtroCat,       setFiltroCat]       = useState('');
  const [filtroPrio,      setFiltroPrio]      = useState('');
  const [filtroTexto,     setFiltroTexto]     = useState('');
  const [verTodosLosMeses,setVerTodosLosMeses]= useState(false);

  const personas = useMemo(() => cfg.personasNotas || [], [cfg.personasNotas]);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const filtros = verTodosLosMeses ? {} : { mes };
      const data = await getNotas(filtros);
      setNotas(Array.isArray(data) ? data : []);
    } catch { setNotas([]); }
    setCargando(false);
  }, [mes, verTodosLosMeses]);

  useEffect(() => { cargar(); }, [cargar]);

  const handleCrear = useCallback(async (form) => {
    try {
      const nueva = await crearNota(form);
      setNotas(prev => [nueva, ...prev]);
      setModal(null);
      notify('✓ Nota creada');
    } catch (err) { notify('❌ ' + err.message, 'w'); }
  }, [notify]);

  const handleEditar = useCallback(async (form) => {
    try {
      const actualizada = await actualizarNota(modal.nota.id, form);
      setNotas(prev => prev.map(n => n.id === actualizada.id ? actualizada : n));
      setModal(null);
      notify('✓ Nota actualizada');
    } catch (err) { notify('❌ ' + err.message, 'w'); }
  }, [modal, notify]);

  const handleResolver = useCallback(async (id) => {
    try {
      const actualizada = await actualizarNota(id, { estado: 'resuelta' });
      setNotas(prev => prev.map(n => n.id === actualizada.id ? actualizada : n));
      notify('✓ Nota marcada como resuelta');
    } catch (err) { notify('❌ ' + err.message, 'w'); }
  }, [notify]);

  const handleEliminar = useCallback(async (id) => {
    try {
      await eliminarNota(id);
      setNotas(prev => prev.filter(n => n.id !== id));
      notify('Nota eliminada', 'w');
    } catch (err) { notify('❌ ' + err.message, 'w'); }
  }, [notify]);

  const notasFiltradas = useMemo(() => notas.filter(n => {
    if (filtroCat  && n.categoria !== filtroCat)  return false;
    if (filtroPrio && n.prioridad !== filtroPrio)  return false;
    if (filtroTexto) {
      const b = filtroTexto.toLowerCase();
      if (!n.texto?.toLowerCase().includes(b) && !n.persona?.toLowerCase().includes(b)) return false;
    }
    return true;
  }), [notas, filtroCat, filtroPrio, filtroTexto]);

  const stats = useMemo(() => ({
    activas:   notas.filter(n => n.estado === 'activa').length,
    urgentes:  notas.filter(n => n.estado === 'activa' && n.prioridad === 'urgente').length,
    resueltas: notas.filter(n => n.estado === 'resuelta').length,
  }), [notas]);

  if (personas.length === 0) return (
    <div className="dash-container">
      <div className="dash-header">
        <div><h2 className="dash-title">📋 Notas</h2><p className="dash-sub">Tablero de notas por persona</p></div>
      </div>
      <div style={{ textAlign:'center', padding:'64px 24px', color:'#94a3b8' }}>
        <div style={{ fontSize:56, marginBottom:16 }}>📋</div>
        <div style={{ fontSize:18, fontWeight:800, color:'#475569', marginBottom:8 }}>
          No hay personas configuradas para notas
        </div>
        <div style={{ fontSize:14, maxWidth:400, margin:'0 auto', lineHeight:1.7 }}>
          Andá a <strong>Config → Personas para Notas</strong> y agregá las personas
          que van a tener tarjetas en este tablero.
        </div>
      </div>
    </div>
  );

  return (
    <div className="dash-container">
      <div className="dash-header">
        <div>
          <h2 className="dash-title">📋 Notas</h2>
          <p className="dash-sub">
            Tablero · {stats.activas} activas
            {stats.urgentes > 0 && <span style={{ color:'#b91c1c', fontWeight:800 }}> · 🔴 {stats.urgentes} urgentes</span>}
            {stats.resueltas > 0 && <span style={{ color:'#166534' }}> · ✅ {stats.resueltas} resueltas</span>}
          </p>
        </div>
        <div className="dash-header-right">
          <MesSelector value={mes} onChange={setMes} regs={regsAll} aus={ausAll} />
          <button onClick={() => setVerTodosLosMeses(v => !v)}
            style={{ padding:'6px 14px', borderRadius:8, fontSize:13, fontWeight:700, cursor:'pointer',
              background: verTodosLosMeses ? '#334155' : '#f1f5f9',
              color:      verTodosLosMeses ? '#fff'    : '#475569',
              border: '2px solid', borderColor: verTodosLosMeses ? '#334155' : '#e2e8f0' }}>
            {verTodosLosMeses ? '📅 Todos los meses' : '📅 Solo este mes'}
          </button>
          <button className="btn-action btn-primary-action" onClick={() => setModal({ persona:'' })}>
            + Nueva nota
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center' }}>
        <input type="text" className="filter-input" style={{ flex:1, minWidth:200 }}
          placeholder="🔍 Buscar en notas..."
          value={filtroTexto} onChange={e => setFiltroTexto(e.target.value)} />
        <select className="filter-select"
          value={filtroCat} onChange={e => setFiltroCat(e.target.value)}>
          <option value="">Todas las categorías</option>
          {CATEGORIAS.map(c => <option key={c.id} value={c.id}>{c.icon} {c.id}</option>)}
        </select>
        <select className="filter-select" style={{ minWidth:150 }}
          value={filtroPrio} onChange={e => setFiltroPrio(e.target.value)}>
          <option value="">Toda prioridad</option>
          <option value="urgente">🔴 Urgente</option>
          <option value="normal">⚪ Normal</option>
        </select>
        {(filtroCat || filtroPrio || filtroTexto) && (
          <button onClick={() => { setFiltroCat(''); setFiltroPrio(''); setFiltroTexto(''); }}
            style={{ padding:'8px 14px', background:'#f1f5f9', border:'2px solid #e2e8f0',
              borderRadius:8, fontSize:13, fontWeight:700, cursor:'pointer', color:'#475569' }}>
            ✕ Limpiar
          </button>
        )}
      </div>

      {cargando && (
        <div style={{ textAlign:'center', padding:32, color:'#94a3b8', fontSize:14 }}>⏳ Cargando notas...</div>
      )}

      {/* Tablero Kanban */}
      {!cargando && (
        <div style={{ display:'flex', gap:16, overflowX:'auto', paddingBottom:12,
          alignItems:'flex-start', minHeight:300 }}>
          {personas.map(persona => (
            <ColumnaPersona key={persona} persona={persona}
              notas={notasFiltradas.filter(n => n.persona === persona)}
              onEditar={n => setModal({ nota: n, persona: n.persona })}
              onResolver={handleResolver}
              onEliminar={handleEliminar}
              onNueva={p => setModal({ persona: p })}
            />
          ))}
        </div>
      )}

      {modal && (
        <ModalNota
          nota={modal.nota}
          personas={personas}
          mes={mes}
          onGuardar={modal.nota ? handleEditar : handleCrear}
          onCerrar={() => setModal(null)}
        />
      )}
    </div>
  );
};