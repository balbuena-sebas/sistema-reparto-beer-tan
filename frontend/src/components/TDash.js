import React, { useMemo, useState } from 'react';
import { RB } from './RB';
import { fp, fn, diasT, diasH, isT, fd } from '../utils/helpers';
import { calcDiasTrabajados } from './diasTrabajados';

function esTandil(localidad) {
  const loc = String(localidad || '').toUpperCase()
    .replace(/Á/g,'A').replace(/É/g,'E').replace(/Í/g,'I').replace(/Ó/g,'O').replace(/Ú/g,'U');
  return loc.includes('TANDIL') || loc.includes('VELA') || loc.includes('BARKER') ||
         loc.includes('GARDEY') || loc.includes('JUAREZ') || loc.includes('SAN MANUEL') ||
         loc.includes('JUAN N FERNANDEZ');
}

function clasificarMot(motivo) {
  const m = String(motivo || '').toUpperCase()
    .replace(/Á/g,'A').replace(/É/g,'E').replace(/Í/g,'I').replace(/Ó/g,'O').replace(/Ú/g,'U');
  const log = ['CERRADO','ERROR DISTRIBUCION','NO HIZO PEDIDO','NO BAJO PEDIDO','SIN DINERO'];
  const fac = ['ERROR PREVENTA','ERROR ADMIN','DEVOLUCION INTERNA','SIN STOCK'];
  if (log.some(p => m.includes(p))) return 'logistica';
  if (fac.some(p => m.includes(p))) return 'facturacion';
  return 'otro';
}

const WidgetRechazos = ({ rechazos = [], onNavRechazos, bultosTotal = 0 }) => {
  const totalBultos  = rechazos.reduce((s,r) => s + (r.bultosRechazados||0), 0);
  const totalImporte = rechazos.reduce((s,r) => s + (r.importeRechazado||0), 0);
  const logBultos    = rechazos.filter(r => clasificarMot(r.motivoDesc||r.motivo)==='logistica').reduce((s,r) => s+(r.bultosRechazados||0),0);
  const factBultos   = rechazos.filter(r => clasificarMot(r.motivoDesc||r.motivo)==='facturacion').reduce((s,r) => s+(r.bultosRechazados||0),0);
  const base       = bultosTotal > 0 ? bultosTotal : totalBultos;
  const pctLog     = base > 0 ? Math.round((logBultos/base)*100) : 0;
  const pctFact    = base > 0 ? Math.round((factBultos/base)*100) : 0;
  const pctLogDec  = base > 0 ? (logBultos/base*100).toFixed(2).replace('.',',') : '0,00';
  const pctFactDec = base > 0 ? (factBultos/base*100).toFixed(2).replace('.',',') : '0,00';

  const topClientes = useMemo(() => {
    const m = {};
    rechazos.forEach(r => { const k = r.clienteDesc || r.clienteId || '—'; m[k] = (m[k]||0) + (r.bultosRechazados||0); });
    return Object.entries(m).sort((a,b)=>b[1]-a[1]).slice(0,3);
  }, [rechazos]);

  const topChofLog = useMemo(() => {
    const m = {};
    rechazos.filter(r => clasificarMot(r.motivoDesc||r.motivo)==='logistica').forEach(r => {
      const k = r.choferDesc || r.chofer || '—';
      m[k] = (m[k]||0) + (r.bultosRechazados||0);
    });
    return Object.entries(m).sort((a,b)=>b[1]-a[1]).slice(0,3);
  }, [rechazos]);

  if (rechazos.length === 0) return (
    <div className="dash-card">
      <div className="card-header">
        <span className="card-title">❌ Rechazos</span>
        {onNavRechazos && <button onClick={onNavRechazos} style={{ fontSize:12,padding:'4px 12px',background:'#f1f5f9',border:'2px solid #e2e8f0',borderRadius:7,cursor:'pointer',fontWeight:700,color:'#64748b' }}>Ver análisis →</button>}
      </div>
      <div style={{ textAlign:'center',padding:'24px',color:'#94a3b8',fontSize:13,fontWeight:600 }}>Sin datos de rechazos · Importá el Excel de rechazos</div>
    </div>
  );

  const maxCli = topClientes[0]?.[1] || 1;
  const alertaAlta = parseFloat(pctLogDec.replace(',','.')) > 3;

  return (
    <div className="dash-card" style={{ border: alertaAlta ? '2px solid #fca5a5' : undefined }}>
      <div className="card-header">
        <span className="card-title">❌ Rechazos{alertaAlta && <span style={{ marginLeft:8,fontSize:11,padding:'2px 8px',background:'#fee2e2',color:'#b91c1c',borderRadius:6,fontWeight:700 }}>ALERTA LOGÍSTICA</span>}</span>
        {onNavRechazos && <button onClick={onNavRechazos} style={{ fontSize:12,padding:'4px 12px',background:'#f1f5f9',border:'2px solid #e2e8f0',borderRadius:7,cursor:'pointer',fontWeight:700,color:'#475569' }}>Ver análisis completo →</button>}
      </div>
      <div style={{ display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginBottom:14 }}>
        {[
          { icon:'❌', label:'Registros',   value:fn(rechazos.length),         color:'#b91c1c', bg:'#fee2e2' },
          { icon:'📦', label:'Bultos',       value:fn(Math.round(totalBultos)), color:'#b87c00', bg:'#fff7e0' },
          { icon:'💰', label:'Importe',      value:fp(totalImporte),            color:'#5b21b6', bg:'#f5f3ff' },
          { icon:'🚛', label:'% Logístico', value:`${pctLogDec}%`,             color:parseFloat(pctLogDec.replace(',','.'))>3?'#b91c1c':'#166534', bg:parseFloat(pctLogDec.replace(',','.'))>3?'#fee2e2':'#dcfce7' },
        ].map(k=>(
          <div key={k.label} style={{ background:k.bg,borderRadius:10,padding:'10px 12px',textAlign:'center' }}>
            <div style={{ fontSize:18 }}>{k.icon}</div>
            <div style={{ fontSize:16,fontWeight:900,fontFamily:'monospace',color:k.color }}>{k.value}</div>
            <div style={{ fontSize:10,color:'#64748b',fontWeight:700,textTransform:'uppercase',marginTop:2 }}>{k.label}</div>
          </div>
        ))}
      </div>
      <div style={{ marginBottom:14 }}>
        <div style={{ display:'flex',justifyContent:'space-between',fontSize:12,fontWeight:700,marginBottom:5 }}>
          <span style={{ color:'#b91c1c' }}>🚛 Logística {pctLogDec}%</span>
          <span style={{ color:'#b87c00' }}>🧾 Facturación {pctFactDec}%</span>
        </div>
        <div style={{ height:14,borderRadius:7,overflow:'hidden',display:'flex',border:'1px solid #e2e8f0' }}>
          {pctLog>0  && <div style={{ width:`${pctLog}%`, background:'#b91c1c' }}/>}
          {pctFact>0 && <div style={{ width:`${pctFact}%`,background:'#b87c00' }}/>}
          {(100-pctLog-pctFact)>0 && <div style={{ flex:1,background:'#94a3b8' }}/>}
        </div>
      </div>
      <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:14 }}>
        <div>
          <div style={{ fontSize:11,fontWeight:800,color:'#94a3b8',textTransform:'uppercase',marginBottom:8 }}>🏪 Top clientes</div>
          {topClientes.map(([nombre,bultos],i)=>(
            <div key={i} style={{ marginBottom:8 }}>
              <div style={{ display:'flex',justifyContent:'space-between',fontSize:12 }}>
                <span style={{ fontWeight:700,color:'#334155',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',marginRight:4 }}>{nombre}</span>
                <span style={{ fontWeight:900,fontFamily:'monospace',color:'#b91c1c' }}>{fn(Math.round(bultos))}</span>
              </div>
              <div style={{ height:5,background:'#f1f5f9',borderRadius:3,marginTop:3 }}>
                <div style={{ height:'100%',width:`${Math.round((bultos/maxCli)*100)}%`,background:'#b91c1c',borderRadius:3 }}/>
              </div>
            </div>
          ))}
          {topClientes.length===0&&<div style={{ fontSize:12,color:'#94a3b8' }}>Sin datos</div>}
        </div>
        <div>
          <div style={{ fontSize:11,fontWeight:800,color:'#94a3b8',textTransform:'uppercase',marginBottom:8 }}>🚛 Rechazos logísticos por chofer</div>
          {topChofLog.length===0&&<div style={{ fontSize:12,color:'#166534',fontWeight:600 }}>✅ Sin rechazos logísticos</div>}
          {topChofLog.map(([nombre,bultos],i)=>(
            <div key={i} style={{ marginBottom:8 }}>
              <div style={{ display:'flex',justifyContent:'space-between',fontSize:12 }}>
                <span style={{ fontWeight:700,color:'#334155',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',marginRight:4 }}>{nombre}</span>
                <span style={{ fontWeight:900,fontFamily:'monospace',color:'#b91c1c' }}>{fn(Math.round(bultos))}</span>
              </div>
              <div style={{ height:5,background:'#f1f5f9',borderRadius:3,marginTop:3 }}>
                <div style={{ height:'100%',width:`${Math.round((bultos/(topChofLog[0]?.[1]||1))*100)}%`,background:'#b91c1c',borderRadius:3 }}/>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ── WidgetFoxtrot ─────────────────────────────────────────────────────────────
const WidgetFoxtrot = ({ kpis = [], onNavFoxtrot }) => {
  const PCT = (a, b) => b > 0 ? Math.round((a / b) * 100) : 0;
  const fnum = n => Number(n || 0).toLocaleString('es-AR');

  const global = React.useMemo(() => {
    if (!kpis.length) return null;
    const tot = kpis.reduce((acc, k) => ({
      rutas:      acc.rutas      + k.rutas,
      clientes:   acc.clientes   + k.clientesTotal,
      exitosos:   acc.exitosos   + k.exitosos,
      seqAdhered: acc.seqAdhered + k.seqAdhered,
      seqNotAdh:  acc.seqNotAdh  + k.seqNotAdhered,
    }), { rutas: 0, clientes: 0, exitosos: 0, seqAdhered: 0, seqNotAdh: 0 });
    return {
      ...tot,
      choferes:  kpis.length,
      tasaExito: PCT(tot.exitosos, tot.clientes),
      seqPct:    PCT(tot.seqAdhered, tot.seqAdhered + tot.seqNotAdh),
    };
  }, [kpis]);

  const topChoferes = React.useMemo(() =>
    [...kpis].sort((a, b) => b.tasaExito - a.tasaExito).slice(0, 3),
  [kpis]);

  if (!kpis.length) return (
    <div className="dash-card">
      <div className="card-header">
        <span className="card-title">📡 Foxtrot Analytics</span>
        {onNavFoxtrot && (
          <button onClick={onNavFoxtrot}
            style={{ fontSize: 12, padding: '4px 12px', background: '#f1f5f9', border: '2px solid #e2e8f0', borderRadius: 7, cursor: 'pointer', fontWeight: 700, color: '#64748b' }}>
            Importar datos →
          </button>
        )}
      </div>
      <div style={{ textAlign: 'center', padding: '24px', color: '#94a3b8', fontSize: 13, fontWeight: 600 }}>
        Sin datos de Foxtrot · Importá los CSV desde la pestaña 📡 Foxtrot
      </div>
    </div>
  );

  const hayAlerta = global.tasaExito < 80 || global.seqPct < 65;

  return (
    <div className="dash-card" style={{ border: hayAlerta ? '2px solid #fca5a5' : undefined }}>
      <div className="card-header">
        <span className="card-title">
          📡 Foxtrot Analytics
          {hayAlerta && (
            <span style={{ marginLeft: 8, fontSize: 11, padding: '2px 8px', background: '#fee2e2', color: '#b91c1c', borderRadius: 6, fontWeight: 700 }}>
              ALERTA
            </span>
          )}
        </span>
        {onNavFoxtrot && (
          <button onClick={onNavFoxtrot}
            style={{ fontSize: 12, padding: '4px 12px', background: '#f1f5f9', border: '2px solid #e2e8f0', borderRadius: 7, cursor: 'pointer', fontWeight: 700, color: '#475569' }}>
            Ver análisis completo →
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 14 }}>
        {[
          { icon: '🗺', label: 'Rutas',     value: fnum(global.rutas),      color: '#b87c00', bg: '#fff7e0' },
          { icon: '📍', label: 'Visitas',   value: fnum(global.clientes),   color: '#475569', bg: '#f8fafc' },
          { icon: '✅', label: '% Éxito',   value: `${global.tasaExito}%`,
            color: global.tasaExito >= 95 ? '#166534' : global.tasaExito >= 80 ? '#0369a1' : '#b91c1c',
            bg:    global.tasaExito >= 95 ? '#dcfce7' : global.tasaExito >= 80 ? '#e0f2fe' : '#fee2e2' },
          { icon: '📋', label: 'Seq. Adh.', value: `${global.seqPct}%`,
            color: global.seqPct >= 80 ? '#0369a1' : global.seqPct >= 65 ? '#b87c00' : '#b91c1c',
            bg:    global.seqPct >= 80 ? '#e0f2fe' : global.seqPct >= 65 ? '#fff7e0' : '#fee2e2' },
        ].map(k => (
          <div key={k.label} style={{ background: k.bg, borderRadius: 10, padding: '10px 12px', textAlign: 'center' }}>
            <div style={{ fontSize: 18 }}>{k.icon}</div>
            <div style={{ fontSize: 16, fontWeight: 900, fontFamily: 'monospace', color: k.color }}>{k.value}</div>
            <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', marginTop: 2 }}>{k.label}</div>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700, marginBottom: 5 }}>
          <span style={{ color: global.tasaExito >= 80 ? '#166534' : '#b91c1c' }}>✅ Tasa éxito {global.tasaExito}%</span>
          <span style={{ color: global.seqPct >= 65 ? '#0369a1' : '#b87c00' }}>📋 Adherencia seq. {global.seqPct}%</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ height: 10, background: '#f1f5f9', borderRadius: 5, overflow: 'hidden', border: '1px solid #e2e8f0' }}>
            <div style={{ height: '100%', width: `${global.tasaExito}%`, borderRadius: 5, transition: 'width .4s',
              background: global.tasaExito >= 95 ? '#166534' : global.tasaExito >= 80 ? '#0369a1' : '#b91c1c' }} />
          </div>
          <div style={{ height: 10, background: '#f1f5f9', borderRadius: 5, overflow: 'hidden', border: '1px solid #e2e8f0' }}>
            <div style={{ height: '100%', width: `${global.seqPct}%`, borderRadius: 5, transition: 'width .4s',
              background: global.seqPct >= 80 ? '#0369a1' : global.seqPct >= 65 ? '#b87c00' : '#b91c1c' }} />
          </div>
        </div>
      </div>

      <div>
        <div style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 8 }}>
          🚛 Top choferes — tasa de éxito
        </div>
        {topChoferes.map((ch, i) => {
          const nombre = ch.choferMapeado || ch.driverName || `Driver ${ch.driverId}`;
          return (
            <div key={ch.driverId} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                <span style={{ fontWeight: 700, color: '#334155', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>{nombre}</span>
                </span>
                <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontWeight: 900, fontFamily: 'monospace',
                    color: ch.tasaExito >= 95 ? '#166534' : ch.tasaExito >= 80 ? '#0369a1' : '#b91c1c' }}>
                    {ch.tasaExito}%
                  </span>
                  <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600 }}>{ch.rutas} rutas</span>
                </span>
              </div>
              <div style={{ height: 5, background: '#f1f5f9', borderRadius: 3 }}>
                <div style={{ height: '100%', width: `${ch.tasaExito}%`, borderRadius: 3,
                  background: ch.tasaExito >= 95 ? '#166534' : ch.tasaExito >= 80 ? '#0369a1' : '#b91c1c' }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const WidgetChecklist = ({ checklists = [], cfg = {} }) => {
  const hoyStr = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
  const todosLosChoferes = [...new Set([
    ...(cfg.choferes || []),
    ...(cfg.operarios || []),
    ...(cfg.temporada || [])
  ])].sort();

  const completados = checklists.filter(c => c.estado === 'completado').map(c => c.chofer);
  const sinRuta = checklists.filter(c => c.estado === 'sin_ruta').map(c => c.chofer);
  const faltantes = todosLosChoferes.filter(c => !completados.includes(c) && !sinRuta.includes(c));

  return (
    <div className="dash-card">
      <div className="card-header">
        <span className="card-title">📋 Control de Checklist Diario ({hoyStr})</span>
        <span className="card-badge">{completados.length + sinRuta.length} / {todosLosChoferes.length}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#166534', textTransform: 'uppercase', marginBottom: 10 }}>✅ Reportados</div>
          {(completados.length === 0 && sinRuta.length === 0) ? (
            <div style={{ fontSize: 12, color: '#94a3b8' }}>Nadie reportó aún</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {completados.map(c => (
                <div key={c} style={{ fontSize: 13, fontWeight: 700, color: '#166534', background: '#dcfce7', padding: '6px 12px', borderRadius: 8, display: 'flex', justifyContent: 'space-between' }}>
                  <span>✓ {c}</span>
                  <span style={{ fontSize: 10, opacity: 0.8 }}>CHECKLIST OK</span>
                </div>
              ))}
              {sinRuta.map(c => (
                <div key={c} style={{ fontSize: 13, fontWeight: 700, color: '#475569', background: '#f1f5f9', padding: '6px 12px', borderRadius: 8, display: 'flex', justifyContent: 'space-between', border: '1px dashed #cbd5e1' }}>
                  <span>⚪ {c}</span>
                  <span style={{ fontSize: 10, opacity: 0.8 }}>SIN RUTA</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#b91c1c', textTransform: 'uppercase', marginBottom: 10 }}>⏳ Faltantes</div>
          {faltantes.length === 0 ? (
            <div style={{ fontSize: 12, color: '#166534', fontWeight: 700 }}>¡Todos al día! 👏</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {faltantes.map(c => (
                <div key={c} style={{ fontSize: 13, fontWeight: 700, color: '#b91c1c', background: '#fee2e2', padding: '6px 12px', borderRadius: 8 }}>
                  ⚠ {c}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const RepCard = ({ r, onClose, onEdit, onDel, loggedInUser }) => {
  if (!r) return null;

  // Calcular datos del resumen
  const destinos = r.destinos || [];
  const totalBultos = destinos.reduce((s, d) => s + (+d.bultos || 0), 0);
  const bultosClark = destinos.filter(d => d.clark).reduce((s, d) => s + (+d.bultos || 0), 0);
  const bultosRecarga = totalBultos - bultosClark;
  const totalCosto = destinos.reduce((s, d) => s + (+d.costo || 0), 0);
  const teamSize = [r.chofer, r.ay1, r.ay2].filter(Boolean).length;
  const fte = `${teamSize} pers.`;
  const teamDesc = `1 chofer${r.ay1 ? ', 1 ay.' : ''}${r.ay2 ? ', 1 ay.' : ''}`;

  // Calcular recargas por destino
  const recargasDestino = destinos.map(d => {
    const cant = d.bultos ? Math.ceil(d.bultos / 24) : 0;
    return { destino: d.destino, bultos: d.bultos, recCant: cant };
  }).filter(d => d.bultos > 0);

  return (
    <div
      className="rep-card-overlay"
      onClick={e => e.target === e.currentTarget && onClose()}
      style={{ zIndex: 1000 }}
    >
      <div className="rep-card" style={{ maxHeight: '90vh', overflowY: 'auto' }}>
        {/* Header con botón X funcional y centrado */}
        <div
          className="rep-card-top"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            padding: '16px 20px',
            background: 'var(--bg2)',
            borderBottom: '2px solid var(--border)',
            position: 'sticky',
            top: 0,
            zIndex: 10,
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
              📅 {fd(r.fecha)}
            </div>
            <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--text)', marginBottom: 4 }}>
              🚛 {r.chofer || '—'}
            </div>
            <div style={{ fontSize: 14, color: 'var(--text2)', fontWeight: 600 }}>
              📍 {r.localidad} · {r.destino}
            </div>
          </div>
          <button
            onClick={onClose}
            onMouseDown={e => e.preventDefault()}
            style={{
              background: '#fee2e2',
              border: '2px solid #fca5a5',
              color: '#b91c1c',
              borderRadius: '8px',
              width: '40px',
              height: '40px',
              fontSize: '24px',
              fontWeight: 900,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              transition: 'all 0.2s',
            }}
            onMouseOver={e => (e.target.style.background = '#f87171')}
            onMouseOut={e => (e.target.style.background = '#fee2e2')}
          >
            ×
          </button>
        </div>

        {/* Contenido principal */}
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Datos generales - Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
            <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 6 }}>Patente</div>
              <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--accent)' }}>{r.patente || '—'}</div>
            </div>
            <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 6 }}>Localidad</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text2)' }}>{esTandil(r.localidad) ? 'Tandil' : 'Las Flores'}</div>
            </div>
            <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 6 }}>Equipo</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text2)' }}>{fte}</div>
            </div>
            <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 6 }}>Recargas</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: r.recSN === 'SI' ? 'var(--red)' : 'var(--green)' }}>{r.recSN || 'NO'}</div>
            </div>
          </div>

          {/* Ayudantes */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 8 }}>👥 Equipo</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div style={{ background: '#e8f3ff', border: '1.5px solid #60a5fa', borderRadius: 8, padding: 10 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#0369a1', textTransform: 'uppercase' }}>Ayudante 1</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#005fa3', marginTop: 4 }}>{r.ay1 || '—'}</div>
              </div>
              <div style={{ background: '#fef3c7', border: '1.5px solid #f59e0b', borderRadius: 8, padding: 10 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#92400e', textTransform: 'uppercase' }}>Ayudante 2</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#78350f', marginTop: 4 }}>{r.ay2 || '—'}</div>
              </div>
            </div>
          </div>

          {/* Destinos - Tabla */}
          {destinos.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 10 }}>
                📍 Destinos · {destinos.length}
              </div>
              <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid var(--border)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: 'var(--bg3)', borderBottom: '2px solid var(--border)' }}>
                      <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 800, color: 'var(--text2)' }}>#</th>
                      <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 800, color: 'var(--text2)' }}>Destino</th>
                      <th style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 800, color: 'var(--text2)' }}>Bultos</th>
                      <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 800, color: 'var(--text2)' }}>Importe de Facturación</th>
                      <th style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 800, color: 'var(--text2)' }}>Clark</th>
                    </tr>
                  </thead>
                  <tbody>
                    {destinos.map((d, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'var(--bg3)' }}>
                        <td style={{ padding: '10px 12px', fontWeight: 700, color: 'var(--text2)' }}>{i + 1}</td>
                        <td style={{ padding: '10px 12px', color: 'var(--text)', fontWeight: 600, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {d.destino || '—'}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 700, color: 'var(--accent)' }}>
                          {fn(d.bultos || 0)}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: 'var(--text2)' }}>
                          {fp(d.costo || 0)}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                          {d.clark ? (
                            <span style={{ fontSize: 18, color: 'var(--green)' }}>✅</span>
                          ) : (
                            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)' }}>—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, marginTop: 8 }}>
                💡 Clark: los bultos se cuentan en el total pero no generan recarga
              </div>
            </div>
          )}

          {/* Resumen del reparto */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 10 }}>📊 Resumen del Reparto</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, maxWidth: 1400, margin: '0 auto' }}>
              <div className="rep-summary-card blue">
                <div style={{ fontSize: 40, fontWeight: 900, color: '#005fa3', fontFamily: 'monospace' }}>{teamSize}</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#0369a1', textTransform: 'uppercase', marginTop: 8 }}>Personas</div>
                <div style={{ fontSize: 10, color: '#0369a1', marginTop: 2 }}>{teamDesc}</div>
              </div>

              <div className="rep-summary-card yellow">
                <div style={{ fontSize: 40, fontWeight: 900, color: '#b87c00', fontFamily: 'monospace' }}>{fn(totalBultos)}</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#92400e', textTransform: 'uppercase', marginTop: 8 }}>Total Bultos</div>
                <div style={{ fontSize: 10, color: '#92400e', marginTop: 2 }}>
                  {fn(bultosClark)} Clark · {fn(bultosRecarga)} sin Clark
                </div>
              </div>

              <div className="rep-summary-card purple">
                <div style={{ fontSize: 40, fontWeight: 900, color: '#5b21b6', fontFamily: 'monospace' }}>
                  {r.costoReparto ? fp(totalCosto) : '—'}
                </div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#6b21a8', textTransform: 'uppercase', marginTop: 8 }}>Importe de Facturación</div>
                <div style={{ fontSize: 10, color: '#6b21a8', marginTop: 2 }}>{r.nRecargas || 0} destino(s)</div>
              </div>

              <div className="rep-summary-card green">
                <div style={{ fontSize: 40, fontWeight: 900, color: '#15803d', fontFamily: 'monospace' }}>{r.nRecargas ?? '—'}</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#166534', textTransform: 'uppercase', marginTop: 8 }}>Recargas</div>
                <div style={{ fontSize: 10, color: '#166534', marginTop: 2 }}>
                  {r.nRecargas > 0 ? 'Sí' : 'Sin recarga'}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer - Botones de acción */}
        <div
          className="rep-card-footer"
          style={{
            borderTop: '2px solid var(--border)',
            padding: '16px 20px',
            display: 'flex',
            gap: 10,
            justifyContent: 'flex-end',
            background: 'var(--bg2)',
            position: 'sticky',
            bottom: 0,
            zIndex: 10,
            flexWrap: 'wrap',
          }}
        >
          {loggedInUser?.permisos?.editar_contenido === true && onDel && (
            <button
              className="btn-action btn-ghost"
              onClick={() => {
                if (window.confirm('¿Eliminar este registro?')) {
                  onDel(r.id);
                  onClose();
                }
              }}
              style={{ color: 'var(--red)', borderColor: '#f87171' }}
            >
              🗑 Eliminar
            </button>
          )}
          {loggedInUser?.permisos?.editar_contenido === true && onEdit && (
            <button
              className="btn-action btn-secondary-action"
              onClick={() => {
                onEdit(r);
                onClose();
              }}
            >
              ✏ Editar
            </button>
          )}
          <button className="btn-action btn-primary-action" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};

// ── FIRMA ACTUALIZADA: acepta foxtrotKpis y onNavFoxtrot ─────────────────────
export const TDash = ({ K, rM, aM, cfg, mes, setMes, alertas, onR, onA, onEdit, onDel, onNav, rechazos=[], onNavRechazos, regsAll=[], foxtrotKpis=[], onNavFoxtrot, loggedInUser, checklistsHoy = [] }) => {
  const [selected, setSelected] = useState(null);
  const dt = diasT(mes, cfg.diasNoTrabajados || []);

  // Determinar si el mes seleccionado es el mes actual
  const hoy = new Date();
  const mesActual = `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}`;
  const esEstesMes = mes === mesActual;

  const mesesDisponibles = useMemo(() => {
    const conDatos = new Set([
      ...regsAll.map(r=>(r.fecha||'').slice(0,7)),
      ...rechazos.map(r=>(r.fecha||'').slice(0,7)),
    ].filter(m=>m.length===7));
    conDatos.add(mesActual);
    const NOMBRES=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    return [...conDatos].sort((a,b)=>b.localeCompare(a)).slice(0,18).map(v=>{
      const [y,m]=v.split('-');
      return { value:v, label:`${NOMBRES[+m-1]} ${y}` };
    });
  }, [regsAll, rechazos, mesActual]);

  const diasTrabajadosMes = useMemo(() => {
    if (!mes) return dt;
    const [y,m]=mes.split('-').map(Number);
    const desde=`${y}-${String(m).padStart(2,'0')}-01`;
    const ultimo=new Date(y,m,0).getDate();
    const hasta=`${y}-${String(m).padStart(2,'0')}-${String(ultimo).padStart(2,'0')}`;
    const extras=(cfg.diasNoTrabajados||[]).map(d=>d.fecha);
    return calcDiasTrabajados(desde,hasta,extras);
  }, [mes, cfg.diasNoTrabajados, dt]);

  const rechazosDelMes = useMemo(() => {
    if (!mes) return rechazos;
    return rechazos.filter(r=>(r.fecha||'').startsWith(mes));
  }, [rechazos, mes]);

  const bultosEntregadosMes = useMemo(() => {
    const bxM = cfg.bultosXMes || {};
    const dm  = cfg.driverMap  || [];

    if (!mes) return null;

    const datosMes = bxM[mes];
    if (!datosMes) return null;

    if (dm.length > 0 && datosMes.porChofer && Object.keys(datosMes.porChofer).length > 0) {
      const ids = new Set(dm.map(d => String(d.id||'').trim()).filter(Boolean));
      let suma = 0;
      ids.forEach(id => { suma += datosMes.porChofer[id] || 0; });
      if (suma > 0) return Math.round(suma);
    }

    if (datosMes.total > 0) return Math.round(datosMes.total);

    return null;
  }, [mes, cfg.bultosXMes, cfg.driverMap]);

  const statCards = [
    { label:"Repartos del Mes",  value:fn(rM.length),  sub:`${diasTrabajadosMes} días trabajados`,                         icon:"🚛", color:"#b87c00", bg:"#fff7e0", nav:"registros" },
    { label:"Bultos Totales",    value:fn(K.bultos),   sub:`Prom. ${rM.length?fn(Math.round(K.bultos/rM.length)):0} por reparto`, icon:"📦", color:"#005fa3", bg:"#e8f3ff", nav:"reportes" },
    { label:"Recargas del Mes",  value:fn(K.recargas), sub:`${K.recSI} repartos con recarga`,                               icon:"⚡", color:"#b91c1c", bg:"#fff1f1", nav:"registros" },
    { label:"Ausencias",         value:fn(aM.length),  sub:`${[...new Set(aM.map(a=>a.persona))].length} personas afectadas`, icon:"📋", color:"#5b21b6", bg:"#f5f0ff", nav:"ausencias" },
  ];

  const kpiExtra = [
    {
      icon:'📅', label:'Días trabajados', value:diasTrabajadosMes??dt,
      sub:'Lun-Sáb · descontando feriados', color:'#0369a1', bg:'#e0f2fe', border:'#7dd3fc',
    },
    ...(bultosEntregadosMes !== null ? [{
      icon:'🚚', label:'Bultos entregados', value:fn(Math.round(bultosEntregadosMes)),
      sub:`${mes ? new Date(mes+'-02').toLocaleString('es-AR',{month:'long',year:'numeric'}) : 'Mes'} · Excel importado`,
      color:'#166534', bg:'#dcfce7', border:'#86efac',
    }] : []),
  ];

  const tandilBultos = rM.filter(r=>esTandil(r.localidad)).reduce((s,r)=>s+(+r.bultos||0),0);
  const floresBultos = rM.filter(r=>!esTandil(r.localidad)).reduce((s,r)=>s+(+r.bultos||0),0);
  
  // Obtener objetivos: específicos del mes, o globales solo para el mes actual
  const objTandilMes = cfg.paramXMes?.[mes]?.objTandil ?? (esEstesMes ? cfg.objTandil : 0);
  const objFloresMes = cfg.paramXMes?.[mes]?.objFlores ?? (esEstesMes ? cfg.objFlores : 0);
  
  // Calcular porcentajes si hay objetivos definidos
  const tandilPct = objTandilMes ? Math.min(100,Math.round((tandilBultos/objTandilMes)*100)) : 0;
  const floresPct = objFloresMes ? Math.min(100,Math.round((floresBultos/objFloresMes)*100)) : 0;

  const topChoferes = useMemo(() => {
    const map={};
    rM.forEach(r=>{ if(r.chofer) map[r.chofer]=(map[r.chofer]||0)+(+r.bultos||0); });
    return Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,5);
  }, [rM]);
  const maxBultos=topChoferes[0]?.[1]||1;

  const ultimos=[...rM].sort((a,b)=>(b.fecha||'').localeCompare(a.fecha||'')).slice(0,8);

  const rechazosXDestino = useMemo(() => {
    const m = {};
    rechazosDelMes.forEach(r => {
      const k = String(r.clienteDesc||'').toUpperCase().trim();
      if (k) m[k] = (m[k]||0) + (r.bultosRechazados||0);
    });
    return m;
  }, [rechazosDelMes]);

  return (
    <div className="dash-container">
      <div className="dash-header">
        <div>
          <h2 className="dash-title">Panel Operativo</h2>
          <p className="dash-sub">
            Resumen del mes en curso
            {loggedInUser && loggedInUser.role !== 'admin' && (
              <span style={{ marginLeft: 16, fontSize: 12, fontWeight: 700, color: '#64748b' }}>
                👤 {loggedInUser.nombre}
              </span>
            )}
          </p>
        </div>
        <div className="dash-header-right">
          <select value={mes} onChange={e=>setMes(e.target.value)}
            style={{ padding:'6px 12px',borderRadius:8,border:'1.5px solid #e5b84b',fontWeight:600,fontSize:14,background:'#fff',cursor:'pointer' }}>
            {mesesDisponibles.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {(!loggedInUser || loggedInUser.role === 'admin') && (
            <>
              <button className="btn-action btn-primary-action" onClick={onR}>+ Nuevo Reparto</button>
              <button className="btn-action btn-secondary-action" onClick={onA}>+ Ausencia</button>
            </>
          )}
        </div>
      </div>

      {alertas.length>0&&(
        <div className="alertas-bar">
          <span className="alerta-icon">⚠</span>
          <span className="alerta-text">{alertas[0]}</span>
          {alertas.length>1&&<span className="alerta-more">+{alertas.length-1} más</span>}
        </div>
      )}

      <div className="stats-grid">
        {statCards.map((c,i)=>(
          <div key={i} className="stat-card" style={{ background:c.bg,borderColor:c.color+'55',cursor:onNav?'pointer':'default',transition:'transform .12s, box-shadow .12s' }}
            onClick={()=>onNav&&onNav(c.nav)}
            onMouseEnter={e=>{if(onNav){e.currentTarget.style.transform='translateY(-3px)';e.currentTarget.style.boxShadow='0 8px 24px rgba(0,0,0,0.13)';}}}
            onMouseLeave={e=>{e.currentTarget.style.transform='';e.currentTarget.style.boxShadow='';}}
            title={onNav?`Ver ${c.label} →`:''}>
            <div className="stat-icon">{c.icon}</div>
            <div>
              <div className="stat-value" style={{ color:c.color }}>{c.value}</div>
              <div className="stat-label" style={{ color:c.color }}>{c.label}</div>
              <div className="stat-sub">{c.sub}</div>
            </div>
            {onNav&&<div style={{ position:'absolute',top:10,right:12,fontSize:16,opacity:0.35 }}>→</div>}
          </div>
        ))}
      </div>

      {kpiExtra.length>0&&(
        <div style={{ display:'grid',gridTemplateColumns:`repeat(${kpiExtra.length},1fr)`,gap:12,marginBottom:16 }}>
          {kpiExtra.map((k,i)=>(
            <div key={i} style={{ background:k.bg,border:`2px solid ${k.border}`,borderRadius:14,padding:'14px 16px',textAlign:'center' }}>
              <div style={{ fontSize:24,marginBottom:4 }}>{k.icon}</div>
              <div style={{ fontSize:22,fontWeight:900,fontFamily:'monospace',color:k.color }}>{k.value}</div>
              <div style={{ fontSize:12,fontWeight:700,color:k.color,marginTop:2 }}>{k.sub}</div>
              <div style={{ fontSize:11,color:'#64748b',fontWeight:700,textTransform:'uppercase',marginTop:3 }}>{k.label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="dash-grid-2">
        {objTandilMes > 0 || objFloresMes > 0 ? (
          <div className="dash-card">
            <div className="card-header">
              <span className="card-title">Objetivos de Bultos</span>
              <span className="card-badge">{esEstesMes ? `${dt}/${diasTrabajadosMes} días hábiles` : 'Mes configurado'}</span>
            </div>
            <div className="obj-list">
              {[
                { label:'🗺 Tandil',     pct:tandilPct, actual:tandilBultos, obj:objTandilMes, color:tandilPct>=100?'#166534':'#b87c00' },
                { label:'🗺 Las Flores', pct:floresPct, actual:floresBultos, obj:objFloresMes, color:floresPct>=100?'#166534':'#005fa3' },
              ].map(o=>(
                <div key={o.label}>
                  <div className="obj-header"><span className="obj-name">{o.label}</span><span className="obj-pct" style={{ color:o.color }}>{o.pct}%</span></div>
                  <div className="obj-bar-bg"><div className="obj-bar-fill" style={{ width:`${o.pct}%`,background:o.color }}/></div>
                  <div className="obj-detail">{fn(o.actual)} / {fn(o.obj)} bultos objetivo</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="dash-card">
            <div className="card-header">
              <span className="card-title">Objetivos de Bultos</span>
              <span className="card-badge">Mes actual</span>
            </div>
            <div style={{ padding:'20px', textAlign:'center', color:'#94a3b8', fontSize:13, fontWeight:600 }}>
              📋 No hay objetivos configurados para este mes. Configurá objetivos en la pestaña ⚙ Configuración.
            </div>
          </div>
        )}

        <div className="dash-card">
          <div className="card-header"><span className="card-title">Top Choferes por Bultos</span></div>
          <div className="top-list">
            {topChoferes.length===0&&<div className="empty-state">Sin datos este mes</div>}
            {topChoferes.map(([name,bultos],i)=>(
              <div key={name} className="top-item">
                <span className="top-rank">{i===0?'🥇':i===1?'🥈':i===2?'🥉':`#${i+1}`}</span>
                <span className="top-name">{name}</span>
                <div className="top-bar-wrap"><div className="top-bar" style={{ width:`${Math.round((bultos/maxBultos)*100)}%` }}/></div>
                <span className="top-val">{fn(bultos)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <WidgetRechazos rechazos={rechazosDelMes} bultosTotal={bultosEntregadosMes||0} onNavRechazos={onNavRechazos}/>
      
      {String(loggedInUser?.role || '').toLowerCase() === 'admin' && (
        <WidgetChecklist checklists={checklistsHoy} cfg={cfg} />
      )}

      <WidgetFoxtrot kpis={foxtrotKpis} onNavFoxtrot={onNavFoxtrot} />

      <div className="dash-card">
        <div className="card-header">
          <span className="card-title">Últimos Repartos</span>
          <span className="card-badge">👆 Hacé click en una fila para ver el detalle completo</span>
        </div>
        <div className="table-wrap">
          <table className="dash-table">
            <thead>
              <tr>
                <th>Fecha</th><th>Chofer</th><th>Localidad</th><th>Destino</th>
                <th>Btos. entregados</th><th>Btos. rechazados</th><th>Recarga</th>
              </tr>
            </thead>
            <tbody>
              {ultimos.map(r => {
                const rechDest = rechazosXDestino[String(r.destino||'').toUpperCase().trim()] || 0;
                return (
                  <tr key={r.id} onClick={()=>setSelected(r)} style={{ cursor:'pointer' }}>
                    <td>{fd(r.fecha)}</td>
                    <td><strong>{r.chofer}</strong></td>
                    <td><span className="loc-badge">{r.localidad?.split(' (')[0]}</span></td>
                    <td>{r.destino}</td>
                    <td><strong style={{ color:'var(--accent)',fontSize:15 }}>{fn(r.bultos)}</strong></td>
                    <td>
                      {rechDest > 0
                        ? <strong style={{ color:'#b91c1c',fontSize:14 }}>{fn(Math.round(rechDest))}</strong>
                        : <span style={{ color:'#94a3b8',fontSize:13 }}>—</span>
                      }
                    </td>
                    <td><RB r={r.recCant}/></td>
                  </tr>
                );
              })}
              {rM.length===0&&<tr><td colSpan={7} className="empty-state">No hay registros este mes</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {selected&&<RepCard r={selected} onClose={()=>setSelected(null)} onEdit={onEdit} onDel={onDel} loggedInUser={loggedInUser}/>}
    </div>
  );
};