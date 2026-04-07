import React, { useMemo } from 'react';
import { MesSelector } from './MesSelector';
import { fp, fn, diasT, isT } from '../utils/helpers';

export const TCostos = ({ rM, K, cfg, mes, setMes, regsAll = [], ausAll = [] }) => {
  const dt = diasT(mes);

  const costoPersonal = useMemo(() => {
    const listOperarios = new Set((cfg.operarios || []).map(n => n.toLowerCase().trim()));
    const listTemporada = new Set((cfg.temporada || []).map(n => n.toLowerCase().trim()));
    const norm = (n) => (n || '').toLowerCase().trim();

    const rawChoferes = rM.map(r => norm(r.chofer)).filter(Boolean);
    const rawAyudantes = [
      ...rM.map(r => norm(r.ay1)).filter(Boolean),
      ...rM.map(r => norm(r.ay2)).filter(Boolean)
    ];

    // Operarios por rol: SOLO si "llegaron a la recarga" (nRecargas > 0)
    const rawChoferesConRec = rM.filter(r => (r.nRecargas || 0) > 0).map(r => norm(r.chofer)).filter(Boolean);
    const rawAyudantesConRec = rM.filter(r => (r.nRecargas || 0) > 0).flatMap(r => [norm(r.ay1), norm(r.ay2)]).filter(Boolean);

    const opsCh = new Set(rawChoferesConRec.filter(n => listOperarios.has(n)));
    const opsAy = new Set(rawAyudantesConRec.filter(n => listOperarios.has(n)));
    
    // Temporada: Aparecen en records CON RECARGA, pero NO son operarios (y están en lista temporada)
    const temporada = new Set([
      ...rawChoferesConRec.filter(n => !listOperarios.has(n) && listTemporada.has(n)),
      ...rawAyudantesConRec.filter(n => !listOperarios.has(n) && listTemporada.has(n))
    ]);

    // Choferes/Ayudantes puros: No son operarios ni temporada
    const choferes = new Set(rawChoferes.filter(n => !listOperarios.has(n) && !listTemporada.has(n)));
    const ayudantes = new Set(rawAyudantes.filter(n => !listOperarios.has(n) && !listTemporada.has(n)));

    return {
      choferes: choferes.size * cfg.costoChofer,
      ayudantes: ayudantes.size * cfg.costoAyudante,
      temporada: temporada.size * (cfg.costoTemporada || cfg.costoAyudante),
      operariosCh: opsCh.size * (cfg.costoOperarioChofer || 0),
      operariosAy: opsAy.size * (cfg.costoOperarioAyudante || 0),
      totalChoferes: choferes.size,
      totalAyudantes: ayudantes.size,
      totalTemporada: temporada.size,
      totalOpsCh: opsCh.size,
      totalOpsAy: opsAy.size
    };
  }, [rM, cfg]);

  const costoRepartos = rM.reduce((s, r) => s + (+r.costoReparto || 0), 0);
  const totalGeneral = costoPersonal.choferes + costoPersonal.ayudantes + costoPersonal.temporada +
                       costoPersonal.operariosCh + costoPersonal.operariosAy + costoRepartos;

  const porLocalidad = useMemo(() => {
    const map = {};
    rM.forEach(r => {
      const zona = isT(r.localidad) ? 'Tandil' : 'Las Flores';
      if (!map[zona]) map[zona] = { repartos: 0, bultos: 0, costo: 0 };
      map[zona].repartos++;
      map[zona].bultos += +r.bultos || 0;
      map[zona].costo += +r.costoReparto || 0;
    });
    return map;
  }, [rM]);

  const costoCards = [
    { label: 'Facturación Choferes', value: costoPersonal.choferes, sub: `${costoPersonal.totalChoferes} choferes × ${fp(cfg.costoChofer)}`, color: '#e8b84b' },
    { label: 'Facturación Ayudantes', value: costoPersonal.ayudantes, sub: `${costoPersonal.totalAyudantes} ayudantes × ${fp(cfg.costoAyudante)}`, color: '#00d4ff' },
  ];

  if (costoPersonal.totalTemporada > 0) {
    costoCards.push({ label: 'Personal Temporada', value: costoPersonal.temporada, sub: `${costoPersonal.totalTemporada} temporada × ${fp(cfg.costoTemporada || cfg.costoAyudante)}`, color: '#f59e0b' });
  }

  if (costoPersonal.totalOpsCh > 0) {
    costoCards.push({ label: 'Personal Operarios (Chofer)', value: costoPersonal.operariosCh, sub: `${costoPersonal.totalOpsCh} operarios × ${fp(cfg.costoOperarioChofer)}`, color: '#22c55e' });
  }
  if (costoPersonal.totalOpsAy > 0) {
    costoCards.push({ label: 'Personal Operarios (Ayudante)', value: costoPersonal.operariosAy, sub: `${costoPersonal.totalOpsAy} operarios × ${fp(cfg.costoOperarioAyudante)}`, color: '#10b981' });
  }

  costoCards.push(
    { label: 'Facturación del Reparto', value: costoRepartos, sub: `${rM.length} repartos registrados`, color: '#a78bfa' },
    { label: 'Facturación Total de Repartos', value: totalGeneral, sub: 'Total de ingresos proyectados', color: '#166534' }
  );

  return (
    <div className="dash-container">
      <div className="dash-header">
        <div>
          <h2 className="dash-title">Análisis de Costos</h2>
          <p className="dash-sub">Período: {mes} · {dt} días hábiles</p>
        </div>
        <div className="dash-header-right">
          <MesSelector value={mes} onChange={setMes} regs={regsAll} aus={ausAll} />
        </div>
      </div>

      <div className="stats-grid">
        {costoCards.map((c, i) => {
          const valStr = fp(c.value);
          const valFontSize = valStr.length > 12 ? '22px' : valStr.length > 10 ? '26px' : '32px';
          return (
            <div key={i} className="stat-card" style={{ '--accent': c.color, background: `${c.color}10`, padding: '20px 14px' }}>
              <div className="stat-content">
                <div className="stat-value" style={{ color: c.color, fontSize: valFontSize }}>{valStr}</div>
                <div className="stat-label">{c.label}</div>
                <div className="stat-sub">{c.sub}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="dash-grid-2">
        {/* Desglose por zona */}
        <div className="dash-card">
          <div className="card-header"><span className="card-title">Desglose por Zona</span></div>
          <div className="zona-list">
            {Object.entries(porLocalidad).map(([zona, data]) => (
              <div key={zona} className="zona-item">
                <div className="zona-name">🗺 {zona}</div>
                <div className="zona-stats">
                  <div className="zona-stat"><span>{data.repartos}</span><small>repartos</small></div>
                  <div className="zona-stat"><span>{fn(data.bultos)}</span><small>bultos</small></div>
                  <div className="zona-stat"><span>{fp(data.costo)}</span><small>facturación</small></div>
                </div>
              </div>
            ))}
            {Object.keys(porLocalidad).length === 0 && <div className="empty-state">Sin datos</div>}
          </div>
        </div>

        {/* Top costos */}
        <div className="dash-card">
          <div className="card-header"><span className="card-title">Repartos con Mayor Costo</span></div>
          <div className="top-list">
            {rM.filter(r => r.costoReparto).sort((a, b) => b.costoReparto - a.costoReparto).slice(0, 6).map(r => (
              <div key={r.id} className="top-item">
                <span className="top-name">{r.chofer}</span>
                <span className="top-sub">{r.localidad?.split(' (')[0]} · {r.fecha}</span>
                <span className="top-val" style={{ color: '#e8b84b' }}>{fp(r.costoReparto)}</span>
              </div>
            ))}
            {rM.filter(r => r.costoReparto).length === 0 && <div className="empty-state">Sin costos registrados</div>}
          </div>
        </div>
      </div>
    </div>
  );
};