// src/components/TRechazos.js — Análisis completo de rechazos
// Cards clickeables · Separación logística/facturación · Filtros dinámicos · Editar/Eliminar

import React, { useState, useMemo, useCallback } from 'react';
import { fn, fp } from '../utils/helpers';
import { calcDiasTrabajados } from './diasTrabajados';
import { DC } from '../constants';

export function clasificarMotivo(motivo) {
  const m = String(motivo || '').toUpperCase()
    .replace(/Á/g,'A').replace(/É/g,'E').replace(/Í/g,'I')
    .replace(/Ó/g,'O').replace(/Ú/g,'U').replace(/Ü/g,'U')
    .trim();

  // ── LOGÍSTICA — confirmados por el usuario ────────────────────────────────
  const logistica = [
    'CERRADO',
    'ERROR DISTRIBUCION',
    'NO HIZO PEDIDO',
    'NO BAJO PEDIDO',
    'SIN DINERO',
  ];

  // ── FACTURACIÓN — confirmados por el usuario ──────────────────────────────
  const facturacion = [
    'ERROR PREVENTA',
    'ERROR ADMIN',
    'DEVOLUCION INTERNA',
    'SIN STOCK',
  ];

  // Todo lo demás → 'otro' (comercial/ventas, se muestra como solapa separada)
  if (logistica.some(p => m === p || m.includes(p))) return 'logistica';
  if (facturacion.some(p => m === p || m.includes(p))) return 'facturacion';
  return 'otro';
}

// FIX ESLint: ARTS_EXCLUIDOS fuera del componente para no ser dependencia de useMemo
const ARTS_EXCLUIDOS = new Set(['2776', '2705', '2731']);

const TC = {
  logistica:   { bg:'#fee2e2', color:'#b91c1c', border:'#fca5a5', label:'🚛 Logística',    desc:'Responsabilidad del área de distribución' },
  facturacion: { bg:'#fff7e0', color:'#b87c00', border:'#fcd34d', label:'🧾 Facturación',  desc:'Responsabilidad del área comercial/admin' },
  otro:        { bg:'#f1f5f9', color:'#475569', border:'#cbd5e1', label:'❓ Sin clasificar', desc:'Revisar manualmente' },
};

const pct    = (a,b) => b > 0 ? Math.round((a/b)*100) : 0;
const pctDec = (a,b,dec=2) => b > 0 ? (a/b*100).toFixed(dec).replace('.',',') : '0,00';

const Badge = ({ tipo }) => {
  const c = TC[tipo] || TC.otro;
  return <span style={{ fontSize:11, padding:'2px 9px', borderRadius:8, background:c.bg, color:c.color, border:`1px solid ${c.border}`, fontWeight:700, whiteSpace:'nowrap' }}>{c.label}</span>;
};

const BarraH = ({ valor, max, color='#b91c1c' }) => (
  <div style={{ height:7, background:'#f1f5f9', borderRadius:4, overflow:'hidden', marginTop:5 }}>
    <div style={{ height:'100%', width:`${pct(valor,max)}%`, background:color, borderRadius:4, transition:'width .3s' }} />
  </div>
);

const Kpi = ({ icon, label, value, sub, color, bg, border }) => (
  <div style={{ background:bg||'#f8fafc', border:`2px solid ${border||'#e2e8f0'}`, borderRadius:14, padding:'14px 16px', textAlign:'center' }}>
    <div style={{ fontSize:24, marginBottom:4 }}>{icon}</div>
    <div style={{ fontSize:20, fontWeight:900, fontFamily:'monospace', color:color||'#334155' }}>{value}</div>
    {sub && <div style={{ fontSize:12, fontWeight:700, color:color||'#64748b', marginTop:2 }}>{sub}</div>}
    <div style={{ fontSize:11, color:'#64748b', fontWeight:700, textTransform:'uppercase', marginTop:3, lineHeight:1.3 }}>{label}</div>
  </div>
);

const Modal = ({ onCerrar, children, maxWidth=700 }) => (
  <div onClick={e => e.target===e.currentTarget && onCerrar()}
    style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.5)', zIndex:1000,
      display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
    <div style={{ background:'#fff', borderRadius:20, maxWidth, width:'100%',
      maxHeight:'92vh', overflowY:'auto', boxShadow:'0 32px 80px rgba(0,0,0,.3)' }}>
      {children}
    </div>
  </div>
);

const MHead = ({ titulo, subtitulo, onCerrar, color='#b91c1c' }) => (
  <div style={{ background:`linear-gradient(135deg, ${color} 0%, ${color}dd 100%)`,
    padding:'20px 24px', color:'#fff', position:'sticky', top:0, zIndex:2,
    display:'flex', justifyContent:'space-between', alignItems:'flex-start', borderRadius:'20px 20px 0 0' }}>
    <div>
      <div style={{ fontSize:19, fontWeight:900, marginBottom:2 }}>{titulo}</div>
      {subtitulo && <div style={{ fontSize:12, opacity:.85, fontWeight:600 }}>{subtitulo}</div>}
    </div>
    <button onClick={onCerrar} style={{ background:'rgba(255,255,255,.2)', border:'none',
      color:'#fff', borderRadius:8, width:32, height:32, fontSize:18, cursor:'pointer', fontWeight:900, flexShrink:0 }}>×</button>
  </div>
);

const Sec = ({ children }) => (
  <div style={{ fontSize:11, fontWeight:800, color:'#94a3b8', textTransform:'uppercase',
    letterSpacing:'.07em', padding:'14px 24px 6px', borderTop:'1px solid #f1f5f9' }}>
    {children}
  </div>
);

const BarraLF = ({ log, fact, otro, total }) => {
  const pLog  = pct(log,total);
  const pFact = pct(fact,total);
  const pOtro = pct(otro,total);
  return (
    <div>
      <div style={{ height:22, borderRadius:10, overflow:'hidden', display:'flex', border:'1px solid #e2e8f0', marginBottom:6 }}>
        {pLog  > 0 && <div style={{ width:`${pLog}%`,  background:'#b91c1c', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, color:'#fff', fontWeight:800 }}>{pLog>8?`${pLog}%`:''}</div>}
        {pFact > 0 && <div style={{ width:`${pFact}%`, background:'#b87c00', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, color:'#fff', fontWeight:800 }}>{pFact>8?`${pFact}%`:''}</div>}
        {pOtro > 0 && <div style={{ flex:1,            background:'#94a3b8', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, color:'#fff', fontWeight:800 }}>{pOtro>8?`${pOtro}%`:''}</div>}
      </div>
      <div style={{ display:'flex', gap:14, fontSize:12, fontWeight:700, flexWrap:'wrap' }}>
        {log  > 0 && <span style={{ color:'#b91c1c' }}>🚛 Logística: {fn(Math.round(log))} btos.</span>}
        {fact > 0 && <span style={{ color:'#b87c00' }}>🧾 Facturación: {fn(Math.round(fact))} btos.</span>}
        {otro > 0 && <span style={{ color:'#64748b' }}>❓ Otros: {fn(Math.round(otro))} btos.</span>}
      </div>
    </div>
  );
};

// ══ CARD CLIENTE ══════════════════════════════════════════════════════════════
const CardCliente = ({ item, ranking, onCerrar, regsAll = [] }) => {
  const rows = item.rows;

  // Bultos solicitados/rechazados/entregados por cliente
  const { bultosSolicitadosCliente, bultosRechazadosCliente, bultosEntregadosCliente } = useMemo(() => {
    const solicitados = rows.reduce((s, r) => s + (Number(r.bultos) || 0), 0);
    const rechazados = rows.reduce((s, r) => s + (Number(r.bultosRechazados) || 0), 0);
    const entregados = Math.max(0, solicitados - rechazados);
    return {
      bultosSolicitadosCliente: Math.round(solicitados),
      bultosRechazadosCliente: Math.round(rechazados),
      bultosEntregadosCliente: Math.round(entregados),
    };
  }, [rows]);

  const articulos = useMemo(()=>{ const m={}; rows.forEach(r=>{ const k=r.articuloDesc||r.articulo||'—'; if(!m[k]) m[k]={nombre:k,bultos:0,importe:0,n:0}; m[k].bultos+=r.bultosRechazados; m[k].importe+=r.importeRechazado; m[k].n++; }); return Object.values(m).sort((a,b)=>b.bultos-a.bultos).slice(0,8); },[rows]);
  const choferes  = useMemo(()=>{ const m={}; rows.forEach(r=>{ const k=r.choferDesc||r.chofer||'—'; const t=clasificarMotivo(r.motivoDesc||r.motivo); if(!m[k]) m[k]={nombre:k,bultos:0,log:0,fact:0,n:0}; m[k].bultos+=r.bultosRechazados; m[k].n++; if(t==='logistica') m[k].log+=r.bultosRechazados; if(t==='facturacion') m[k].fact+=r.bultosRechazados; }); return Object.values(m).sort((a,b)=>b.bultos-a.bultos); },[rows]);
  const historial = useMemo(()=>{ const m={}; rows.forEach(r=>{ const k=r.fecha||'—'; if(!m[k]) m[k]={fecha:k,bultos:0,importe:0,n:0}; m[k].bultos+=r.bultosRechazados; m[k].importe+=r.importeRechazado; m[k].n++; }); return Object.values(m).sort((a,b)=>(b.fecha||'').localeCompare(a.fecha||'')).slice(0,12); },[rows]);
  const porTipo   = useMemo(()=>{ const t={logistica:0,facturacion:0,otro:0}; rows.forEach(r=>{ t[clasificarMotivo(r.motivoDesc||r.motivo)]++; }); return t; },[rows]);
  const logB  = rows.filter(r=>clasificarMotivo(r.motivoDesc||r.motivo)==='logistica').reduce((s,r)=>s+r.bultosRechazados,0);
  const factB = rows.filter(r=>clasificarMotivo(r.motivoDesc||r.motivo)==='facturacion').reduce((s,r)=>s+r.bultosRechazados,0);
  const otroB = item.bultos - logB - factB;
  const maxArt = articulos[0]?.bultos||1;
  const nivelAlerta = ranking<=3?'critico':ranking<=10?'atencion':'normal';

  return (
    <Modal onCerrar={onCerrar}>
      <MHead titulo={`🏪 ${item.nombre}`} subtitulo={`${rows[0]?.domicilio||'—'} · Ranking #${ranking}`} onCerrar={onCerrar} color="#b91c1c" />
      {nivelAlerta!=='normal' && (
        <div style={{ margin:'12px 24px 0', padding:'10px 16px', borderRadius:10, background:nivelAlerta==='critico'?'#fee2e2':'#fff7e0', border:`2px solid ${nivelAlerta==='critico'?'#fca5a5':'#fcd34d'}`, fontSize:13, fontWeight:700, color:nivelAlerta==='critico'?'#b91c1c':'#b87c00' }}>
          {nivelAlerta==='critico'?'🔴 CLIENTE CRÍTICO — Está entre los 3 con más rechazos del sistema':'⚠ Cliente con nivel de rechazo alto'}
        </div>
      )}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:10, margin:'16px 24px' }}>
        <Kpi icon="📥" label="Bultos solicitados" value={fn(Math.round(bultosSolicitadosCliente))} color="#0f766e" bg="#d1fae5" border="#6ee7b7" />
        <Kpi icon="🚚" label="Bultos entregados" value={fn(Math.round(bultosEntregadosCliente))} color="#166534" bg="#dcfce7" border="#86efac" />
        <Kpi icon="📦" label="Bultos rechazados" value={fn(Math.round(bultosRechazadosCliente))} color="#b91c1c" bg="#fee2e2" border="#fca5a5" />
        <Kpi icon="💰" label="Importe rechazado" value={fp(item.importe)} color="#5b21b6" bg="#f5f3ff" border="#c4b5fd" />
        <Kpi icon="📋" label="Registros" value={item.n} color="#0369a1" bg="#e0f2fe" border="#7dd3fc" />
      </div>
      {/* Barra visual Entregados vs Rechazados */}
      {bultosEntregadosCliente > 0 && (
        <div style={{ margin:'0 24px 12px', background:'#f8fafc', border:'2px solid #e2e8f0', borderRadius:12, padding:'14px 18px' }}>
          <div style={{ fontSize:11, fontWeight:800, color:'#64748b', textTransform:'uppercase', marginBottom:10 }}>Entregados vs Rechazados</div>
          <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:8 }}>
            <span style={{ fontSize:12, fontWeight:700, color:'#166534', width:160, flexShrink:0 }}>🚚 Entregados</span>
            <div style={{ flex:1, height:18, background:'#dcfce7', borderRadius:6 }}><div style={{ height:'100%', width:'100%', background:'#166534', borderRadius:6 }}/></div>
            <span style={{ fontSize:12, fontWeight:900, fontFamily:'monospace', color:'#166534', width:70, textAlign:'right', flexShrink:0 }}>{fn(Math.round(bultosEntregadosCliente))}</span>
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <span style={{ fontSize:12, fontWeight:700, color:'#b91c1c', width:160, flexShrink:0 }}>❌ Rechazados</span>
            <div style={{ flex:1, height:18, background:'#fee2e2', borderRadius:6, overflow:'hidden' }}><div style={{ height:'100%', width:`${Math.min(100,pct(item.bultos,bultosEntregadosCliente))}%`, background:'#b91c1c', borderRadius:6 }}/></div>
            <span style={{ fontSize:12, fontWeight:900, fontFamily:'monospace', color:'#b91c1c', width:70, textAlign:'right', flexShrink:0 }}>{fn(Math.round(item.bultos))} ({pct(item.bultos,bultosEntregadosCliente)}%)</span>
          </div>
        </div>
      )}
      <Sec>Tipo de rechazo — separación por responsabilidad</Sec>
      <div style={{ padding:'10px 24px' }}>
        <BarraLF log={logB} fact={factB} otro={otroB} total={item.bultos} />
        <div style={{ display:'flex', gap:10, marginTop:10, flexWrap:'wrap' }}>
          {['logistica','facturacion','otro'].map(t => porTipo[t]>0 && <div key={t} style={{ display:'flex', alignItems:'center', gap:6 }}><Badge tipo={t} /><span style={{ fontSize:13, fontWeight:700 }}>{porTipo[t]} reg.</span></div>)}
        </div>
      </div>
      <Sec>Choferes que entregaron con rechazos</Sec>
      <div style={{ padding:'8px 24px', display:'flex', flexDirection:'column', gap:8 }}>
        {choferes.length === 0 && <div style={{ color:'#94a3b8', fontSize:13 }}>Sin datos de chofer registrados</div>}
        {choferes.map((c,i) => (
          <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', background:'#f8fafc', borderRadius:10, border:'2px solid #e2e8f0' }}>
            <span style={{ fontWeight:700, color:'#334155', flex:1 }}>🚛 {c.nombre}</span>
            {c.log>0  && <Badge tipo="logistica" />}
            {c.fact>0 && <Badge tipo="facturacion" />}
            <span style={{ fontFamily:'monospace', fontWeight:900, color:'#b91c1c', fontSize:13 }}>{fn(Math.round(c.bultos))} btos.</span>
          </div>
        ))}
      </div>
      <Sec>Artículos más rechazados</Sec>
      <div style={{ padding:'8px 24px' }}>
        {articulos.map((a,i) => (<div key={i} style={{ marginBottom:10 }}><div style={{ display:'flex', justifyContent:'space-between' }}><span style={{ fontSize:13, fontWeight:700, color:'#334155', flex:1 }}>{a.nombre}</span><span style={{ fontSize:13, fontWeight:900, fontFamily:'monospace', color:'#b91c1c' }}>{fn(Math.round(a.bultos))} btos.</span>{a.importe>0&&<span style={{ fontSize:12, color:'#64748b', marginLeft:8 }}>{fp(a.importe)}</span>}</div><BarraH valor={a.bultos} max={maxArt} /></div>))}
      </div>
      <Sec>Historial de rechazos</Sec>
      <div style={{ padding:'8px 24px 12px' }}>
        {historial.map((h,i) => (<div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px solid #f1f5f9', fontSize:13 }}><span style={{ color:'#64748b', fontFamily:'monospace', fontWeight:600 }}>{h.fecha}</span><div style={{ display:'flex', gap:12 }}><span style={{ fontWeight:700, color:'#b91c1c' }}>{fn(Math.round(h.bultos))} btos.</span>{h.importe>0&&<span style={{ color:'#64748b' }}>{fp(h.importe)}</span>}<span style={{ color:'#94a3b8', fontSize:12 }}>{h.n} reg.</span></div></div>))}
      </div>
      <div style={{ margin:'8px 24px 24px', background:'#fff7e0', border:'2px solid #f59e0b', borderRadius:12, padding:'14px 18px' }}>
        <div style={{ fontSize:13, fontWeight:800, color:'#78350f', marginBottom:6 }}>📌 Nota operativa</div>
        <div style={{ fontSize:13, color:'#92400e', lineHeight:1.7 }}>
          <strong>{item.nombre}</strong>: {item.n} rechazos · {fn(Math.round(item.bultos))} bultos · {fp(item.importe)}.{' '}
          {logB>factB ? '⚠ Mayoría logísticos — verificar entrega, horarios y manejo.' : '⚠ Mayoría de facturación — confirmar pedido antes de salir.'}
          {ranking<=3 && ' 🔴 TOP 3 rechazos — atención especial requerida.'}
        </div>
      </div>
    </Modal>
  );
};

// ══ CARD MOTIVO ═══════════════════════════════════════════════════════════════
const CardMotivo = ({ item, onCerrar }) => {
  const tipo = clasificarMotivo(item.nombre);
  const tc = TC[tipo];
  const clientes  = useMemo(()=>{ const m={}; item.rows.forEach(r=>{ const k=r.clienteDesc||'—'; if(!m[k]) m[k]={nombre:k,bultos:0,n:0}; m[k].bultos+=r.bultosRechazados; m[k].n++; }); return Object.values(m).sort((a,b)=>b.bultos-a.bultos).slice(0,10); },[item.rows]);
  const articulos = useMemo(()=>{ const m={}; item.rows.forEach(r=>{ const k=r.articuloDesc||'—'; if(!m[k]) m[k]={nombre:k,bultos:0,n:0}; m[k].bultos+=r.bultosRechazados; m[k].n++; }); return Object.values(m).sort((a,b)=>b.bultos-a.bultos).slice(0,8); },[item.rows]);
  const choferes  = useMemo(()=>{ const m={}; item.rows.forEach(r=>{ const k=r.choferDesc||r.chofer||'—'; if(!m[k]) m[k]={nombre:k,bultos:0,n:0}; m[k].bultos+=r.bultosRechazados; m[k].n++; }); return Object.values(m).sort((a,b)=>b.bultos-a.bultos).slice(0,8); },[item.rows]);
  const maxCli = clientes[0]?.bultos||1; const maxArt = articulos[0]?.bultos||1;
  return (
    <Modal onCerrar={onCerrar}>
      <MHead titulo={`📋 ${item.nombre}`} subtitulo={tc.desc} onCerrar={onCerrar} color={tc.color} />
      <div style={{ padding:'14px 24px 4px', display:'flex', alignItems:'center', gap:10 }}><Badge tipo={tipo} /><span style={{ fontSize:13, color:'#64748b', fontWeight:600 }}>{tc.desc}</span></div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, margin:'12px 24px' }}>
        <Kpi icon="📦" label="Bultos" value={fn(Math.round(item.bultos))} color={tc.color} bg={tc.bg} border={tc.border} />
        <Kpi icon="💰" label="Importe" value={fp(item.importe)} color="#5b21b6" bg="#f5f3ff" border="#c4b5fd" />
        <Kpi icon="📋" label="Registros" value={item.n} color="#0369a1" bg="#e0f2fe" border="#7dd3fc" />
        <Kpi icon="🏪" label="Clientes" value={clientes.length} color="#b87c00" bg="#fff7e0" border="#fcd34d" />
      </div>
      {tipo==='logistica' && choferes.length>0 && (<><Sec>🚛 Choferes con este rechazo logístico</Sec><div style={{ padding:'8px 24px', display:'flex', flexWrap:'wrap', gap:8 }}>{choferes.map((c,i)=>(<div key={i} style={{ background:'#fee2e2', border:'2px solid #fca5a5', borderRadius:10, padding:'8px 14px', fontSize:13, display:'flex', gap:8 }}><span style={{ fontWeight:700, color:'#b91c1c' }}>🚛 {c.nombre}</span><span style={{ fontFamily:'monospace', fontWeight:700, color:'#7f1d1d' }}>{fn(Math.round(c.bultos))} btos.</span></div>))}</div></>)}
      {tipo==='facturacion' && (<div style={{ margin:'8px 24px', padding:'10px 14px', background:'#fff7e0', borderRadius:10, border:'2px solid #fcd34d', fontSize:13, color:'#78350f', fontWeight:600 }}>🧾 Este rechazo es de facturación — NO afecta la evaluación del chofer. Gestionar con el área comercial/administrativa.</div>)}
      <Sec>Clientes más afectados</Sec>
      <div style={{ padding:'8px 24px' }}>{clientes.map((c,i)=>(<div key={i} style={{ marginBottom:10 }}><div style={{ display:'flex', justifyContent:'space-between' }}><span style={{ fontSize:13, fontWeight:700 }}>{c.nombre}</span><span style={{ fontSize:13, fontWeight:900, fontFamily:'monospace', color:tc.color }}>{fn(Math.round(c.bultos))} btos.</span></div><BarraH valor={c.bultos} max={maxCli} color={tc.color} /></div>))}</div>
      <Sec>Artículos involucrados</Sec>
      <div style={{ padding:'8px 24px 20px' }}>{articulos.map((a,i)=>(<div key={i} style={{ marginBottom:10 }}><div style={{ display:'flex', justifyContent:'space-between' }}><span style={{ fontSize:13, fontWeight:700 }}>{a.nombre}</span><span style={{ fontSize:13, fontWeight:900, fontFamily:'monospace', color:tc.color }}>{fn(Math.round(a.bultos))} btos.</span></div><BarraH valor={a.bultos} max={maxArt} color={tc.color} /></div>))}</div>
    </Modal>
  );
};

// ══ CARD ARTÍCULO ══════════════════════════════════════════════════════════════
const CardArticulo = ({ item, ranking, onCerrar }) => {
  const clientes = useMemo(()=>{ const m={}; item.rows.forEach(r=>{ const k=r.clienteDesc||'—'; if(!m[k]) m[k]={nombre:k,domicilio:r.domicilio||'—',bultos:0,n:0}; m[k].bultos+=r.bultosRechazados; m[k].n++; }); return Object.values(m).sort((a,b)=>b.bultos-a.bultos).slice(0,10); },[item.rows]);
  const motivos  = useMemo(()=>{ const m={}; item.rows.forEach(r=>{ const k=r.motivoDesc||r.motivo||'—'; const t=clasificarMotivo(k); if(!m[k]) m[k]={nombre:k,tipo:t,bultos:0,n:0}; m[k].bultos+=r.bultosRechazados; m[k].n++; }); return Object.values(m).sort((a,b)=>b.bultos-a.bultos).slice(0,6); },[item.rows]);
  const logB  = item.rows.filter(r=>clasificarMotivo(r.motivoDesc||r.motivo)==='logistica').reduce((s,r)=>s+r.bultosRechazados,0);
  const factB = item.rows.filter(r=>clasificarMotivo(r.motivoDesc||r.motivo)==='facturacion').reduce((s,r)=>s+r.bultosRechazados,0);
  const maxCli = clientes[0]?.bultos||1;
  return (
    <Modal onCerrar={onCerrar}>
      <MHead titulo={`🧴 ${item.nombre}`} subtitulo={`Ranking #${ranking} · ${item.n} registros`} onCerrar={onCerrar} color="#5b21b6" />
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, margin:'16px 24px' }}>
        <Kpi icon="📦" label="Bultos rechazados" value={fn(Math.round(item.bultos))} color="#b91c1c" bg="#fee2e2" border="#fca5a5" />
        <Kpi icon="💰" label="Importe" value={fp(item.importe)} color="#5b21b6" bg="#f5f3ff" border="#c4b5fd" />
        <Kpi icon="🏪" label="Clientes" value={clientes.length} color="#0369a1" bg="#e0f2fe" border="#7dd3fc" />
        <Kpi icon="🏆" label="Ranking" value={`#${ranking}`} color="#b87c00" bg="#fff7e0" border="#fcd34d" />
      </div>
      <Sec>Distribución por responsabilidad</Sec>
      <div style={{ padding:'10px 24px' }}><BarraLF log={logB} fact={factB} otro={item.bultos-logB-factB} total={item.bultos} /></div>
      <Sec>Motivos de rechazo</Sec>
      <div style={{ padding:'8px 24px', display:'flex', flexWrap:'wrap', gap:8 }}>{motivos.map((m,i)=>(<div key={i} style={{ background:'#f8fafc', border:'2px solid #e2e8f0', borderRadius:10, padding:'8px 14px', fontSize:13, display:'flex', alignItems:'center', gap:8 }}><Badge tipo={m.tipo} /><span style={{ fontWeight:700 }}>{m.nombre}</span><span style={{ color:'#b91c1c', fontWeight:700 }}>{fn(Math.round(m.bultos))} btos.</span></div>))}</div>
      <Sec>Clientes que más lo rechazan</Sec>
      <div style={{ padding:'8px 24px 20px' }}>{clientes.map((c,i)=>(<div key={i} style={{ marginBottom:10 }}><div style={{ display:'flex', justifyContent:'space-between' }}><div><span style={{ fontSize:13, fontWeight:700 }}>{c.nombre}</span><span style={{ fontSize:12, color:'#94a3b8', marginLeft:8 }}>{c.domicilio}</span></div><span style={{ fontSize:13, fontWeight:900, fontFamily:'monospace', color:'#5b21b6' }}>{fn(Math.round(c.bultos))} btos.</span></div><BarraH valor={c.bultos} max={maxCli} color="#5b21b6" /></div>))}</div>
    </Modal>
  );
};

// ══ CARD CHOFER ════════════════════════════════════════════════════════════════
const CardChofer = ({ item, onCerrar, bultosRepartidos = 0 }) => {
  const rows = item.rows;
  const { logR, factR, logB, factB, otroB } = useMemo(()=>{ const l=[],f=[],o=[]; rows.forEach(r=>{ const t=clasificarMotivo(r.motivoDesc||r.motivo); if(t==='logistica') l.push(r); else if(t==='facturacion') f.push(r); else o.push(r); }); return { logR:l, factR:f, logB:l.reduce((s,r)=>s+r.bultosRechazados,0), factB:f.reduce((s,r)=>s+r.bultosRechazados,0), otroB:o.reduce((s,r)=>s+r.bultosRechazados,0) }; },[rows]);
  const clientes = useMemo(()=>{ const m={}; rows.forEach(r=>{ const k=r.clienteDesc||'—'; const t=clasificarMotivo(r.motivoDesc||r.motivo); if(!m[k]) m[k]={nombre:k,bultos:0,log:0,fact:0,n:0}; m[k].bultos+=r.bultosRechazados; m[k].n++; if(t==='logistica') m[k].log+=r.bultosRechazados; if(t==='facturacion') m[k].fact+=r.bultosRechazados; }); return Object.values(m).sort((a,b)=>b.bultos-a.bultos).slice(0,8); },[rows]);
  const artLog = useMemo(()=>{ const m={}; logR.forEach(r=>{ const k=r.articuloDesc||'—'; if(!m[k]) m[k]={nombre:k,bultos:0}; m[k].bultos+=r.bultosRechazados; }); return Object.values(m).sort((a,b)=>b.bultos-a.bultos).slice(0,5); },[logR]);

  // Nuevos contadores simples para el chofer
  const countTotales = useMemo(() => rows.filter(r => r.rechazoTotal === true || r.rechazoTotal === 'true').length, [rows]);
  const countParciales = rows.length - countTotales;
  const countClientesTotal = useMemo(() => {
    const s = new Set();
    rows.forEach(r => { const c = r.clienteDesc || r.clienteId; if(c) s.add(c); });
    return s.size;
  }, [rows]);

  // % siempre sobre bultos entregados — si no hay datos usar rechazados como fallback visual
  const base       = bultosRepartidos > 0 ? bultosRepartidos : item.bultos;
  const pctLogNum  = base > 0 ? logB / base * 100 : 0;
  const pctLogStr  = pctDec(logB, base);
  const nivel      = pctLogNum <= 2 ? 'bueno' : pctLogNum <= 5 ? 'regular' : 'critico';
  const NC = {
    bueno:   { c:'#166534', bg:'#dcfce7', label:'✅ Eficiencia logística BUENA' },
    regular: { c:'#b87c00', bg:'#fff7e0', label:'⚠ Eficiencia logística REGULAR' },
    critico: { c:'#b91c1c', bg:'#fee2e2', label:'❌ Eficiencia logística CRÍTICA' },
  };
  const nc = NC[nivel];
  const maxCli = clientes[0]?.bultos || 1;

  return (
    <Modal onCerrar={onCerrar}>
      <MHead titulo={`🚛 ${item.nombre}`} subtitulo={`${item.n} registros · ${fn(Math.round(item.bultos))} bultos rechazados`} onCerrar={onCerrar} color="#0369a1" />
      {/* KPIs — incluye bultos entregados si disponible */}
      <div style={{ display:'grid', gridTemplateColumns:`repeat(${bultosRepartidos>0?5:4},1fr)`, gap:10, margin:'16px 24px' }}>
        {bultosRepartidos > 0 && (
          <Kpi icon="🚚" label="Bultos entregados" value={fn(Math.round(bultosRepartidos))} color="#166534" bg="#dcfce7" border="#86efac" />
        )}
        <Kpi icon="📦" label="Total rechazados" value={fn(Math.round(item.bultos))} color="#334155" bg="#f8fafc" border="#e2e8f0" />
        <Kpi icon="🚛" label="Por logística" value={fn(Math.round(logB))} color="#b91c1c" bg="#fee2e2" border="#fca5a5" />
        <Kpi icon="🧾" label="Por facturación" value={fn(Math.round(factB))} color="#b87c00" bg="#fff7e0" border="#fcd34d" />
        <Kpi icon="📊" label={bultosRepartidos>0?"% Log. s/entregados":"% Logístico"} value={`${pctLogStr}%`} color={nc.c} bg={nc.bg} border={nc.c+'40'} />
      </div>

      {/* NUEVO: KPIs fila 2 — clientes y tipo de rechazo */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, margin:'0 24px 16px' }}>
        <Kpi icon="🏪" label="Locales con Rechazo" value={fn(countClientesTotal)} 
             sub="Clientes que tuvieron problemas"
             color="#ea580c" bg="#ffedd5" border="#fdba74" />
        <Kpi icon="📄" label="Pedidos Rechazados (Total)" value={fn(countTotales)} 
             sub="Devolvieron toda la factura"
             color="#be123c" bg="#ffe4e6" border="#fda4af" />
        <Kpi icon="📦" label="Rechazos Parciales" value={fn(countParciales)} 
             sub="Devolvieron solo algunos bultos"
             color="#ca8a04" bg="#fefce8" border="#fde047" />
      </div>

      {/* Barra visual Entregados / Rechazados / Logísticos */}
      {bultosRepartidos > 0 && (
        <div style={{ margin:'0 24px 12px', background:'#f8fafc', border:'2px solid #e2e8f0', borderRadius:12, padding:'14px 18px' }}>
          <div style={{ fontSize:11, fontWeight:800, color:'#64748b', textTransform:'uppercase', marginBottom:10 }}>Entregados vs Rechazados</div>
          <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:8 }}>
            <span style={{ fontSize:12, fontWeight:700, color:'#166534', width:160, flexShrink:0 }}>🚚 Entregados</span>
            <div style={{ flex:1, height:18, background:'#dcfce7', borderRadius:6 }}><div style={{ height:'100%', width:'100%', background:'#166534', borderRadius:6 }}/></div>
            <span style={{ fontSize:12, fontWeight:900, fontFamily:'monospace', color:'#166534', width:70, textAlign:'right', flexShrink:0 }}>{fn(Math.round(bultosRepartidos))}</span>
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:8 }}>
            <span style={{ fontSize:12, fontWeight:700, color:'#b91c1c', width:160, flexShrink:0 }}>❌ Rechazados</span>
            <div style={{ flex:1, height:18, background:'#fee2e2', borderRadius:6, overflow:'hidden' }}><div style={{ height:'100%', width:`${Math.min(100,pct(item.bultos,bultosRepartidos))}%`, background:'#b91c1c', borderRadius:6 }}/></div>
            <span style={{ fontSize:12, fontWeight:900, fontFamily:'monospace', color:'#b91c1c', width:70, textAlign:'right', flexShrink:0 }}>{fn(Math.round(item.bultos))} ({pct(item.bultos,bultosRepartidos)}%)</span>
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <span style={{ fontSize:12, fontWeight:700, color:'#7f1d1d', width:160, flexShrink:0 }}>🚛 Log. (resp.)</span>
            <div style={{ flex:1, height:18, background:'#fee2e2', borderRadius:6, overflow:'hidden' }}><div style={{ height:'100%', width:`${Math.min(100,pct(logB,bultosRepartidos))}%`, background:'#7f1d1d', borderRadius:6 }}/></div>
            <span style={{ fontSize:12, fontWeight:900, fontFamily:'monospace', color:'#7f1d1d', width:70, textAlign:'right', flexShrink:0 }}>{fn(Math.round(logB))} ({pctLogStr}%)</span>
          </div>
        </div>
      )}

      <div style={{ margin:'0 24px 4px', background:nc.bg, border:`2px solid ${nc.c}40`, borderRadius:14, padding:'14px 18px' }}>
        <div style={{ fontSize:14, fontWeight:800, color:nc.c, marginBottom:10 }}>{nc.label}</div>
        <BarraLF log={logB} fact={factB} otro={otroB} total={item.bultos} />
        <div style={{ marginTop:10, fontSize:13, color:nc.c, fontWeight:600, lineHeight:1.6 }}>
          {nivel==='bueno'   && 'La mayoría son de facturación, fuera del control del chofer. Buen desempeño.'}
          {nivel==='regular' && 'Proporción significativa de rechazos logísticos. Revisar procedimientos de entrega.'}
          {nivel==='critico' && 'Alta proporción logística. Se recomienda capacitación y seguimiento de entregas.'}
        </div>
      </div>
      {logR.length>0 && (<><Sec>🚛 Rechazos logísticos — responsabilidad del chofer ({logR.length} reg.)</Sec><div style={{ padding:'8px 24px' }}>{artLog.map((a,i)=>(<div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'6px 0', borderBottom:'1px solid #fee2e2', fontSize:13 }}><span style={{ fontWeight:600 }}>{a.nombre}</span><span style={{ fontWeight:700, fontFamily:'monospace', color:'#b91c1c' }}>{fn(Math.round(a.bultos))} btos.</span></div>))}</div></>)}
      {factR.length>0 && (<><Sec>🧾 Rechazos de facturación — NO responsabilidad del chofer ({factR.length} reg.)</Sec><div style={{ margin:'4px 24px 8px', padding:'10px 14px', background:'#fffbeb', borderRadius:10, border:'1px solid #fcd34d', fontSize:13, color:'#78350f', fontWeight:600 }}>{factR.length} registros · {fn(Math.round(factB))} bultos — no deben afectar la evaluación del chofer</div></>)}
      <Sec>Clientes con más rechazos con este chofer</Sec>
      <div style={{ padding:'8px 24px 20px' }}>{clientes.map((c,i)=>(<div key={i} style={{ marginBottom:10 }}><div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}><span style={{ fontSize:13, fontWeight:700, flex:1 }}>{c.nombre}</span><div style={{ display:'flex', gap:6 }}>{c.log>0&&<span style={{ fontSize:11, color:'#b91c1c', fontWeight:700 }}>🚛{fn(Math.round(c.log))}</span>}{c.fact>0&&<span style={{ fontSize:11, color:'#b87c00', fontWeight:700 }}>🧾{fn(Math.round(c.fact))}</span>}<span style={{ fontSize:13, fontWeight:900, fontFamily:'monospace', color:'#0369a1' }}>{fn(Math.round(c.bultos))} btos.</span></div></div><BarraH valor={c.bultos} max={maxCli} color="#0369a1" /></div>))}</div>
    </Modal>
  );
};

// ══ MODAL EDITAR ══════════════════════════════════════════════════════════════
const ModalEditar = ({ rechazo, onGuardar, onEliminar, onCerrar }) => {
  const [form, setForm] = useState({...rechazo});
  const setF = (k,v) => setForm(f=>({...f,[k]:v}));
  const campos = [
    {k:'fecha',           label:'Fecha',             type:'date'},
    {k:'clienteDesc',     label:'Cliente',           type:'text'},
    {k:'choferDesc',      label:'Chofer',            type:'text'},
    {k:'articuloDesc',    label:'Artículo',          type:'text'},
    {k:'bultosRechazados',label:'Bultos rechazados', type:'number'},
    {k:'importeRechazado',label:'Importe rechazado', type:'number'},
    {k:'motivoDesc',      label:'Motivo',            type:'text'},
    {k:'domicilio',       label:'Domicilio',         type:'text'},
  ];
  return (
    <Modal onCerrar={onCerrar} maxWidth={520}>
      <MHead titulo="✏️ Editar rechazo" subtitulo={`Registro #${rechazo.id}`} onCerrar={onCerrar} color="#475569" />
      <div style={{ padding:'20px 24px', display:'flex', flexDirection:'column', gap:14 }}>
        {campos.map(f=>(<div key={f.k}><label style={{ fontSize:12, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'.05em', display:'block', marginBottom:4 }}>{f.label}</label><input type={f.type} value={form[f.k]||''} onChange={e=>setF(f.k,e.target.value)} style={{ width:'100%', padding:'8px 12px', border:'2px solid #e2e8f0', borderRadius:8, fontSize:14, fontFamily:'inherit', outline:'none', boxSizing:'border-box' }} /></div>))}
      </div>
      <div style={{ padding:'0 24px 24px', display:'flex', gap:10, justifyContent:'space-between' }}>
        <button onClick={()=>{ if(window.confirm('¿Eliminar este rechazo?')) onEliminar(rechazo.id); }} style={{ padding:'9px 18px', background:'#fee2e2', color:'#b91c1c', border:'2px solid #fca5a5', borderRadius:8, fontSize:13, fontWeight:700, cursor:'pointer' }}>🗑 Eliminar</button>
        <div style={{ display:'flex', gap:10 }}>
          <button onClick={onCerrar} style={{ padding:'9px 18px', background:'#f1f5f9', color:'#475569', border:'2px solid #e2e8f0', borderRadius:8, fontSize:13, fontWeight:700, cursor:'pointer' }}>Cancelar</button>
          <button onClick={()=>onGuardar(form)} style={{ padding:'9px 22px', background:'#0369a1', color:'#fff', border:'none', borderRadius:8, fontSize:13, fontWeight:700, cursor:'pointer' }}>💾 Guardar</button>
        </div>
      </div>
    </Modal>
  );
};

// ══ LISTA CLICKEABLE ══════════════════════════════════════════════════════════
const ListaItems = ({ items, maxBultos, color, onClickItem, renderExtra }) => (
  <div>
    {items.map((item,i) => (
      <div key={i} onClick={()=>onClickItem(item)}
        style={{ marginBottom:10, padding:'12px 16px', borderRadius:12, background:'#fff', border:'2px solid #f1f5f9', cursor:'pointer', transition:'all .15s' }}
        onMouseEnter={e=>{ e.currentTarget.style.borderColor=color; e.currentTarget.style.background='#f8fafc'; }}
        onMouseLeave={e=>{ e.currentTarget.style.borderColor='#f1f5f9'; e.currentTarget.style.background='#fff'; }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
          <div style={{ display:'flex', gap:8, alignItems:'center', flex:1, minWidth:0 }}>
            <span style={{ fontSize:13, fontWeight:800, color:'#94a3b8', width:24, flexShrink:0 }}>{i+1}.</span>
            <span style={{ fontSize:14, fontWeight:700, color:'#1e293b', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{item.nombre}</span>
            {renderExtra && renderExtra(item)}
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center', flexShrink:0, marginLeft:12 }}>
            <span style={{ fontSize:11, padding:'2px 8px', borderRadius:8, background:'#fee2e2', color:'#b91c1c', fontWeight:700 }}>{item.n} reg.</span>
            <span style={{ fontSize:14, fontWeight:900, fontFamily:'monospace', color }}>{fn(Math.round(item.bultos))} btos.</span>
            {item.importe>0 && <span style={{ fontSize:12, color:'#64748b' }}>{fp(item.importe)}</span>}
            <span style={{ fontSize:18, color:'#cbd5e1' }}>›</span>
          </div>
        </div>
        <BarraH valor={item.bultos} max={maxBultos} color={color} />
      </div>
    ))}
    {items.length===0 && <div style={{ textAlign:'center', padding:'32px', color:'#94a3b8', fontSize:14 }}>Sin resultados para este filtro</div>}
  </div>
);

// ══════════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ══════════════════════════════════════════════════════════════════════════════
export const TRechazos = ({ rechazos = [], regs = [], cfg = {}, embebido = false, loggedInUser, onEditar, onEliminar }) => {

  // ── Exportar rechazos filtrados a Excel ───────────────────────────────────
  const exportarRechazosXLSX = useCallback((filas, nombreArchivo = 'rechazos_export') => {
    try {
      const headers = [
        'Fecha','Cliente','Domicilio','Chofer','Artículo','Bultos Rechazados',
        'HL Rechazado','Importe Rechazado','Motivo','Tipo Responsabilidad'
      ];
      const rows = filas.map(r => [
        r.fecha || '',
        r.clienteDesc || '',
        r.domicilio || '',
        r.choferDesc || '',
        r.articuloDesc || '',
        Math.round(r.bultosRechazados || 0),
        (r.hlRechazado || 0).toFixed(2),
        Math.round(r.importeRechazado || 0),
        r.motivoDesc || r.motivo || '',
        clasificarMotivo(r.motivoDesc || r.motivo) === 'logistica' ? 'Logística'
          : clasificarMotivo(r.motivoDesc || r.motivo) === 'facturacion' ? 'Facturación'
          : 'Otro',
      ]);

      // Construir CSV con BOM para que Excel lo abra con tildes correctas
      const bom = '\uFEFF';
      const sep = ';';
      const csvContent = bom + [headers, ...rows]
        .map(row => row.map(v => `"${String(v).replace(/"/g,'""')}"`).join(sep))
        .join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `${nombreArchivo}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Error exportando rechazos:', e);
    }
  }, []);
  const [tabActiva,       setTabActiva]       = useState('cliente');
  const [buscar,          setBuscar]          = useState('');
  const [desdeFecha,      setDesdeFecha]      = useState('');
  const [hastaFecha,      setHastaFecha]      = useState('');
  const [cardAbierta,     setCardAbierta]     = useState(null);
  const [editando,        setEditando]        = useState(null);
  // Si loggedInUser es chofer, desactiva automáticamente el filtro de soloMisChoferes
  // porque los datos ya vienen filtrados desde App.js
  const [soloMisChoferes, setSoloMisChoferes] = useState(!loggedInUser || loggedInUser.role !== 'chofer');
  const [mesSel,          setMesSel]          = useState('');

  const norm = (s) => String(s||'').toUpperCase()
    .replace(/Á/g,'A').replace(/É/g,'E').replace(/Í/g,'I')
    .replace(/Ó/g,'O').replace(/Ú/g,'U').replace(/Ü/g,'U').replace(/Ñ/g,'N')
    .trim();

  const misChoferes = useMemo(() => {
    const dm = cfg.driverMap || [];
    // Los IDs del driverMap son de TRANSPORTE (vienen del CSV de Foxtrot)
    const ids = new Set(dm.map(d => String(d.id || '').trim()).filter(Boolean));
    // FIX: mapa ID → nombre normalizado para validar que el ID pertenezca al chofer correcto
    // Un mismo ID puede aparecer en registros de choferes distintos (datos sucios del CSV).
    // Al cruzar ID + nombre, nos aseguramos de que solo pase quien realmente tiene ese ID.
    const idToNombre = {};
    dm.forEach(d => { idToNombre[String(d.id || '').trim()] = norm(d.nombre || ''); });
    const nombresRaw = dm.length > 0
      ? dm.map(d => d.nombre)
      : (cfg.choferes?.length > 0 ? cfg.choferes : DC.choferes);
    const nombres = new Set(nombresRaw.map(n => norm(n)));
    const tieneIds = ids.size > 0;
    console.log('[TRechazos] choferes válidos:', nombresRaw.length, nombresRaw, '| IDs cargados:', ids.size);
    return { ids, idToNombre, nombres, size: nombresRaw.length, tieneIds };
  }, [cfg.driverMap, cfg.choferes]); // eslint-disable-line react-hooks/exhaustive-deps

  const esChoferValido = useCallback((r) => {
    if (!soloMisChoferes || misChoferes.size === 0) return true;

    const nombreRegistro = norm(r.choferDesc || '');

    // Check 1: por transporteId — además verifica que el ID pertenezca a ESTE chofer
    // FIX: un chofer puede tener el mismo transporteId que otro en datos sucios del CSV.
    // Solo se acepta si el nombre en el driverMap coincide con el choferDesc del registro.
    const tId = String(r.transporteId || '').trim();
    if (tId && tId !== '—' && misChoferes.ids.has(tId)) {
      const nombreEnMapa = misChoferes.idToNombre[tId];
      if (!nombreEnMapa || nombreEnMapa === nombreRegistro) return true;
      // El ID existe en el mapa pero pertenece a OTRO chofer → no pasa
    }

    // Check 2: por chofer ID numérico — misma lógica
    const cId = String(r.chofer || '').trim();
    if (cId && misChoferes.ids.has(cId)) {
      const nombreEnMapa = misChoferes.idToNombre[cId];
      if (!nombreEnMapa || nombreEnMapa === nombreRegistro) return true;
    }

    // Check 3: por nombre normalizado — SOLO si driverMap NO tiene IDs (modo legacy)
    if (!misChoferes.tieneIds) {
      return misChoferes.nombres.has(nombreRegistro);
    }

    return false;
  }, [soloMisChoferes, misChoferes]); // eslint-disable-line react-hooks/exhaustive-deps

  const { fechaMin, fechaMax } = useMemo(() => {
    const fechas = rechazos.map(r=>r.fecha).filter(Boolean).sort();
    return { fechaMin:fechas[0]||'', fechaMax:fechas[fechas.length-1]||'' };
  },[rechazos]);

  const mesesDisponibles = useMemo(() => {
    const set = new Set();
    rechazos.forEach(r => { if (r.fecha) set.add(r.fecha.slice(0,7)); });
    return [...set].sort();
  }, [rechazos]);

  // Mes único — contexto para bultosXMes cuando no hay mesSel activo
  const mesDelExcel = useMemo(() => {
    return mesesDisponibles.length === 1 ? mesesDisponibles[0] : null;
  }, [mesesDisponibles]);

  const filtrados = useMemo(() => {
    return rechazos.filter(r => {
      if (ARTS_EXCLUIDOS.has(String(r.articulo||'').trim())) return false;
      if (!esChoferValido(r)) return false;
      if (mesSel && !(r.fecha||'').startsWith(mesSel)) return false;
      if (desdeFecha && (r.fecha||'') < desdeFecha) return false;
      if (hastaFecha && (r.fecha||'') > hastaFecha) return false;
      if (buscar) {
        const b = buscar.toLowerCase();
        return (r.clienteDesc||'').toLowerCase().includes(b)
            || (r.choferDesc||'').toLowerCase().includes(b)
            || (r.articuloDesc||'').toLowerCase().includes(b)
            || (r.motivoDesc||r.motivo||'').toLowerCase().includes(b)
            || (r.domicilio||'').toLowerCase().includes(b);
      }
      return true;
    });
  },[rechazos, buscar, desdeFecha, hastaFecha, mesSel, esChoferValido]);

  const agrupar = useCallback((keyFn) => {
    const m = {};
    filtrados.forEach(r => {
      const k = keyFn(r)||'—';
      if(!m[k]) m[k]={nombre:k,bultos:0,importe:0,n:0,rows:[]};
      m[k].bultos+=r.bultosRechazados; m[k].importe+=r.importeRechazado; m[k].n++; m[k].rows.push(r);
    });
    return Object.values(m).sort((a,b)=>b.bultos-a.bultos);
  },[filtrados]);

  // FIX ESLint: filtrados ya está capturado en agrupar via useCallback
  const porCliente  = useMemo(()=>agrupar(r=>r.clienteDesc||r.clienteId),[agrupar]);
  const porMotivo   = useMemo(()=>agrupar(r=>r.motivoDesc||r.motivo),[agrupar]);
  const porArticulo = useMemo(()=>agrupar(r=>r.articuloDesc||r.articulo),[agrupar]);
  // FIX: agrupar siempre por choferDesc para que un mismo chofer con múltiples IDs
  // no quede partido en varias entradas separadas
  const porChofer   = useMemo(()=>agrupar(r=>r.choferDesc||'—'),[agrupar]);

  const itemsActivos = {cliente:porCliente,motivo:porMotivo,articulo:porArticulo,chofer:porChofer}[tabActiva]||[];
  const maxBultos    = itemsActivos[0]?.bultos||1;

  const totalBultos  = filtrados.reduce((s,r)=>s+r.bultosRechazados,0);
  const totalImporte = filtrados.reduce((s,r)=>s+r.importeRechazado,0);
  const totalHL      = filtrados.reduce((s,r)=>s+(r.hlRechazado||0),0);
  const logBultos    = filtrados.filter(r=>clasificarMotivo(r.motivoDesc||r.motivo)==='logistica').reduce((s,r)=>s+r.bultosRechazados,0);
  const factBultos   = filtrados.filter(r=>clasificarMotivo(r.motivoDesc||r.motivo)==='facturacion').reduce((s,r)=>s+r.bultosRechazados,0);

  // ── FIX BULTOS ENTREGADOS ─────────────────────────────────────────────────
  // Filtro OFF → suma real de bultosXMes considerando filtros de fecha
  // Filtro ON  → suma de bultos de mis choferes mediante porChofer por mes
  const bultosEntregados = useMemo(() => {
    const bxM   = cfg.bultosXMes || {};
    const meses = Object.keys(bxM).sort();

    // Sin filtro de choferes → total real del período (respetando desdeFecha/hastaFecha)
    if (!soloMisChoferes || misChoferes.ids.size === 0) {
      if (mesSel && bxM[mesSel]?.total > 0) return Math.round(bxM[mesSel].total);

      // Considerar rangos de fecha si están definidos
      let mesesEnRango = meses;
      if (desdeFecha || hastaFecha) {
        const desdeMes = desdeFecha ? desdeFecha.slice(0,7) : null;
        const hastaMes = hastaFecha ? hastaFecha.slice(0,7) : null;
        mesesEnRango = meses.filter(m => {
          if (desdeMes && m < desdeMes) return false;
          if (hastaMes && m > hastaMes) return false;
          return true;
        });
      }

      const suma = mesesEnRango.reduce((s, m) => s + (bxM[m]?.total || 0), 0);
      return suma > 0 ? Math.round(suma) : (cfg.bultosTotal || 0);
    }

    // Con filtro ON → sumar solo mis chofer IDs desde porChofer
    const mesEfectivo = mesSel || mesDelExcel;
    if (mesEfectivo) {
      const dm = bxM[mesEfectivo];
      if (dm?.porChofer && Object.keys(dm.porChofer).length > 0) {
        let suma = 0;
        misChoferes.ids.forEach(id => { suma += dm.porChofer[id] || 0; });
        if (suma > 0) return Math.round(suma);
      }
      return dm?.total > 0 ? Math.round(dm.total) : 0;
    }

    // "Todos" con filtro ON → sumar mis chofer IDs de todos los meses en rango
    let mesesEnRango = meses;
    if (desdeFecha || hastaFecha) {
      const desdeMes = desdeFecha ? desdeFecha.slice(0,7) : null;
      const hastaMes = hastaFecha ? hastaFecha.slice(0,7) : null;
      mesesEnRango = meses.filter(m => {
        if (desdeMes && m < desdeMes) return false;
        if (hastaMes && m > hastaMes) return false;
        return true;
      });
    }

    let suma = 0;
    mesesEnRango.forEach(m => {
      const pc = bxM[m]?.porChofer || {};
      misChoferes.ids.forEach(id => { suma += pc[id] || 0; });
    });
    if (suma > 0) return Math.round(suma);

    // Fallback final
    return cfg.bultosTotal || 0;
  }, [cfg.bultosXMes, cfg.bultosTotal, soloMisChoferes, misChoferes, mesSel, mesDelExcel, desdeFecha, hastaFecha]);

  const diasTrabajados = useMemo(() => {
    const fechas = filtrados.map(r => r.fecha).filter(Boolean).sort();
    if (fechas.length === 0) return null;
    const desde = desdeFecha || fechas[0];
    const hasta  = hastaFecha  || fechas[fechas.length - 1];
    const extras = (cfg.diasNoTrabajados || []).map(d => d.fecha);
    return calcDiasTrabajados(desde, hasta, extras);
  }, [filtrados, desdeFecha, hastaFecha, cfg.diasNoTrabajados]);

  const otroBultos  = totalBultos - logBultos - factBultos;
  const baseParaPct = bultosEntregados > 0 ? bultosEntregados : totalBultos;

  const pctLog  = pctDec(logBultos,  baseParaPct);
  const pctFact = pctDec(factBultos, baseParaPct);
  const pctOtro = pctDec(otroBultos, baseParaPct);

  // ── NUEVOS KPIS: Clientes y Facturas (Versión Simple) ─────────────────────
  const clientesConRechazo = useMemo(() => {
    const s = new Set();
    filtrados.forEach(r => {
      // Usamos clienteDesc o clienteId para identificar únicos
      const c = r.clienteDesc || r.clienteId;
      if (c) s.add(c);
    });
    return s.size;
  }, [filtrados]);

  const rechazosTotalesCount = useMemo(() => {
    return filtrados.filter(r => r.rechazoTotal === true || r.rechazoTotal === 'true').length;
  }, [filtrados]);
  
  const rechazosParcialesCount = filtrados.length - rechazosTotalesCount;

  const TABS = [
    {id:'cliente', label:'🏪 Clientes',  color:'#b91c1c'},
    {id:'motivo',  label:'📋 Motivos',   color:'#b87c00'},
    {id:'articulo',label:'🧴 Artículos', color:'#5b21b6'},
    {id:'chofer',  label:'🚛 Choferes',  color:'#0369a1'},
  ];
  const colorActivo = TABS.find(t=>t.id===tabActiva)?.color||'#b91c1c';

  if (rechazos.length===0) return (
    <div className={embebido?'':'dash-container'}>
      {!embebido && <div className="dash-header"><div><h2 className="dash-title">Rechazos</h2><p className="dash-sub">Importá el Excel desde Importar → Guardar Rechazos</p></div></div>}
      <div style={{ textAlign:'center', padding:'64px 24px', color:'#94a3b8' }}>
        <div style={{ fontSize:56, marginBottom:16 }}>❌</div>
        <div style={{ fontSize:18, fontWeight:800, color:'#475569', marginBottom:8 }}>No hay datos de rechazos</div>
        <div style={{ fontSize:14, maxWidth:380, margin:'0 auto', lineHeight:1.7 }}>Importá el Excel de rechazos y hacé click en <strong>Guardar Rechazos</strong></div>
      </div>
    </div>
  );

  return (
    <div className={embebido?'':'dash-container'}>
      {!embebido && (
        <div className="dash-header">
          <div>
            <h2 className="dash-title">Rechazos</h2>
            <p className="dash-sub">Hacé click en cualquier fila para ver el detalle completo · {rechazos.length} registros totales</p>
          </div>
          <div className="dash-header-right" style={{ flexWrap:'wrap', gap:8 }}>
            {/* Selector de mes */}
            {mesesDisponibles.length >= 1 && (
              <>
                <span style={{ fontSize:11, fontWeight:800, color:'#64748b', textTransform:'uppercase' }}>Mes:</span>
                {mesesDisponibles.map(m => {
                  const [y,mo] = m.split('-');
                  const lbl = new Date(+y,+mo-1,1).toLocaleString('es-AR',{month:'short',year:'numeric'}).replace('.','');
                  return (
                    <button key={m} onClick={() => { setMesSel(m); setDesdeFecha(''); setHastaFecha(''); }}
                      style={{ padding:'6px 14px', borderRadius:8, border:'2px solid', fontSize:13, fontWeight:700, cursor:'pointer',
                        background: mesSel===m ? '#b91c1c' : '#f1f5f9', color: mesSel===m ? '#fff' : '#475569',
                        borderColor: mesSel===m ? '#b91c1c' : '#e2e8f0' }}>{lbl}</button>
                  );
                })}
              </>
            )}
            {/* Botón exportar Excel — solo para admin */}
            {(!loggedInUser || loggedInUser.role === 'admin') && (
            <button
              onClick={() => {
                const fecha = mesSel || new Date().toISOString().slice(0,7);
                exportarRechazosXLSX(filtrados, `rechazos_${fecha}`);
              }}
              title={`Exportar ${filtrados.length} registros filtrados a CSV`}
              style={{ padding:'7px 16px', background:'#166534', color:'#fff', border:'none', borderRadius:8, fontSize:13, fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
              📥 Exportar Excel ({fn(filtrados.length)})
            </button>
            )}
          </div>
        </div>
      )}

      {/* KPIs fila 1 — volumen */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:12, marginBottom:12 }}>
        <Kpi icon="✅"  label="Bultos entregados"      value={bultosEntregados > 0 ? fn(bultosEntregados) : '—'}
          sub={bultosEntregados > 0 ? `${pctDec(totalBultos,bultosEntregados)}% rechazado` : 'sin datos'}
          color="#166534" bg="#dcfce7" border="#86efac" />
        <Kpi icon="❌"  label="Bultos rechazados"    value={fn(Math.round(totalBultos))}  color="#b91c1c" bg="#fee2e2" border="#fca5a5" />
        <Kpi icon="📋"  label="Registros de rechazo" value={fn(filtrados.length)}          color="#b87c00" bg="#fff7e0" border="#fcd34d" />
        <Kpi icon="🧴"  label="HL rechazados"        value={totalHL.toFixed(2)}             color="#5b21b6" bg="#f5f3ff" border="#c4b5fd" />
        <Kpi icon="💰"  label="Importe rechazado"    value={fp(totalImporte)}               color="#0369a1" bg="#e0f2fe" border="#7dd3fc" />
      </div>

      {/* KPIs fila 2 — clientes y tipo de rechazo */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginBottom:12 }}>
        <Kpi icon="🏪" label="Locales con Rechazo" value={fn(clientesConRechazo)} 
             sub="Cantidad de clientes o facturas afectadas"
             color="#ea580c" bg="#ffedd5" border="#fdba74" />
        <Kpi icon="📄" label="Pedidos Rechazados (Total)" value={fn(rechazosTotalesCount)} 
             sub="El cliente devolvió toda la factura"
             color="#be123c" bg="#ffe4e6" border="#fda4af" />
        <Kpi icon="📦" label="Rechazos Parciales" value={fn(rechazosParcialesCount)} 
             sub="El cliente devolvió solo algunos bultos"
             color="#ca8a04" bg="#fefce8" border="#fde047" />
      </div>

      {/* KPI fila 2 — días trabajados */}
      {diasTrabajados && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:12, marginBottom:12 }}>
          <Kpi icon="📅" label="Días trabajados en el período" value={diasTrabajados}
            sub="Lun-Sáb · descontando feriados AR"
            color="#0369a1" bg="#e0f2fe" border="#7dd3fc" />
        </div>
      )}

      {/* KPIs de responsabilidad */}
      {bultosEntregados > 0 ? (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginBottom:16 }}>
          <Kpi
            icon="🚛"
            label="% Logística s/pedidos"
            value={`${pctLog}%`}
            sub={`${fn(Math.round(logBultos))} bultos rechazados`}
            color={parseFloat(pctLog.replace(',','.'))>3?'#b91c1c':'#166534'}
            bg={parseFloat(pctLog.replace(',','.'))>3?'#fee2e2':'#dcfce7'}
            border={parseFloat(pctLog.replace(',','.'))>3?'#fca5a5':'#86efac'}
          />
          <Kpi
            icon="🧾"
            label="% Facturación (admin)"
            value={`${pctFact}%`}
            sub={`${fn(Math.round(factBultos))} bultos rechazados`}
            color="#b87c00"
            bg="#fff7e0"
            border="#fcd34d"
          />
          <Kpi
            icon="🏪"
            label="% Comercial / Ventas"
            value={`${pctOtro}%`}
            sub={`${fn(Math.round(otroBultos))} bultos rechazados`}
            color="#0369a1"
            bg="#e0f2fe"
            border="#7dd3fc"
          />
        </div>
      ) : (
        <div style={{ background:'#fff7e0', border:'2px solid #fcd34d', borderRadius:12,
          padding:'14px 18px', marginBottom:16, display:'flex', alignItems:'center', gap:12 }}>
          <span style={{ fontSize:22 }}>⚠️</span>
          <div>
            <div style={{ fontWeight:800, color:'#b87c00', fontSize:14 }}>
              % de logística/facturación no disponibles
            </div>
            <div style={{ fontSize:13, color:'#92400e', marginTop:3 }}>
              Reimportá el Excel desde <strong>Importar → Guardar Rechazos</strong> para calcular los porcentajes sobre el total de bultos pedidos.
            </div>
          </div>
        </div>
      )}

      {/* Alerta si hay muchos sin clasificar */}
      {parseFloat(pctOtro.replace(',','.')) > 30 && (
        <div style={{ background:'#eff6ff', border:'2px solid #7dd3fc', borderRadius:12, padding:'12px 18px', marginBottom:16, display:'flex', alignItems:'center', gap:12 }}>
          <span style={{ fontSize:20 }}>🏪</span>
          <div>
            <div style={{ fontWeight:800, color:'#0369a1', fontSize:14 }}>
              {pctOtro}% de los rechazos corresponden a Comercial / Ventas
            </div>
            <div style={{ fontSize:12, color:'#0369a1', marginTop:3 }}>
              Estos rechazos son responsabilidad del área comercial — no impactan en logística ni facturación.
            </div>
          </div>
        </div>
      )}

      {/* Barra distribución */}
      <div style={{ background:'#f8fafc', border:'2px solid #e2e8f0', borderRadius:12, padding:'14px 18px', marginBottom:16 }}>
        <div style={{ fontSize:11, fontWeight:800, color:'#64748b', textTransform:'uppercase', marginBottom:4 }}>
          Distribución por responsabilidad
          <span style={{ fontWeight:400, color:'#94a3b8', textTransform:'none', fontSize:11, marginLeft:8 }}>· % sobre bultos rechazados totales</span>
        </div>
        <BarraLF log={logBultos} fact={factBultos} otro={otroBultos} total={baseParaPct} />
      </div>

      {/* Filtros dinámicos con fechas reales */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr auto', gap:10, marginBottom:10, alignItems:'end' }}>
        <div>
          <label style={{ fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', display:'block', marginBottom:4 }}>
            Desde {fechaMin && <span style={{ color:'#94a3b8', fontWeight:500, textTransform:'none', fontSize:11 }}>· mín: {fechaMin}</span>}
          </label>
          <input type="date" className="filter-input" value={desdeFecha}
            min={fechaMin} max={hastaFecha||fechaMax}
            onChange={e=>setDesdeFecha(e.target.value)} style={{ width:'100%' }} />
        </div>
        <div>
          <label style={{ fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', display:'block', marginBottom:4 }}>
            Hasta {fechaMax && <span style={{ color:'#94a3b8', fontWeight:500, textTransform:'none', fontSize:11 }}>· máx: {fechaMax}</span>}
          </label>
          <input type="date" className="filter-input" value={hastaFecha}
            min={desdeFecha||fechaMin} max={fechaMax}
            onChange={e=>setHastaFecha(e.target.value)} style={{ width:'100%' }} />
        </div>
        <div>
          <label style={{ fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', display:'block', marginBottom:4 }}>Buscar</label>
          <input type="text" className="filter-input" placeholder="Cliente, chofer, artículo, motivo..."
            value={buscar} onChange={e=>setBuscar(e.target.value)} style={{ width:'100%' }} />
        </div>
        <button onClick={()=>{ setBuscar(''); setDesdeFecha(''); setHastaFecha(''); setMesSel(''); }}
          style={{ padding:'8px 14px', background:'#f1f5f9', border:'2px solid #e2e8f0', borderRadius:8, fontSize:13, fontWeight:700, cursor:'pointer', color:'#475569', alignSelf:'flex-end', height:38 }}>
          ✕
        </button>
      </div>

      {/* Toggle mis choferes */}
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:12, padding:'10px 14px', background: soloMisChoferes?'#e0f2fe':'#f8fafc', border:`2px solid ${soloMisChoferes?'#7dd3fc':'#e2e8f0'}`, borderRadius:10 }}>
        <button
          onClick={() => setSoloMisChoferes(v => !v)}
          style={{ width:42, height:24, borderRadius:12, border:'none', cursor:'pointer', position:'relative', background: soloMisChoferes?'#0369a1':'#cbd5e1', transition:'background .2s', flexShrink:0 }}
        >
          <span style={{ position:'absolute', top:3, left: soloMisChoferes?20:3, width:18, height:18, borderRadius:'50%', background:'#fff', transition:'left .2s', boxShadow:'0 1px 3px rgba(0,0,0,.3)' }} />
        </button>
        <div>
          <span style={{ fontWeight:800, fontSize:13, color: soloMisChoferes?'#0369a1':'#64748b' }}>
            {soloMisChoferes ? '🚛 Solo mis choferes' : '👥 Todos los choferes del archivo'}
          </span>
          <span style={{ fontSize:12, color:'#64748b', marginLeft:8 }}>
            {soloMisChoferes
              ? `${misChoferes.size} choferes del mapeo Config · ${filtrados.length} registros`
              : `${rechazos.length} registros totales del archivo`}
          </span>
        </div>
        {soloMisChoferes && misChoferes.size === 0 && (
          <span style={{ fontSize:12, color:'#b91c1c', fontWeight:700, background:'#fee2e2', padding:'3px 10px', borderRadius:8 }}>
            ⚠ No hay choferes en Config → Mapeo Driver ID
          </span>
        )}
      </div>

      {filtrados.length !== rechazos.length && (
        <div style={{ fontSize:12, color:'#0369a1', fontWeight:700, marginBottom:10, padding:'6px 12px', background:'#e0f2fe', borderRadius:8, display:'inline-block' }}>
          Filtrando: {filtrados.length} de {rechazos.length} registros
        </div>
      )}

      {/* Tabs */}
      <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={()=>setTabActiva(t.id)}
            style={{ padding:'9px 18px', borderRadius:10, border:'none', cursor:'pointer', fontSize:13, fontWeight:700, transition:'all .15s', background:tabActiva===t.id?t.color:'#f1f5f9', color:tabActiva===t.id?'#fff':'#475569' }}>
            {t.label} <span style={{ marginLeft:4, fontSize:12, opacity:.8 }}>({({cliente:porCliente,motivo:porMotivo,articulo:porArticulo,chofer:porChofer}[t.id]||[]).length})</span>
          </button>
        ))}
      </div>

      {/* Lista */}
      <div className="dash-card">
        <ListaItems items={itemsActivos} maxBultos={maxBultos} color={colorActivo}
          onClickItem={item=>setCardAbierta({tipo:tabActiva,item})}
          renderExtra={tabActiva==='motivo'?(item=><Badge tipo={clasificarMotivo(item.nombre)}/>):null}
        />
      </div>

      {/* Cards */}
      {cardAbierta?.tipo==='cliente' && (
        <CardCliente
          item={cardAbierta.item}
          ranking={porCliente.findIndex(x=>x.nombre===cardAbierta.item.nombre)+1}
          onCerrar={()=>setCardAbierta(null)}
          regsAll={regs}
        />
      )}
      {cardAbierta?.tipo==='motivo'   && <CardMotivo   item={cardAbierta.item} onCerrar={()=>setCardAbierta(null)} />}
      {cardAbierta?.tipo==='articulo' && <CardArticulo item={cardAbierta.item} ranking={porArticulo.findIndex(x=>x.nombre===cardAbierta.item.nombre)+1} onCerrar={()=>setCardAbierta(null)} />}
      {cardAbierta?.tipo==='chofer' && (() => {
        // FIX: recopilar TODOS los IDs únicos que aparecen en los rows del item
        // Un mismo chofer puede tener más de un ID en el archivo CSV
        const idsDelItem = [...new Set(
          cardAbierta.item.rows
            .map(r => String(r.chofer || '').trim())
            .filter(Boolean)
        )];

        // Mes efectivo: mesSel activo o mes único en los datos
        const mesEfectivo = mesSel || mesDelExcel;
        const datosMes = mesEfectivo ? (cfg.bultosXMes || {})[mesEfectivo] : null;

        // FIX: sumar bultos entregados de TODOS los IDs del chofer, no solo el primero
        let bultosRepartidos = 0;
        if (idsDelItem.length > 0 && datosMes?.porChofer) {
          idsDelItem.forEach(id => { bultosRepartidos += datosMes.porChofer[id] || 0; });
          bultosRepartidos = Math.round(bultosRepartidos);
        }

        // Si no hay mes seleccionado y hay múltiples meses, sumar todos los meses
        if (bultosRepartidos === 0 && idsDelItem.length > 0 && !mesEfectivo) {
          const bxM = cfg.bultosXMes || {};
          Object.values(bxM).forEach(dm => {
            idsDelItem.forEach(id => { bultosRepartidos += Math.round(dm.porChofer?.[id] || 0); });
          });
        }

        return (
          <CardChofer
            item={cardAbierta.item}
            onCerrar={() => setCardAbierta(null)}
            bultosRepartidos={bultosRepartidos}
          />
        );
      })()}

      {/* Modal editar */}
      {editando && onEditar && (
        <ModalEditar rechazo={editando}
          onGuardar={f=>{ onEditar(f); setEditando(null); }}
          onEliminar={id=>{ onEliminar(id); setEditando(null); }}
          onCerrar={()=>setEditando(null)} />
      )}
    </div>
  );
};