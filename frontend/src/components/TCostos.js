import React, { useMemo } from 'react';
import { MesSelector } from './MesSelector';
import { fp, fn, diasT, isT } from '../utils/helpers';

export const TCostos = ({ rM, K, cfg, mes, setMes, regsAll = [], ausAll = [] }) => {
  const dt = diasT(mes);

  const costoPersonal = useMemo(() => {
    const listOperarios = new Set(cfg.operarios || []);
    const rawChoferes = rM.map(r => r.chofer).filter(Boolean);
    const rawAyudantes = [
      ...rM.map(r => r.ay1).filter(Boolean),
      ...rM.map(r => r.ay2).filter(Boolean)
    ];

    const choferes = new Set(rawChoferes.filter(n => !listOperarios.has(n)));
    const ayudantes = new Set(rawAyudantes.filter(n => !listOperarios.has(n)));
    const operarios = new Set([...rawChoferes, ...rawAyudantes].filter(n => listOperarios.has(n)));

    return {
      choferes: choferes.size * cfg.costoChofer,
      ayudantes: ayudantes.size * cfg.costoAyudante,
      operarios: operarios.size * (cfg.costoOperario || 0),
      totalChoferes: choferes.size,
      totalAyudantes: ayudantes.size,
      totalOperarios: operarios.size
    };
  }, [rM, cfg]);

  const costoRepartos = rM.reduce((s, r) => s + (+r.costoReparto || 0), 0);
  const totalGeneral = costoPersonal.choferes + costoPersonal.ayudantes + costoPersonal.operarios + costoRepartos;

  const porLocalidad = useMemo(() => {
    const map = {};
    rM.forEach(r => {
      // isT() chequea si la localidad contiene 'Tandil' (case insensitive)
      // También cubre casos como "TANDIL" sin sufijo "(Tandil)"
      const locNorm = String(r.localidad || '').toUpperCase();
      const zona = (locNorm.includes('TANDIL') || locNorm.includes('VELA') || 
                    locNorm.includes('BARKER') || locNorm.includes('GARDEY') ||
                    locNorm.includes('JUAREZ') || locNorm.includes('SAN MANUEL') ||
                    locNorm.includes('JUAN N FERNANDEZ'))
        ? 'Tandil' : 'Las Flores';
      if (!map[zona]) map[zona] = { repartos: 0, bultos: 0, costo: 0 };
      map[zona].repartos++;
      map[zona].bultos += +r.bultos || 0;
      map[zona].costo += +r.costoReparto || 0;
    });
    return map;
  }, [rM]);

  const costoCards = [
    { label: 'Personal Choferes', value: costoPersonal.choferes, sub: `${costoPersonal.totalChoferes} choferes × ${fp(cfg.costoChofer)}`, color: '#e8b84b' },
    { label: 'Personal Ayudantes', value: costoPersonal.ayudantes, sub: `${costoPersonal.totalAyudantes} ayudantes × ${fp(cfg.costoAyudante)}`, color: '#00d4ff' },
    { label: 'Personal Operarios', value: costoPersonal.operarios, sub: `${costoPersonal.totalOperarios} operarios × ${fp(cfg.costoOperario)}`, color: '#22c55e' },
    { label: 'Costos de Reparto', value: costoRepartos, sub: `${rM.length} repartos registrados`, color: '#a78bfa' },
    { label: 'Total General', value: totalGeneral, sub: 'Costo total del mes', color: '#166534' },
  ];

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
        {costoCards.map((c, i) => (
          <div key={i} className="stat-card" style={{ '--accent': c.color, background: `${c.color}10` }}>
            <div className="stat-content">
              <div className="stat-value" style={{ color: c.color }}>{fp(c.value)}</div>
              <div className="stat-label">{c.label}</div>
              <div className="stat-sub">{c.sub}</div>
            </div>
          </div>
        ))}
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
                  <div className="zona-stat"><span>{fp(data.costo)}</span><small>costo</small></div>
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