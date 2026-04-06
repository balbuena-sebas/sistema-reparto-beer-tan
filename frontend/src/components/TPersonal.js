import React, { useMemo } from 'react';
import { MesSelector } from './MesSelector';
import { Av } from './Av';
import { fn, diasT } from '../utils/helpers';

export const TPersonal = ({ rM, aM, cfg, mes, setMes, regsAll = [], ausAll = [] }) => {
  const dt = diasT(mes);

  const stats = useMemo(() => {
    const all = [...new Set([...(cfg.choferes || []), ...(cfg.ayudantes || []), ...(cfg.operarios || [])])];
    return all.map(name => {
      const comoCh = rM.filter(r => r.chofer === name);
      const comoAy = rM.filter(r => r.ay1 === name || r.ay2 === name);
      const ausencias = aM.filter(a => a.persona === name);
      const diasAus = ausencias.reduce((s, a) => s + (a.dias || 1), 0);
      const bultos = comoCh.reduce((s, r) => s + (+r.bultos || 0), 0);
      const recargas = comoCh.reduce((s, r) => s + (r.nRecargas || 0), 0);
      const esChofer = (cfg.choferes || []).includes(name);
      const esAyudante = (cfg.ayudantes || []).includes(name);
      const esOperario = (cfg.operarios || []).includes(name);
      return { name, comoCh: comoCh.length, comoAy: comoAy.length, diasAus, bultos, recargas, esChofer, esAyudante, esOperario, ausencias };
    }).sort((a, b) => b.bultos - a.bultos);
  }, [rM, aM, cfg]);

  return (
    <div className="dash-container">
      <div className="dash-header">
        <div>
          <h2 className="dash-title">Personal</h2>
          <p className="dash-sub">
            {stats.length} personas · {(cfg.choferes || []).length} choferes · {(cfg.ayudantes || []).length} ayudantes · {(cfg.operarios || []).length} operarios
          </p>
        </div>
        <div className="dash-header-right">
          <MesSelector value={mes} onChange={setMes} regs={regsAll} aus={ausAll} />
        </div>
      </div>

      <div className="personal-grid">
        {stats.map(p => (
          <div key={p.name} className="personal-card">
            <div className="personal-card-header">
              <Av name={p.name} size="lg" />
              <div className="personal-info">
                <div className="personal-name">{p.name}</div>
                <div className="personal-roles">
                  {p.esChofer && <span className="role-badge role-chofer">Chofer</span>}
                  {p.esAyudante && <span className="role-badge role-ayudante">Ayudante</span>}
                  {p.esOperario && <span className="role-badge role-operario" style={{ background: '#dcfce7', color: '#166534' }}>Operario</span>}
                </div>
              </div>
            </div>
            <div className="personal-stats">
              <div className="pstat">
                <span className="pstat-val" style={{ color: '#e8b84b' }}>{p.comoCh}</span>
                <span className="pstat-label">Como Chofer</span>
              </div>
              <div className="pstat">
                <span className="pstat-val" style={{ color: '#00d4ff' }}>{p.comoAy}</span>
                <span className="pstat-label">Como Ayudante</span>
              </div>
              <div className="pstat">
                <span className="pstat-val" style={{ color: '#7fff47' }}>{fn(p.bultos)}</span>
                <span className="pstat-label">Bultos</span>
              </div>
              <div className="pstat">
                <span className="pstat-val" style={{ color: p.diasAus > 0 ? '#ff4757' : '#22c55e' }}>{p.diasAus}</span>
                <span className="pstat-label">Días Ausente</span>
              </div>
            </div>
            {p.ausencias.length > 0 && (
              <div className="personal-aus">
                {p.ausencias.slice(0, 2).map(a => (
                  <span key={a.id} className="aus-mini">{a.motivo} ({a.dias}d)</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};