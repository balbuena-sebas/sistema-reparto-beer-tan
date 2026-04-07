import React, { useMemo } from 'react';
import { MesSelector } from './MesSelector';
import { Av } from './Av';
import { fn, diasT } from '../utils/helpers';
import { normalizarUsuario } from '../config/permissions';

export const TPersonal = ({ rM, aM, cfg, mes, setMes, regsAll = [], ausAll = [] }) => {
  const dt = diasT(mes);

  const stats = useMemo(() => {
    // Para persistencia histórica: incluimos a TODOS los que tengan datos en el mes (rM, aM)
    // ADEMÁS de los que están actualmente en la configuración.
    const namesFromRM = rM.flatMap(r => [r.chofer, r.ay1, r.ay2]).filter(Boolean);
    const namesFromAM = aM.map(a => a.persona).filter(Boolean);
    const namesFromCfg = [
      ...(cfg.choferes || []),
      ...(cfg.ayudantes || []),
      ...(cfg.operarios || []),
      ...(cfg.temporada || [])
    ];
    
    const all = [...new Set([...namesFromRM, ...namesFromAM, ...namesFromCfg])];

    return all.map(name => {
      const nName = normalizarUsuario(name);
      const comoCh = rM.filter(r => normalizarUsuario(r.chofer) === nName);
      const comoAy = rM.filter(r => normalizarUsuario(r.ay1) === nName || normalizarUsuario(r.ay2) === nName);
      const rMParticipated = rM.filter(r => 
        normalizarUsuario(r.chofer) === nName || 
        normalizarUsuario(r.ay1) === nName || 
        normalizarUsuario(r.ay2) === nName
      );
      
      const ausencias = aM.filter(a => normalizarUsuario(a.persona) === nName);
      const diasAus = ausencias.reduce((s, a) => s + (a.dias || 1), 0);
      const bultos = rMParticipated.reduce((s, r) => s + (+r.bultos || 0), 0);
      
      const totalAus = ausAll.filter(a => normalizarUsuario(a.persona) === nName).reduce((s, a) => s + (a.dias || 1), 0);

      const recargas = rMParticipated.reduce((s, r) => s + (r.nRecargas || 0), 0);
      const esChofer = (cfg.choferes || []).some(n => normalizarUsuario(n) === nName);
      const esAyudante = (cfg.ayudantes || []).some(n => normalizarUsuario(n) === nName);
      const esOperario = (cfg.operarios || []).some(n => normalizarUsuario(n) === nName);
      const esTemporada = (cfg.temporada || []).some(n => normalizarUsuario(n) === nName);

      return { name, comoCh: comoCh.length, comoAy: comoAy.length, diasAus, bultos, totalAus, recargas, esChofer, esAyudante, esOperario, esTemporada, ausencias };
    }).filter(p => (p.bultos > 0 || p.diasAus > 0 || p.esChofer || p.esAyudante || p.esOperario || p.esTemporada))
      .sort((a, b) => b.bultos - a.bultos);
  }, [rM, aM, cfg, regsAll, ausAll]);

  return (
    <div className="dash-container">
      <div className="dash-header">
        <div>
          <h2 className="dash-title">Personal</h2>
          <p className="dash-sub">
            {stats.length} personas identificadas · {(cfg.choferes || []).length} choferes · {(cfg.ayudantes || []).length} ayudantes · {(cfg.operarios || []).length} operarios · {(cfg.temporada || []).length} temporada
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
                  {p.esTemporada && <span className="role-badge" style={{ background: '#fef3c7', color: '#b45309' }}>Temporada</span>}
                  {p.esOperario && <span className="role-badge role-operario" style={{ background: '#dcfce7', color: '#166534' }}>Operario</span>}
                </div>
              </div>
            </div>
            <div className="personal-stats">
              <div className="pstat">
                <span className="pstat-val" style={{ color: '#e8b84b' }}>{p.comoCh}</span>
                <span className="pstat-label">🚚 Chofer (mes)</span>
              </div>
              <div className="pstat">
                <span className="pstat-val" style={{ color: '#00d4ff' }}>{p.comoAy}</span>
                <span className="pstat-label">🤝 Ayudante (mes)</span>
              </div>
              <div className="pstat highlight">
                <span className="pstat-val" style={{ color: '#7fff47' }}>{fn(p.bultos)}</span>
                <span className="pstat-label">📦 Bultos (mes)</span>
              </div>
              <div className="pstat highlight">
                <span className="pstat-val" style={{ color: p.recargas > 0 ? '#ff8e2b' : '#64748b', fontSize: 18 }}>{p.recargas}</span>
                <span className="pstat-label">⚡ Recargas (mes)</span>
              </div>
              <div className="pstat highlight">
                <span className="pstat-val" style={{ color: p.diasAus > 0 ? '#ff4757' : '#22c55e' }}>{p.diasAus}</span>
                <span className="pstat-label">🛌 Ausente (mes)</span>
                {p.totalAus > p.diasAus && <small className="pstat-total" style={{ color: '#ff4757', fontWeight: 800 }}>{p.totalAus} días totales</small>}
              </div>
            </div>
            {p.ausencias.length > 0 && (
              <div className="personal-aus">
                {p.ausencias.slice(0, 2).map(a => (
                  <span key={a.id} className="aus-mini">🗓 {a.motivo} ({a.dias}d)</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <style>{`
        .personal-stats {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 12px;
          margin-top: 16px;
        }
        .pstat {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 8px;
          background: rgba(255,255,255,0.03);
          border-radius: 8px;
        }
        .pstat.highlight {
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.1);
        }
        .pstat-val {
          font-size: 1.4rem;
          font-weight: 800;
        }
        .pstat-label {
          font-size: 0.75rem;
          color: #94a3b8;
          text-transform: uppercase;
          margin-top: 4px;
          text-align: center;
        }
        .pstat-total {
          font-size: 0.65rem;
          color: #64748b;
          margin-top: 2px;
        }
        .personal-card {
          transition: transform 0.2s;
        }
        .personal-card:hover {
          transform: translateY(-4px);
        }
      `}</style>
    </div>
  );
};