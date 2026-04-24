// src/components/TFoxtrot.js
// Pestaña Foxtrot — Importación CSV Route + Attempt Analytics
// KPIs individuales por chofer · Acumulado comparativo · Historial de archivos

import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { fn, fd } from '../utils/helpers';
import {
  getFoxtrotArchivos,
  getFoxtrotKpisPorChofer,
  importarFoxtrot,
  verificarArchivoFoxtrot,
  eliminarArchivoFoxtrot,
} from '../api/client';

// ── Constantes ────────────────────────────────────────────────────────────────
const SEG_A_MIN = s => s > 0 ? Math.round(s / 60) : 0;
const SEG_A_HS  = s => s > 0 ? (s / 3600).toFixed(1) : '0.0';
const MTS_A_KM  = m => m > 0 ? (m / 1000).toFixed(1) : '0.0';
const PCT       = (a, b) => b > 0 ? Math.round((a / b) * 100) : 0;

const NOMBRES_MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

// ── Parsear CSV genérico con soporte de comillas RFC-4180 ────────────────────
function parsearCSV(texto) {
  const lineas = texto.trim().split('\n');
  if (lineas.length < 2) return [];
  const parsearLinea = (linea) => {
    const cols = []; let cur = '', inQ = false;
    for (const ch of linea) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    cols.push(cur.trim());
    return cols;
  };
  const headers = parsearLinea(lineas[0]);
  return lineas.slice(1)
    .filter(l => l.trim())
    .map(l => {
      const cols = parsearLinea(l);
      const obj = {};
      headers.forEach((h, i) => { obj[h] = cols[i] ?? ''; });
      return obj;
    });
}

// Detectar tipo de CSV por sus columnas
function detectarTipoCSV(rows) {
  if (!rows.length) return null;
  const keys = Object.keys(rows[0]);
  if (keys.includes('Imported Customers Count') || keys.includes('Planned Foxtrot Driving Meters')) return 'route';
  if (keys.includes('Aggregate Visit Status') || keys.includes('Visit Duration Seconds')) return 'attempt';
  return null;
}

// ── Helpers de mes ────────────────────────────────────────────────────────────
function mesActual() {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
}

function labelMes(valor) {
  const [y, m] = valor.split('-');
  return `${NOMBRES_MESES[+m - 1]} ${y}`;
}

// ── Zona de drop ─────────────────────────────────────────────────────────────
const DropZone = ({ label, accept, icon, desc, onFile, loading, color, fileName }) => {
  const ref  = useRef();
  const [drag, setDrag] = useState(false);
  return (
    <div
      onClick={() => ref.current.click()}
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]); }}
      style={{
        border: `2px dashed ${drag ? color : fileName ? color + '99' : 'var(--border)'}`,
        borderRadius: 'var(--radius-lg)', padding: '22px 16px', textAlign: 'center',
        background: fileName ? color + '0d' : drag ? color + '10' : 'var(--bg3)',
        transition: 'all .15s', cursor: 'pointer',
      }}
    >
      <input ref={ref} type="file" accept={accept} style={{ display: 'none' }}
        onChange={e => e.target.files[0] && onFile(e.target.files[0])} />
      <div style={{ fontSize: 32, marginBottom: 6 }}>{loading ? '⏳' : fileName ? '✅' : icon}</div>
      <div style={{ fontSize: 14, fontWeight: 800, color: fileName ? color : 'var(--text)', marginBottom: 4 }}>
        {loading ? 'Procesando...' : fileName || label}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600 }}>
        {loading ? '' : fileName ? 'Click para cambiar' : 'Click o arrastrá el archivo'}
      </div>
      <div style={{ fontSize: 11, color, marginTop: 4, fontWeight: 700 }}>{accept}</div>
      {desc && !fileName && <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6, lineHeight: 1.5 }}>{desc}</div>}
    </div>
  );
};

// ── KPI Card compacto ─────────────────────────────────────────────────────────
const KpiMini = ({ icon, label, value, sub, color, bg, border }) => (
  <div style={{
    background: bg || 'var(--bg3)', border: `2px solid ${border || color + '44'}`,
    borderRadius: 12, padding: '12px 14px', textAlign: 'center',
  }}>
    <div style={{ fontSize: 20, marginBottom: 3 }}>{icon}</div>
    <div style={{ fontSize: 18, fontWeight: 900, fontFamily: 'var(--font-mono)', color }}>{value}</div>
    {sub && <div style={{ fontSize: 11, color, fontWeight: 700, marginTop: 2, opacity: 0.85 }}>{sub}</div>}
    <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', marginTop: 3 }}>{label}</div>
  </div>
);

// ── Barra de progreso horizontal ──────────────────────────────────────────────
const BarraH = ({ valor, max, color = '#005fa3', altura = 8 }) => (
  <div style={{ height: altura, background: 'var(--bg3)', borderRadius: altura, overflow: 'hidden', border: '1px solid var(--border)' }}>
    <div style={{ height: '100%', width: `${max > 0 ? Math.min(100, Math.round((valor / max) * 100)) : 0}%`, background: color, borderRadius: altura, transition: 'width .4s' }} />
  </div>
);

// ── Badge de nivel ────────────────────────────────────────────────────────────
const NivelBadge = ({ pct }) => {
  const nivel = pct >= 95 ? { label: 'Excelente', color: '#166534', bg: '#dcfce7', border: '#86efac' }
              : pct >= 80 ? { label: 'Bueno',     color: '#0369a1', bg: '#e0f2fe', border: '#7dd3fc' }
              : pct >= 65 ? { label: 'Regular',   color: '#b87c00', bg: '#fff7e0', border: '#fcd34d' }
              : { label: 'Bajo', color: '#b91c1c', bg: '#fee2e2', border: '#fca5a5' };
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 8,
      background: nivel.bg, color: nivel.color, border: `1px solid ${nivel.border}` }}>
      {nivel.label}
    </span>
  );
};

// ── Card individual de chofer ─────────────────────────────────────────────────
const CardChofer = ({ chofer, onVerDetalle, maxRutas }) => {
  const nombre       = chofer.choferMapeado || chofer.driverName || `Driver ${chofer.driverId}`;
  const tasaExito    = chofer.tasaExito;
  const seqPct       = Math.round(chofer.seqAdherenceAvg * 100);
  const kmPlan       = MTS_A_KM(chofer.kmPlanMetros);
  const kmReal       = MTS_A_KM(chofer.kmRealMetros);
  const tieneKmReal  = chofer.kmRealMetros > 0;
  const kmDevPct     = tieneKmReal
    ? Math.round(((chofer.kmRealMetros - chofer.kmPlanMetros) / chofer.kmPlanMetros) * 100)
    : null;
  const hornaJor = SEG_A_HS(chofer.segJornadaPlan);

  return (
    <div style={{
      background: 'var(--bg2)', border: '2px solid var(--border)', borderRadius: 16,
      overflow: 'hidden', transition: 'box-shadow .15s, border-color .15s',
    }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,.1)'; e.currentTarget.style.borderColor = '#60a5fa'; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = ''; e.currentTarget.style.borderColor = 'var(--border)'; }}
    >
      {/* Header */}
      <div style={{ padding: '14px 16px 10px', borderBottom: '2px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 900, color: 'var(--text)', marginBottom: 3 }}>{nombre}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text3)', background: 'var(--bg3)', padding: '1px 7px', borderRadius: 6 }}>
              ID {chofer.driverId}
            </span>
            {!chofer.choferMapeado && (
              <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 6, background: '#fff7e0', color: '#78350f', border: '1px solid #f59e0b' }}>
                ⚠ Sin mapear
              </span>
            )}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 22, fontWeight: 900, fontFamily: 'var(--font-mono)', color: '#b87c00' }}>{chofer.rutas}</div>
          <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 700, textTransform: 'uppercase' }}>rutas</div>
        </div>
      </div>

      {/* KPIs grid 2×2 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: '12px 14px 10px' }}>
        {/* Tasa de éxito */}
        <div style={{ background: tasaExito >= 95 ? '#dcfce7' : tasaExito >= 80 ? '#e0f2fe' : '#fff7e0', borderRadius: 10, padding: '10px 12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Tasa éxito</span>
            <NivelBadge pct={tasaExito} />
          </div>
          <div style={{ fontSize: 20, fontWeight: 900, fontFamily: 'var(--font-mono)', color: tasaExito >= 95 ? '#166534' : tasaExito >= 80 ? '#0369a1' : '#b87c00' }}>
            {tasaExito}%
          </div>
          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginTop: 2 }}>
            {fn(chofer.exitosos)} de {fn(chofer.clientesTotal)} visitas
          </div>
          <BarraH valor={chofer.exitosos} max={chofer.clientesTotal}
            color={tasaExito >= 95 ? '#166534' : tasaExito >= 80 ? '#0369a1' : '#b87c00'} />
        </div>

        {/* Adherencia de secuencia */}
        <div style={{ background: '#f8fafc', borderRadius: 10, padding: '10px 12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Secuencia</span>
            <NivelBadge pct={seqPct} />
          </div>
          <div style={{ fontSize: 20, fontWeight: 900, fontFamily: 'var(--font-mono)', color: seqPct >= 65 ? '#0369a1' : '#b87c00' }}>
            {seqPct}%
          </div>
          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginTop: 2 }}>
            {fn(chofer.seqAdhered)} adheridas · {fn(chofer.seqNotAdhered)} no
          </div>
          <BarraH valor={chofer.seqAdhered} max={chofer.seqAdhered + chofer.seqNotAdhered} color="#0369a1" />
        </div>

        {/* Km planeados vs reales */}
        <div style={{ background: '#f8fafc', borderRadius: 10, padding: '10px 12px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 6 }}>Kilómetros</div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 900, fontFamily: 'var(--font-mono)', color: '#5b21b6' }}>{kmPlan}</div>
              <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600 }}>km plan.</div>
            </div>
            {tieneKmReal && (
              <>
                <div style={{ fontSize: 16, color: '#94a3b8', alignSelf: 'center' }}>→</div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 900, fontFamily: 'var(--font-mono)', color: Math.abs(kmDevPct) <= 10 ? '#166534' : '#b91c1c' }}>
                    {kmReal}
                  </div>
                  <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600 }}>km real</div>
                </div>
                {kmDevPct !== null && (
                  <div style={{ alignSelf: 'center', fontSize: 11, fontWeight: 700, padding: '2px 6px', borderRadius: 6,
                    background: Math.abs(kmDevPct) <= 10 ? '#dcfce7' : '#fee2e2',
                    color: Math.abs(kmDevPct) <= 10 ? '#166534' : '#b91c1c' }}>
                    {kmDevPct > 0 ? '+' : ''}{kmDevPct}%
                  </div>
                )}
              </>
            )}
            {!tieneKmReal && <div style={{ fontSize: 11, color: '#94a3b8', alignSelf: 'center', fontStyle: 'italic' }}>Sin datos reales</div>}
          </div>
        </div>

        {/* Paradas no autorizadas + jornada */}
        <div style={{ background: chofer.paradasNoAuth > 5 ? '#fff1f1' : '#f8fafc', borderRadius: 10, padding: '10px 12px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 6 }}>Paradas / Jornada</div>
          <div style={{ display: 'flex', gap: 14 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 900, fontFamily: 'var(--font-mono)', color: chofer.paradasNoAuth > 5 ? '#b91c1c' : '#475569' }}>
                {chofer.paradasNoAuth}
              </div>
              <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600 }}>no-auth.</div>
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 900, fontFamily: 'var(--font-mono)', color: '#0369a1' }}>{hornaJor}hs</div>
              <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600 }}>jornada plan.</div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer - botón detalle */}
      <div style={{ padding: '8px 14px 14px' }}>
        <button onClick={() => onVerDetalle(chofer)}
          style={{ width: '100%', padding: '8px 0', background: 'var(--bg3)', border: '2px solid var(--border)',
            borderRadius: 8, fontSize: 13, fontWeight: 700, color: 'var(--text2)', cursor: 'pointer',
            transition: 'all .15s' }}
          onMouseEnter={e => { e.currentTarget.style.background = '#e8f3ff'; e.currentTarget.style.borderColor = '#60a5fa'; e.currentTarget.style.color = '#1e40af'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg3)'; e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text2)'; }}>
          Ver detalle completo →
        </button>
      </div>
    </div>
  );
};

// ── Modal detalle completo del chofer ─────────────────────────────────────────
const ModalDetalleChofer = ({ chofer, onCerrar }) => {
  if (!chofer) return null;
  const nombre      = chofer.choferMapeado || chofer.driverName || `Driver ${chofer.driverId}`;
  const tasaExito   = chofer.tasaExito;
  const seqPct      = Math.round(chofer.seqAdherenceAvg * 100);
  const kmPlan      = MTS_A_KM(chofer.kmPlanMetros);
  const kmReal      = MTS_A_KM(chofer.kmRealMetros);
  const minPlanCond = SEG_A_MIN(chofer.segConduccionPlan);
  const minRealCond = SEG_A_MIN(chofer.segConduccionReal);
  const hsPlanJorn  = SEG_A_HS(chofer.segJornadaPlan);
  const hsRealJorn  = SEG_A_HS(chofer.segJornadaReal);
  const minParNoAuth = SEG_A_MIN(chofer.paradasNoAuthSecs);

  const seccionStyle = {
    background: 'var(--bg3)', border: '2px solid var(--border)', borderRadius: 12,
    padding: '14px 16px', marginBottom: 14,
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(10,16,32,.55)', backdropFilter: 'blur(4px)',
      zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={e => e.target === e.currentTarget && onCerrar()}>
      <div style={{ background: '#fff', borderRadius: 22, maxWidth: 680, width: '100%',
        maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,.2)' }}>

        {/* Header */}
        <div style={{ background: 'linear-gradient(135deg, #0369a1, #0284c7)', padding: '22px 24px', color: '#fff', borderRadius: '22px 22px 0 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 900, marginBottom: 4 }}>🚛 {nombre}</div>
              <div style={{ fontSize: 13, opacity: 0.85, fontWeight: 600 }}>
                Driver ID: {chofer.driverId} · {chofer.rutas} rutas analizadas
              </div>
            </div>
            <button onClick={onCerrar}
              style={{ background: 'rgba(255,255,255,.2)', border: 'none', color: '#fff', borderRadius: 8,
                width: 34, height: 34, fontSize: 20, cursor: 'pointer', fontWeight: 900 }}>×</button>
          </div>
        </div>

        <div style={{ padding: '20px 24px' }}>

          {/* KPIs superiores */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 16 }}>
            <KpiMini icon="✅" label="Tasa éxito" value={`${tasaExito}%`}
              sub={`${fn(chofer.exitosos)}/${fn(chofer.clientesTotal)}`}
              color={tasaExito >= 95 ? '#166534' : '#b87c00'}
              bg={tasaExito >= 95 ? '#dcfce7' : '#fff7e0'} border={tasaExito >= 95 ? '#86efac' : '#fcd34d'} />
            <KpiMini icon="📋" label="Adherencia" value={`${seqPct}%`}
              sub={`${fn(chofer.seqAdhered)} adheri.`}
              color="#0369a1" bg="#e0f2fe" border="#7dd3fc" />
            <KpiMini icon="❌" label="Visitas fail." value={fn(chofer.fallidos)}
              sub={chofer.fallidos > 0 ? `${PCT(chofer.fallidos, chofer.clientesTotal)}%` : 'Sin fallas'}
              color={chofer.fallidos > 0 ? '#b91c1c' : '#166534'}
              bg={chofer.fallidos > 0 ? '#fee2e2' : '#dcfce7'}
              border={chofer.fallidos > 0 ? '#fca5a5' : '#86efac'} />
            <KpiMini icon="🛑" label="Paradas N/A" value={fn(chofer.paradasNoAuth)}
              sub={`${minParNoAuth} min`}
              color={chofer.paradasNoAuth > 5 ? '#b91c1c' : '#475569'}
              bg={chofer.paradasNoAuth > 5 ? '#fee2e2' : '#f8fafc'}
              border={chofer.paradasNoAuth > 5 ? '#fca5a5' : '#e2e8f0'} />
          </div>

          {/* Sección: Kilómetros */}
          <div style={seccionStyle}>
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 12 }}>
              📍 Kilómetros — planeado vs real
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600, marginBottom: 4 }}>Conducción</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 24, fontWeight: 900, fontFamily: 'var(--font-mono)', color: '#5b21b6' }}>{kmPlan}</span>
                  <span style={{ fontSize: 13, color: 'var(--text3)', fontWeight: 600 }}>km plan.</span>
                  {chofer.kmRealMetros > 0 && (
                    <>
                      <span style={{ fontSize: 16, color: '#94a3b8' }}>→</span>
                      <span style={{ fontSize: 24, fontWeight: 900, fontFamily: 'var(--font-mono)', color: '#1e40af' }}>{kmReal}</span>
                      <span style={{ fontSize: 13, color: 'var(--text3)', fontWeight: 600 }}>km real</span>
                    </>
                  )}
                </div>
                {chofer.kmRealMetros > 0 && (
                  <BarraH valor={chofer.kmRealMetros} max={Math.max(chofer.kmRealMetros, chofer.kmPlanMetros)} color="#1e40af" />
                )}
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600, marginBottom: 4 }}>Tiempo conducción</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 24, fontWeight: 900, fontFamily: 'var(--font-mono)', color: '#5b21b6' }}>{minPlanCond}</span>
                  <span style={{ fontSize: 13, color: 'var(--text3)', fontWeight: 600 }}>min plan.</span>
                  {chofer.segConduccionReal > 0 && (
                    <>
                      <span style={{ fontSize: 16, color: '#94a3b8' }}>→</span>
                      <span style={{ fontSize: 24, fontWeight: 900, fontFamily: 'var(--font-mono)', color: '#1e40af' }}>{minRealCond}</span>
                      <span style={{ fontSize: 13, color: 'var(--text3)', fontWeight: 600 }}>min real</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Sección: Jornada */}
          <div style={seccionStyle}>
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 12 }}>
              ⏱ Jornada total — planeado vs real
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <div style={{ fontSize: 28, fontWeight: 900, fontFamily: 'var(--font-mono)', color: '#0369a1' }}>{hsPlanJorn} hs</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600 }}>jornada planeada promedio</div>
              </div>
              {chofer.segJornadaReal > 0 && (
                <div>
                  <div style={{ fontSize: 28, fontWeight: 900, fontFamily: 'var(--font-mono)', color: '#166534' }}>{hsRealJorn} hs</div>
                  <div style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600 }}>jornada real promedio</div>
                </div>
              )}
            </div>
          </div>

          {/* Sección: Secuencia detallada */}
          <div style={seccionStyle}>
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 12 }}>
              📋 Adherencia de secuencia — detalle
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 12 }}>
              {[
                { label: 'Adheridas',    val: chofer.seqAdheridas,   color: '#166534', bg: '#dcfce7' },
                { label: 'No adheridas', val: chofer.seqNoAdheridas, color: '#b91c1c', bg: '#fee2e2' },
                { label: 'Perdonadas',   val: chofer.seqPerdonadas,  color: '#b87c00', bg: '#fff7e0' },
                { label: 'Promedio',     val: `${seqPct}%`,         color: '#0369a1', bg: '#e0f2fe' },
              ].map(k => (
                <div key={k.label} style={{ background: k.bg, borderRadius: 10, padding: '10px 12px', textAlign: 'center' }}>
                  <div style={{ fontSize: 16, fontWeight: 900, fontFamily: 'var(--font-mono)', color: k.color }}>{typeof k.val === 'number' ? fn(k.val) : k.val}</div>
                  <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', marginTop: 3 }}>{k.label}</div>
                </div>
              ))}
            </div>
            {/* Barra de distribución */}
            <div style={{ height: 18, borderRadius: 9, overflow: 'hidden', display: 'flex', border: '1px solid var(--border)' }}>
              {chofer.seqAdheridas > 0 && <div style={{ flex: chofer.seqAdheridas, background: '#166534' }} />}
              {chofer.seqNoAdheridas > 0 && <div style={{ flex: chofer.seqNoAdheridas, background: '#b91c1c' }} />}
              {chofer.seqPerdonadas > 0 && <div style={{ flex: chofer.seqPerdonadas, background: '#b87c00' }} />}
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: 11, fontWeight: 700 }}>
              <span style={{ color: '#166534' }}>✓ Adheridas: {PCT(chofer.seqAdheridas, chofer.totalVisitas)}%</span>
              <span style={{ color: '#b91c1c' }}>✗ No adh.: {PCT(chofer.seqNoAdheridas, chofer.totalVisitas)}%</span>
            </div>
          </div>

          {/* Click Score */}
          <div style={{ ...seccionStyle, marginBottom: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 10 }}>
              🖱 Driver Click Score (promedio)
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ fontSize: 32, fontWeight: 900, fontFamily: 'var(--font-mono)', color: '#5b21b6' }}>
                {(chofer.clickScoreAvg * 100).toFixed(0)}%
              </div>
              <div>
                <BarraH valor={chofer.clickScoreAvg * 100} max={100} color="#5b21b6" altura={12} />
                <div style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600, marginTop: 4 }}>
                  Proporción de clicks registrados correctamente en las rutas digitales
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

// ── Tabla comparativa entre choferes ─────────────────────────────────────────
const TablaComparativa = ({ choferes, onVerDetalle }) => {
  const [sortBy, setSortBy] = useState('tasaExito');
  const [sortDir, setSortDir] = useState('desc');

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortBy(col); setSortDir('desc'); }
  };

  const sorted = useMemo(() => {
    return [...choferes].sort((a, b) => {
      const va = a[sortBy] ?? 0;
      const vb = b[sortBy] ?? 0;
      return sortDir === 'desc' ? vb - va : va - vb;
    });
  }, [choferes, sortBy, sortDir]);

  const Th = ({ col, label }) => (
    <th onClick={() => toggleSort(col)}
      style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
        color: sortBy === col ? 'var(--accent)' : 'inherit' }}>
      {label} {sortBy === col ? (sortDir === 'desc' ? '▼' : '▲') : ''}
    </th>
  );

  // Calcular totales
  const totales = useMemo(() => {
    if (sorted.length === 0) return null;
    return {
      rutas: sorted.reduce((s, ch) => s + (ch.rutas || 0), 0),
      clientesTotal: sorted.reduce((s, ch) => s + (ch.clientesTotal || 0), 0),
      tasaExito: sorted.length > 0 ? Math.round(sorted.reduce((s, ch) => s + (ch.tasaExito || 0), 0) / sorted.length) : 0,
      seqAdherenceAvg: sorted.length > 0 ? Math.round(sorted.reduce((s, ch) => s + (ch.seqAdherenceAvg * 100 || 0), 0) / sorted.length) : 0,
      kmPlanMetros: sorted.reduce((s, ch) => s + (ch.kmPlanMetros || 0), 0),
      kmRealMetros: sorted.reduce((s, ch) => s + (ch.kmRealMetros || 0), 0),
      paradasNoAuth: sorted.reduce((s, ch) => s + (ch.paradasNoAuth || 0), 0),
      segJornadaPlan: sorted.reduce((s, ch) => s + (ch.segJornadaPlan || 0), 0),
    };
  }, [sorted]);

  return (
    <div className="table-wrap">
      <table className="dash-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Chofer</th>
            <Th col="rutas"           label="Rutas" />
            <Th col="clientesTotal"   label="Visitas" />
            <Th col="tasaExito"       label="% Éxito" />
            <Th col="seqAdherenceAvg" label="Seq. Adh." />
            <Th col="kmPlanMetros"    label="Km plan." />
            <Th col="kmRealMetros"    label="Km real" />
            <Th col="paradasNoAuth"   label="Paradas N/A" />
            <th>Jornada plan.</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((ch, i) => {
            const nombre   = ch.choferMapeado || ch.driverName || `Driver ${ch.driverId}`;
            const tasaExito = ch.tasaExito;
            const seqPct   = Math.round(ch.seqAdherenceAvg * 100);
            return (
              <tr key={ch.driverId}>
                <td style={{ fontWeight: 800, color: 'var(--text3)' }}>{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</td>
                <td>
                  <div style={{ fontWeight: 700 }}>{nombre}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>ID {ch.driverId}</div>
                </td>
                <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#b87c00' }}>{ch.rutas}</td>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{fn(ch.clientesTotal)}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 900,
                      color: tasaExito >= 95 ? '#166534' : tasaExito >= 80 ? '#0369a1' : '#b91c1c' }}>
                      {tasaExito}%
                    </span>
                    <NivelBadge pct={tasaExito} />
                  </div>
                </td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 900, color: seqPct >= 65 ? '#0369a1' : '#b87c00' }}>
                      {seqPct}%
                    </span>
                    <NivelBadge pct={seqPct} />
                  </div>
                </td>
                <td style={{ fontFamily: 'var(--font-mono)', color: '#5b21b6' }}>{MTS_A_KM(ch.kmPlanMetros)} km</td>
                <td style={{ fontFamily: 'var(--font-mono)', color: ch.kmRealMetros > 0 ? '#1e40af' : '#94a3b8' }}>
                  {ch.kmRealMetros > 0 ? `${MTS_A_KM(ch.kmRealMetros)} km` : '—'}
                </td>
                <td>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 900,
                    color: ch.paradasNoAuth > 5 ? '#b91c1c' : '#475569' }}>
                    {ch.paradasNoAuth}
                  </span>
                </td>
                <td style={{ fontFamily: 'var(--font-mono)', color: '#0369a1' }}>{SEG_A_HS(ch.segJornadaPlan)} hs</td>
                <td>
                  <button onClick={() => onVerDetalle(ch)}
                    style={{ padding: '4px 12px', background: '#e8f3ff', border: '2px solid #60a5fa',
                      borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer', color: '#1e40af' }}>
                    Ver →
                  </button>
                </td>
              </tr>
            );
          })}
          {/* Fila de totales */}
          {totales && sorted.length > 0 && (
            <tr style={{ background: '#f0f9ff', borderTop: '3px solid #60a5fa', fontWeight: 700 }}>
              <td style={{ color: '#0369a1', fontWeight: 800 }}>📊</td>
              <td style={{ color: '#0369a1', fontWeight: 800 }}>TOTAL ({sorted.length})</td>
              <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 900, color: '#0369a1' }}>{totales.rutas}</td>
              <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 900, color: '#0369a1' }}>{fn(totales.clientesTotal)}</td>
              <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 900, color: '#166534' }}>{totales.tasaExito}%</td>
              <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 900, color: '#0369a1' }}>{totales.seqAdherenceAvg}%</td>
              <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 900, color: '#5b21b6' }}>{MTS_A_KM(totales.kmPlanMetros)} km</td>
              <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 900, color: '#1e40af' }}>{MTS_A_KM(totales.kmRealMetros)} km</td>
              <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 900, color: '#b91c1c' }}>{totales.paradasNoAuth}</td>
              <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 900, color: '#0369a1' }}>{SEG_A_HS(totales.segJornadaPlan)} hs</td>
              <td></td>
            </tr>
          )}
          {sorted.length === 0 && (
            <tr><td colSpan={11} className="empty-state">Sin datos</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ══════════════════════════════════════════════════════════════════════════════
export const TFoxtrot = ({ cfg = {}, mes: mesProp, setMes: setMesProp, kpisExternos, kpisAllForRanking, cargandoExterno, loggedInUser, mesesGlobales = [] }) => {
  // ── Mes seleccionado ──────────────────────────────────────────────────────
  // Si viene mes/setMes del padre (App.js via handleSetMes) los usamos,
  // sino manejamos estado propio. En ambos casos el cambio de mes recarga KPIs.
  const [mesLocal, setMesLocal] = useState(mesActual);
  const mes    = mesProp    ?? mesLocal;
  const setMes = setMesProp ?? setMesLocal;

  // ── Estado de carga de archivos ───────────────────────────────────────────
  const [routeRows,     setRouteRows]     = useState(null);
  const [attemptRows,   setAttemptRows]   = useState(null);
  const [routeNombre,   setRouteNombre]   = useState('');
  const [attemptNombre, setAttemptNombre] = useState('');
  const [cargandoRoute, setCargandoRoute] = useState(false);
  const [cargandoAtt,   setCargandoAtt]   = useState(false);

  // ── Estado de la app ──────────────────────────────────────────────────────
  // Para choferes/ayudantes, la tab por defecto es 'choferes' (verán sus KPIs)
  // Para admin, la tab por defecto es 'importar'
  const tabDefault = (!loggedInUser || loggedInUser.role === 'admin') ? 'importar' : 'choferes';
  const [tab,           setTab]           = useState(tabDefault);
  const [kpis,          setKpis]          = useState([]);
  const [historial,     setHistorial]     = useState([]);
  const [cargandoKpis,  setCargandoKpis]  = useState(false);
  const [cargandoHist,  setCargandoHist]  = useState(false);
  const [guardando,     setGuardando]     = useState(false);
  const [yaGuardado,    setYaGuardado]    = useState(false);
  const [archivoDup,    setArchivoDup]    = useState(null);
  const [toast,         setToast]         = useState(null);
  const [choferDetalle, setChoferDetalle] = useState(null);
  const [filtroChofer,  setFiltroChofer]  = useState('');
  const [eliminando,    setEliminando]    = useState(null);

  const driverMap = cfg.driverMap || [];
  const notify = (msg, tipo = 'ok') => {
    setToast({ msg, tipo });
    setTimeout(() => setToast(null), 3500);
  };

  // ── Meses disponibles — construidos desde el historial de Foxtrot ────────
  // FIX: antes solo usaba historial (que puede estar vacío al montar).
  // Ahora también incluye el mes actual y, si el padre pasó un mes válido,
  // lo garantiza como opción para que el selector nunca quede vacío.
  const mesesDisponibles = useMemo(() => {
    if (mesesGlobales && mesesGlobales.length > 0) {
      return mesesGlobales.map(v => ({ value: v, label: labelMes(v) }));
    }
    const hoy = new Date();
    const mesHoy = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
    const conDatos = new Set([
      ...historial.map(h => (h.fechaDesde || '').slice(0, 7)).filter(m => m.length === 7),
      ...historial.map(h => (h.fechaHasta || '').slice(0, 7)).filter(m => m.length === 7),
      mesHoy,
      mes,
    ].filter(Boolean));
    return [...conDatos]
      .sort((a, b) => b.localeCompare(a))
      .slice(0, 18)
      .map(v => ({ value: v, label: labelMes(v) }));
  }, [historial, mes, mesesGlobales]);

  // ── Cargar historial ──────────────────────────────────────────────────────
  const cargarHistorial = useCallback(async () => {
    setCargandoHist(true);
    try {
      const arr = await getFoxtrotArchivos();
      setHistorial(Array.isArray(arr) ? arr : []);
    } catch { setHistorial([]); }
    setCargandoHist(false);
  }, []);

  // ── Cargar KPIs desde Neon — filtrado por mes ─────────────────────────────
  // FIX: esta es la función clave. Siempre pasa { mes } al endpoint para que
  // el backend filtre por el período correcto. Se llama al montar Y cada vez
  // que cambia `mes` (ya sea porque el usuario lo cambia acá o porque App.js
  // lo propaga via handleSetMes).
  const cargarKpis = useCallback(async (filtros = {}) => {
    setCargandoKpis(true);
    try {
      const data = await getFoxtrotKpisPorChofer(filtros);
      setKpis(Array.isArray(data) ? data : []);
    } catch { setKpis([]); }
    setCargandoKpis(false);
  }, []);

  // Carga inicial del historial (una sola vez)
  useEffect(() => {
    cargarHistorial();
  }, [cargarHistorial]);

  // Resetear tab cuando cambia el rol del usuario
  useEffect(() => {
    const tabDefault = (!loggedInUser || loggedInUser.role === 'admin') ? 'importar' : 'choferes';
    setTab(tabDefault);
  }, [loggedInUser?.role]);

  // Recargar KPIs cada vez que cambia el mes — CONEXIÓN REAL CON DATOS
  // Si kpisExternos vienen del padre (App.js), úsalos directamente
  useEffect(() => {
    if (kpisExternos && Array.isArray(kpisExternos)) {
      setKpis(kpisExternos);
      setCargandoKpis(cargandoExterno === true);
    } else {
      cargarKpis({ mes });
    }
  }, [cargarKpis, mes, kpisExternos, cargandoExterno]);

  // ── Procesar archivo CSV ──────────────────────────────────────────────────
  const procesarCSV = (file, setRows, setNombre, setCargando, tipoEsperado) => {
    setCargando(true);
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const rows = parsearCSV(e.target.result);
        if (!rows.length) throw new Error('El archivo está vacío o no tiene datos válidos');
        const tipo = detectarTipoCSV(rows);
        if (tipo && tipo !== tipoEsperado) {
          notify(`⚠ Este parece ser el CSV de ${tipo === 'route' ? 'Route Analytics' : 'Attempt Analytics'} — lo estás subiendo en la zona equivocada`, 'err');
        }
        setRows(rows);
        setNombre(file.name);
        setYaGuardado(false);
        setArchivoDup(null);
        notify(`✓ ${file.name} — ${fn(rows.length)} filas cargadas`);
      } catch (err) {
        notify(`❌ Error: ${err.message}`, 'err');
      }
      setCargando(false);
    };
    reader.onerror = () => { notify('❌ No se pudo leer el archivo', 'err'); setCargando(false); };
    reader.readAsText(file, 'UTF-8');
  };

  // ── Verificar duplicado y guardar ─────────────────────────────────────────
  const verificarYGuardar = async (forzar = false) => {
    if (!routeRows) return notify('⚠ Subí al menos el CSV de Route Analytics', 'err');

    const archivoNombre = routeNombre || `foxtrot_${new Date().toISOString().slice(0, 10)}`;

    if (!forzar) {
      try {
        const { existe, cantidad } = await verificarArchivoFoxtrot(archivoNombre);
        if (existe) {
          setArchivoDup({ nombre: archivoNombre, cantidad });
          return;
        }
      } catch { /* continuar igual */ }
    }

    setGuardando(true);
    try {
      await importarFoxtrot(
        routeRows,
        attemptRows || [],
        archivoNombre,
        driverMap,
      );
      setYaGuardado(true);
      setArchivoDup(null);
      notify(`✓ Guardado en Neon — ${fn(routeRows.length)} rutas${attemptRows ? ` · ${fn(attemptRows.length)} intentos` : ''}`);

      // Extraer mes del primer row para forzar la carga de los datos correctos
      const mesDelCsv = routeRows[0]?.['Planned Route Start Date']?.slice(0, 7);
      if (mesDelCsv) setMes(mesDelCsv);

      await cargarHistorial();
      await cargarKpis({ mes: mesDelCsv || mes });
      setTab('choferes');
    } catch (err) {
      notify(`❌ Error al guardar: ${err.message}`, 'err');
    }
    setGuardando(false);
  };

  const eliminarArchivo = async (nombre) => {
    if (!window.confirm(`¿Eliminar TODOS los datos del archivo "${nombre}"?\n\nEsta acción no se puede deshacer.`)) return;
    setEliminando(nombre);
    try {
      await eliminarArchivoFoxtrot(nombre);
      setHistorial(prev => prev.filter(h => h.archivo !== nombre));
      await cargarKpis({ mes });
      notify(`✓ Archivo "${nombre}" eliminado`);
    } catch (err) { notify('❌ ' + err.message, 'err'); }
    setEliminando(null);
  };

  // ── Unificar choferes por nombre/apellido o choferMapeado ───────────────
  const kpisUnificados = useMemo(() => {
    const t = {};
    const normalizar = (v) => String(v || '').trim().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\s+/g, ' ').toLowerCase();
    const sum = (v) => Number(v) || 0;

    kpis.forEach(ch => {
      const displayName = ch.choferMapeado || ch.driverName || `Driver ${ch.driverId}`;
      const key = normalizar(displayName);
      if (!key) return;

      if (!t[key]) {
        t[key] = {
          ...ch,
          choferMapeado: ch.choferMapeado || ch.driverName || null,
          clickScoreSum: (sum(ch.clickScoreAvg) * sum(ch.rutas)),
        };
        return;
      }

      const dst = t[key];
      dst.rutas += sum(ch.rutas);
      dst.clientesTotal += sum(ch.clientesTotal);
      dst.exitosos += sum(ch.exitosos);
      dst.fallidos += sum(ch.fallidos);
      dst.kmPlanMetros += sum(ch.kmPlanMetros);
      dst.kmRealMetros += sum(ch.kmRealMetros);
      dst.segConduccionPlan += sum(ch.segConduccionPlan);
      dst.segConduccionReal += sum(ch.segConduccionReal);
      dst.segJornadaPlan += sum(ch.segJornadaPlan);
      dst.segJornadaReal += sum(ch.segJornadaReal);
      dst.seqAdhered += sum(ch.seqAdhered);
      dst.seqNotAdhered += sum(ch.seqNotAdhered);
      dst.paradasNoAuth += sum(ch.paradasNoAuth);
      dst.paradasNoAuthSecs += sum(ch.paradasNoAuthSecs);
      dst.totalVisitas += sum(ch.totalVisitas);
      dst.visitasOk += sum(ch.visitasOk);
      dst.visitasFail += sum(ch.visitasFail);
      dst.seqAdheridas += sum(ch.seqAdheridas);
      dst.seqNoAdheridas += sum(ch.seqNoAdheridas);
      dst.seqPerdonadas += sum(ch.seqPerdonadas);
      dst.clickScoreSum += (sum(ch.clickScoreAvg) * sum(ch.rutas));
    });

    return Object.values(t).map(ch => {
      const totalSeq = sum(ch.seqAdhered) + sum(ch.seqNotAdhered);
      return {
        ...ch,
        tasaExito: ch.clientesTotal > 0 ? Math.round((ch.exitosos / ch.clientesTotal) * 100) : 0,
        seqAdherenceAvg: totalSeq > 0 ? ch.seqAdhered / totalSeq : 0,
        clickScoreAvg: ch.rutas > 0 ? Number((ch.clickScoreSum / ch.rutas).toFixed(2)) : 0,
      };
    }).sort((a, b) => b.rutas - a.rutas);
  }, [kpis]);

  // ── Choferes filtrados para la vista ──────────────────────────────────────
  const kpisFiltrados = useMemo(() => {
    if (!filtroChofer) return kpisUnificados;
    const b = filtroChofer.toLowerCase();
    return kpisUnificados.filter(k =>
      (k.choferMapeado || '').toLowerCase().includes(b) ||
      (k.driverName   || '').toLowerCase().includes(b) ||
      String(k.driverId).includes(b)
    );
  }, [kpisUnificados, filtroChofer]);

  // ── KPIs globales del período ──────────────────────────────────────────────
  const kpisGlobales = useMemo(() => {
    if (!kpisUnificados.length) return null;
    const total = kpisUnificados.reduce((acc, k) => ({
      rutas:         acc.rutas         + k.rutas,
      clientes:      acc.clientes      + k.clientesTotal,
      exitosos:      acc.exitosos      + k.exitosos,
      fallidos:      acc.fallidos      + k.fallidos,
      kmPlan:        acc.kmPlan        + k.kmPlanMetros,
      kmReal:        acc.kmReal        + k.kmRealMetros,
      paradasNoAuth: acc.paradasNoAuth + k.paradasNoAuth,
      seqAdhered:    acc.seqAdhered    + k.seqAdhered,
      seqNotAdh:     acc.seqNotAdh     + k.seqNotAdhered,
    }), { rutas: 0, clientes: 0, exitosos: 0, fallidos: 0, kmPlan: 0, kmReal: 0, paradasNoAuth: 0, seqAdhered: 0, seqNotAdh: 0 });
    return {
      ...total,
      choferes:   kpis.length,
      tasaExito:  PCT(total.exitosos, total.clientes),
      seqPct:     PCT(total.seqAdhered, total.seqAdhered + total.seqNotAdh),
    };
  }, [kpis]);

  // ── Manejador de cambio de mes ────────────────────────────────────────────
  // FIX: llama a setMes (que puede ser handleSetMes del padre o setMesLocal).
  // El useEffect de arriba se dispara automáticamente y recarga los KPIs.
  const handleCambioMes = (nuevoMes) => {
    setMes(nuevoMes);
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="dash-container">

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          background: toast.tipo === 'err' ? '#b91c1c' : '#166534', color: '#fff',
          padding: '13px 22px', borderRadius: 14, fontSize: 14, fontWeight: 700,
          boxShadow: '0 8px 32px rgba(0,0,0,.2)', maxWidth: 420, animation: 'fadeIn .2s' }}>
          {toast.msg}
        </div>
      )}

      {/* Header con selector de mes */}
      <div className="dash-header">
        <div>
          <h2 className="dash-title">Foxtrot Analytics</h2>
          <p className="dash-sub">Route Analytics · Attempt Analytics · KPIs por chofer</p>
        </div>
        {/* Selector de mes — sincronizado con los datos reales */}
        <div className="dash-header-right">
          <select
            value={mes}
            onChange={e => handleCambioMes(e.target.value)}
            style={{ padding: '6px 12px', borderRadius: 8, border: '1.5px solid #e5b84b',
              fontWeight: 600, fontSize: 14, background: '#fff', cursor: 'pointer' }}
          >
            {mesesDisponibles.length > 0
              ? mesesDisponibles.map(o => <option key={o.value} value={o.value}>{o.label}</option>)
              : <option value={mes}>{labelMes(mes)}</option>
            }
          </select>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, background: 'var(--bg2)', padding: '10px 14px',
        borderRadius: 'var(--radius-lg)', border: '2px solid var(--border)', flexWrap: 'wrap' }}>
        {[
          { id: 'importar',  label: '📥 Importar' },
          { id: 'choferes',  label: `🚛 Por chofer${kpis.length ? ` (${kpis.length})` : ''}` },
          { id: 'ranking',   label: '📊 Ranking' },
          { id: 'historial', label: `📋 Historial${historial.length ? ` (${historial.length})` : ''}` },
        ]
        // Filtrar tabs según rol: solo admin ve "Importar" e "Historial"
        .filter(t => {
          if (!loggedInUser || loggedInUser.role === 'admin') return true; // Admin ve todas
          // Chofer/Ayudante solo ven "Por chofer" y "Ranking"
          return ['choferes', 'ranking'].includes(t.id);
        })
        .map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: '8px 18px', borderRadius: 10, border: 'none', cursor: 'pointer',
              fontFamily: 'var(--font-head)', fontSize: 14, fontWeight: 700,
              background: tab === t.id ? '#0369a1' : 'var(--bg3)',
              color: tab === t.id ? '#fff' : 'var(--text2)' }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ══ TAB IMPORTAR ══════════════════════════════════════════════════════ */}
      {tab === 'importar' && (
        <>
          {/* Instrucciones */}
          <div style={{ background: '#e8f3ff', border: '2px solid #60a5fa', borderRadius: 14,
            padding: '14px 18px', display: 'flex', gap: 14 }}>
            <span style={{ fontSize: 24, flexShrink: 0 }}>📋</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#1e40af', marginBottom: 4 }}>
                Cómo importar datos de Foxtrot
              </div>
              <div style={{ fontSize: 13, color: '#1e3a8a', fontWeight: 600, lineHeight: 1.7 }}>
                Exportá desde Foxtrot los reportes <strong>Route Analytics</strong> y <strong>Attempt Analytics</strong> en formato CSV.
                Podés subir solo el Route Analytics — el Attempt Analytics es opcional pero suma detalle por visita.
                Los choferes se resuelven automáticamente usando el <strong>Mapeo Driver ID</strong> que configuraste en Config.
              </div>
            </div>
          </div>

          {/* Zonas de carga */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <DropZone label="Route Analytics" accept=".csv" icon="🗺" color="#0369a1"
              desc="CSV con rutas, distancias planeadas vs reales y paradas"
              onFile={f => procesarCSV(f, setRouteRows, setRouteNombre, setCargandoRoute, 'route')}
              loading={cargandoRoute} fileName={routeNombre} />
            <DropZone label="Attempt Analytics" accept=".csv" icon="📍" color="#5b21b6"
              desc="CSV con visitas individuales por cliente y adherencia de secuencia"
              onFile={f => procesarCSV(f, setAttemptRows, setAttemptNombre, setCargandoAtt, 'attempt')}
              loading={cargandoAtt} fileName={attemptNombre} />
          </div>

          {/* Vista previa */}
          {routeRows && (
            <div style={{ background: 'var(--bg2)', border: '2px solid var(--border)', borderRadius: 14, padding: '16px 18px' }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text2)', marginBottom: 12 }}>
                📊 Vista previa — datos listos para guardar
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 14 }}>
                {[
                  { icon: '🗺', label: 'Rutas',    value: fn(routeRows.length),            color: '#0369a1', bg: '#e0f2fe' },
                  { icon: '📍', label: 'Intentos', value: fn(attemptRows?.length || 0),    color: '#5b21b6', bg: '#ede9fe' },
                  { icon: '🚛', label: 'Choferes', value: fn(new Set(routeRows.map(r => r['Driver ID'])).size), color: '#b87c00', bg: '#fff7e0' },
                  { icon: '📅', label: 'Rango',    value: (() => {
                    const fechas = routeRows.map(r => r['Planned Route Start Date']).filter(Boolean).sort();
                    if (!fechas.length) return '—';
                    const d1 = fechas[0].slice(0, 10);
                    const d2 = fechas[fechas.length - 1].slice(0, 10);
                    return d1 === d2 ? d1 : `${d1} → ${d2}`;
                  })(), color: '#166534', bg: '#dcfce7' },
                ].map(k => (
                  <div key={k.label} style={{ background: k.bg, borderRadius: 10, padding: '12px', textAlign: 'center' }}>
                    <div style={{ fontSize: 20 }}>{k.icon}</div>
                    <div style={{ fontSize: 16, fontWeight: 900, fontFamily: 'var(--font-mono)', color: k.color, margin: '4px 0' }}>{k.value}</div>
                    <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>{k.label}</div>
                  </div>
                ))}
              </div>

              {/* Aviso drivers sin mapear */}
              {(() => {
                const ids = new Set(routeRows.map(r => String(r['Driver ID'] ?? '')));
                const mapeados = new Set(driverMap.map(d => String(d.id)));
                const sinMapear = [...ids].filter(id => id && !mapeados.has(id));
                if (sinMapear.length === 0) return null;
                return (
                  <div style={{ background: '#fff7e0', border: '2px solid #f59e0b', borderRadius: 10, padding: '10px 14px', marginBottom: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#78350f', marginBottom: 4 }}>
                      ⚠ {sinMapear.length} Driver ID{sinMapear.length > 1 ? 's' : ''} sin mapear
                    </div>
                    <div style={{ fontSize: 12, color: '#92400e', fontWeight: 600 }}>
                      IDs: {sinMapear.join(', ')} — Andá a <strong>Config → Mapeo Driver ID</strong> para asignarles nombre.
                      Los datos se guardan igual, solo se mostrará el ID numérico.
                    </div>
                  </div>
                );
              })()}

              {/* Alerta duplicado */}
              {archivoDup && (
                <div style={{ background: '#fff7e0', border: '2px solid #f59e0b', borderRadius: 10, padding: '12px 16px', marginBottom: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#78350f', marginBottom: 6 }}>
                    ⚠ El archivo "{archivoDup.nombre}" ya tiene {fn(archivoDup.cantidad)} rutas guardadas
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button onClick={() => verificarYGuardar(true)}
                      style={{ padding: '7px 16px', background: '#b91c1c', color: '#fff', border: 'none',
                        borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                      ⚠ Guardar igual (duplica datos)
                    </button>
                    <button onClick={() => setArchivoDup(null)}
                      style={{ padding: '7px 16px', background: '#f1f5f9', border: '2px solid #e2e8f0',
                        borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', color: '#475569' }}>
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              <button
                onClick={() => verificarYGuardar(false)}
                disabled={guardando || yaGuardado}
                style={{
                  padding: '10px 28px', fontSize: 14, fontWeight: 800, borderRadius: 10, border: 'none',
                  cursor: (guardando || yaGuardado) ? 'not-allowed' : 'pointer',
                  background: guardando ? '#64748b' : yaGuardado ? '#0369a1' : '#166534',
                  color: '#fff', transition: 'background .2s',
                }}>
                {guardando ? '⏳ Guardando en Neon...' : yaGuardado ? '✅ Guardado' : '💾 Guardar en Neon'}
              </button>
            </div>
          )}

          {/* Estado vacío */}
          {!routeRows && (
            <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text3)' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>📂</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text2)', marginBottom: 8 }}>
                Subí los CSV de Foxtrot
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, maxWidth: 440, margin: '0 auto', lineHeight: 1.7 }}>
                Exportá los reportes desde Foxtrot y arrastrá los archivos arriba.
                Los datos se guardarán en Neon y estarán disponibles desde cualquier dispositivo.
              </div>
            </div>
          )}
        </>
      )}

      {/* ══ TAB CHOFERES ══════════════════════════════════════════════════════ */}
      {tab === 'choferes' && (
        <>
          {/* KPIs globales */}
          {kpisGlobales && (
            <div style={{ background: 'var(--bg2)', border: '2px solid var(--border)', borderRadius: 14, padding: '16px 18px' }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 12 }}>
                Resumen global — {labelMes(mes)}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 10 }}>
                <KpiMini icon="🚛" label="Choferes"  value={kpisGlobales.choferes}  color="#0369a1" bg="#e0f2fe" border="#7dd3fc" />
                <KpiMini icon="🗺" label="Rutas"     value={fn(kpisGlobales.rutas)}  color="#b87c00" bg="#fff7e0" border="#fcd34d" />
                <KpiMini icon="📍" label="Visitas"   value={fn(kpisGlobales.clientes)} color="#475569" bg="#f8fafc" border="#e2e8f0" />
                <KpiMini icon="✅" label="% Éxito"   value={`${kpisGlobales.tasaExito}%`}
                  color={kpisGlobales.tasaExito >= 95 ? '#166534' : '#b87c00'}
                  bg={kpisGlobales.tasaExito >= 95 ? '#dcfce7' : '#fff7e0'}
                  border={kpisGlobales.tasaExito >= 95 ? '#86efac' : '#fcd34d'} />
                <KpiMini icon="📋" label="Seq. Adh." value={`${kpisGlobales.seqPct}%`} color="#0369a1" bg="#e0f2fe" border="#7dd3fc" />
                <KpiMini icon="🛑" label="Paradas N/A" value={fn(kpisGlobales.paradasNoAuth)}
                  color={kpisGlobales.paradasNoAuth > 20 ? '#b91c1c' : '#475569'}
                  bg={kpisGlobales.paradasNoAuth > 20 ? '#fee2e2' : '#f8fafc'}
                  border={kpisGlobales.paradasNoAuth > 20 ? '#fca5a5' : '#e2e8f0'} />
              </div>
            </div>
          )}

          {/* Filtro */}
          <div className="filter-bar">
            <input className="filter-input"
              placeholder="🔍 Buscar chofer por nombre o Driver ID..."
              value={filtroChofer} onChange={e => setFiltroChofer(e.target.value)} />
            {filtroChofer && (
              <button onClick={() => setFiltroChofer('')}
                style={{ padding: '8px 14px', background: '#f1f5f9', border: '2px solid #e2e8f0', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', color: '#475569' }}>
                ✕ Limpiar
              </button>
            )}
          </div>

          {cargandoKpis && (
            <div style={{ textAlign: 'center', padding: 32, color: '#94a3b8', fontSize: 14 }}>⏳ Cargando datos...</div>
          )}

          {!cargandoKpis && kpisFiltrados.length === 0 && (
            <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text3)' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>🚛</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text2)', marginBottom: 8 }}>
                {kpis.length === 0 ? `Sin datos para ${labelMes(mes)}` : 'Sin resultados para la búsqueda'}
              </div>
              {kpis.length === 0 && (
                <div style={{ fontSize: 14, fontWeight: 600, maxWidth: 360, margin: '0 auto', lineHeight: 1.7 }}>
                  Importá los CSV de Foxtrot desde la pestaña <strong>Importar</strong> o seleccioná otro mes.
                </div>
              )}
            </div>
          )}

          {/* Grid de cards */}
          {!cargandoKpis && kpisFiltrados.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
              {kpisFiltrados.map(ch => (
                <CardChofer key={ch.driverId} chofer={ch} maxRutas={kpis[0]?.rutas || 1} onVerDetalle={setChoferDetalle} />
              ))}
            </div>
          )}
        </>
      )}

      {/* ══ TAB RANKING ═══════════════════════════════════════════════════════ */}
      {tab === 'ranking' && (
        <div className="dash-card">
          <div className="card-header">
            <span className="card-title">📊 Ranking comparativo — {labelMes(mes)}</span>
            <span className="card-badge">Hacé click en los encabezados para ordenar</span>
          </div>
          {cargandoKpis ? (
            <div style={{ textAlign: 'center', padding: 32, color: '#94a3b8' }}>⏳ Cargando...</div>
          ) : (kpisAllForRanking || kpis).length === 0 ? (
            <div className="empty-state">Sin datos — importá CSV desde la pestaña Importar o elegí otro mes</div>
          ) : (
            <TablaComparativa choferes={kpisAllForRanking || kpis} onVerDetalle={setChoferDetalle} />
          )}
        </div>
      )}

      {/* ══ TAB HISTORIAL ═════════════════════════════════════════════════════ */}
      {tab === 'historial' && (
        <div className="dash-card">
          <div className="card-header">
            <span className="card-title">📋 Historial de importaciones Foxtrot</span>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              {historial.length > 0 && (
                <span className="card-badge">{historial.length} archivos · {fn(historial.reduce((s, h) => s + h.rutas, 0))} rutas</span>
              )}
              <button onClick={cargarHistorial} disabled={cargandoHist}
                style={{ padding: '5px 12px', background: '#f1f5f9', border: '2px solid #e2e8f0', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer', color: '#475569' }}>
                {cargandoHist ? '⏳' : '🔄 Actualizar'}
              </button>
            </div>
          </div>

          {cargandoHist && <div style={{ textAlign: 'center', padding: 32, color: '#94a3b8' }}>⏳ Cargando historial...</div>}

          {!cargandoHist && historial.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 24px', color: '#94a3b8' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📂</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#475569', marginBottom: 6 }}>No hay archivos importados todavía</div>
              <div style={{ fontSize: 13 }}>Subí los CSV de Foxtrot y guardá desde la pestaña <strong>Importar</strong></div>
            </div>
          )}

          {!cargandoHist && historial.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {historial.map((h, i) => {
                const tasaExito  = PCT(h.exitosos, h.totalClientes);
                const fechaImp   = h.fechaImport
                  ? new Date(h.fechaImport).toLocaleString('es-AR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                  : '—';
                return (
                  <div key={h.archivo} style={{
                    border: `2px solid ${i === 0 ? '#86efac' : '#e2e8f0'}`,
                    borderRadius: 14, padding: '16px 20px',
                    background: i === 0 ? '#f0fdf4' : '#fff', position: 'relative',
                  }}>
                    {i === 0 && (
                      <div style={{ position: 'absolute', top: 12, right: 52, fontSize: 11, padding: '2px 10px',
                        background: '#166534', color: '#fff', borderRadius: 8, fontWeight: 700 }}>ÚLTIMO</div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
                      <div style={{ fontSize: 28, flexShrink: 0 }}>📊</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 800, color: '#1e293b', marginBottom: 3, wordBreak: 'break-word' }}>{h.archivo}</div>
                        <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>
                          📅 Importado el {fechaImp}
                          {h.fechaDesde && h.fechaHasta && (
                            <span style={{ marginLeft: 12 }}>· Datos del {h.fechaDesde} al {h.fechaHasta}</span>
                          )}
                        </div>
                      </div>
                      <button onClick={() => eliminarArchivo(h.archivo)} disabled={eliminando === h.archivo}
                        style={{ flexShrink: 0, padding: '6px 14px',
                          background: eliminando === h.archivo ? '#94a3b8' : '#fee2e2',
                          color: eliminando === h.archivo ? '#fff' : '#b91c1c',
                          border: '2px solid',
                          borderColor: eliminando === h.archivo ? '#94a3b8' : '#fca5a5',
                          borderRadius: 8, fontSize: 13, fontWeight: 700,
                          cursor: eliminando === h.archivo ? 'not-allowed' : 'pointer' }}>
                        {eliminando === h.archivo ? '⏳' : '🗑 Eliminar'}
                      </button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 10 }}>
                      {[
                        { icon: '🗺', label: 'Rutas',     value: fn(h.rutas),         color: '#0369a1', bg: '#e0f2fe' },
                        { icon: '🚛', label: 'Choferes',  value: fn(h.totalChoferes), color: '#b87c00', bg: '#fff7e0' },
                        { icon: '📍', label: 'Clientes',  value: fn(h.totalClientes), color: '#475569', bg: '#f8fafc' },
                        { icon: '✅', label: '% Éxito',   value: `${tasaExito}%`,
                          color: tasaExito >= 95 ? '#166534' : '#b87c00',
                          bg: tasaExito >= 95 ? '#dcfce7' : '#fff7e0' },
                        { icon: '📋', label: 'Seq. Adh.', value: `${Math.round((h.seqAdherenceAvg || 0) * 100)}%`, color: '#0369a1', bg: '#e0f2fe' },
                      ].map(k => (
                        <div key={k.label} style={{ background: k.bg, borderRadius: 10, padding: '10px 12px', textAlign: 'center' }}>
                          <div style={{ fontSize: 16 }}>{k.icon}</div>
                          <div style={{ fontSize: 14, fontWeight: 900, fontFamily: 'monospace', color: k.color, margin: '3px 0' }}>{k.value}</div>
                          <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>{k.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Modal detalle chofer */}
      {choferDetalle && (
        <ModalDetalleChofer chofer={choferDetalle} onCerrar={() => setChoferDetalle(null)} />
      )}
    </div>
  );
};