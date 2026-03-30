// src/components/TMigracion.js
// Pantalla de migración — se muestra solo si hay datos en localStorage
// y todavía no se migraron a Neon. Desaparece una vez completada.

import React, { useState, useEffect } from 'react';
import { migrarDesdeLocalStorage } from '../api/client';

export const TMigracion = ({ onCompletada }) => {
  const [datos,    setDatos]    = useState(null);   // { regs, aus, cfg, clave }
  const [estado,   setEstado]   = useState('idle');  // idle | migrando | ok | error
  const [resultado,setResultado] = useState(null);
  const [errorMsg, setErrorMsg]  = useState('');

  useEffect(() => {
    setDatos({ regs: [], aus: [], cfg: null, clave: null });
  }, []);

  const totalRegistros = datos?.regs?.length  || 0;
  const totalAus       = datos?.aus?.length   || 0;
  const tieneCfg       = !!datos?.cfg;
  const hayDatos       = totalRegistros > 0 || totalAus > 0 || tieneCfg;

  const handleMigrar = async () => {
    if (!hayDatos) return;
    setEstado('migrando');
    try {
      const res = await migrarDesdeLocalStorage(datos.regs, datos.aus, datos.cfg);
      setResultado(res);
      setEstado('ok');
      // Marcar en sessionStorage que ya se migró
      sessionStorage.setItem('reparto_migrado', 'true');
    } catch (err) {
      setErrorMsg(err.message);
      setEstado('error');
    }
  };

  const handleSaltear = () => {
    sessionStorage.setItem('reparto_migrado', 'true');
    onCompletada();
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #f0f9ff 0%, #e8f3ff 100%)', padding: 24,
    }}>
      <div style={{
        background: '#fff', borderRadius: 24, maxWidth: 560, width: '100%',
        boxShadow: '0 20px 60px rgba(0,0,0,0.1)', overflow: 'hidden',
      }}>

        {/* Header */}
        <div style={{ background: 'linear-gradient(135deg, #005fa3, #0284c7)', padding: '28px 32px', color: '#fff' }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>🚛</div>
          <div style={{ fontSize: 22, fontWeight: 900, marginBottom: 6 }}>
            {estado === 'ok' ? '✅ Migración completada' : 'Migrar datos al servidor'}
          </div>
          <div style={{ fontSize: 14, opacity: 0.85, fontWeight: 600 }}>
            {estado === 'ok'
              ? 'Tus datos ahora están guardados en Neon'
              : 'El sistema detectó datos guardados localmente en esta computadora'}
          </div>
        </div>

        <div style={{ padding: '28px 32px' }}>

          {/* Estado: idle — mostrar qué hay para migrar */}
          {estado === 'idle' && (
            <>
              {hayDatos ? (
                <>
                  <div style={{ fontSize: 15, color: '#334155', fontWeight: 600, marginBottom: 20, lineHeight: 1.6 }}>
                    Encontramos estos datos guardados en esta computadora. Podés importarlos a Neon para que estén disponibles desde cualquier dispositivo.
                  </div>

                  {/* Resumen de datos */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 24 }}>
                    {[
                      { icon: '🚛', label: 'Registros', value: totalRegistros, color: '#005fa3' },
                      { icon: '📋', label: 'Ausencias', value: totalAus,       color: '#b87c00' },
                      { icon: '⚙',  label: 'Config',    value: tieneCfg ? '✓' : '—', color: '#5b21b6' },
                    ].map(k => (
                      <div key={k.label} style={{ background: '#f8fafc', border: `2px solid ${k.color}20`, borderRadius: 14, padding: '14px 12px', textAlign: 'center' }}>
                        <div style={{ fontSize: 24, marginBottom: 4 }}>{k.icon}</div>
                        <div style={{ fontSize: 24, fontWeight: 900, fontFamily: 'monospace', color: k.color }}>{k.value}</div>
                        <div style={{ fontSize: 12, color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>{k.label}</div>
                      </div>
                    ))}
                  </div>

                  <div style={{ background: '#fff7e0', border: '2px solid #f59e0b', borderRadius: 12, padding: '12px 16px', marginBottom: 24, fontSize: 13, color: '#78350f', fontWeight: 600, lineHeight: 1.6 }}>
                    ⚠ Esta operación se hace <strong>una sola vez</strong>. Después de migrar, los datos se guardan directamente en Neon y el localStorage ya no se usa.
                  </div>

                  <div style={{ display: 'flex', gap: 12 }}>
                    <button onClick={handleMigrar}
                      style={{ flex: 1, background: '#005fa3', color: '#fff', border: 'none', borderRadius: 12, padding: '14px 20px', fontSize: 15, fontWeight: 800, cursor: 'pointer' }}>
                      📦 Importar datos a Neon
                    </button>
                    <button onClick={handleSaltear}
                      style={{ background: '#f1f5f9', color: '#64748b', border: '2px solid #e2e8f0', borderRadius: 12, padding: '14px 20px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                      Saltear
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 15, color: '#334155', fontWeight: 600, marginBottom: 24, lineHeight: 1.6 }}>
                    No se encontraron datos previos en esta computadora. El sistema está listo para usar con Neon desde cero.
                  </div>
                  <button onClick={handleSaltear}
                    style={{ width: '100%', background: '#005fa3', color: '#fff', border: 'none', borderRadius: 12, padding: '14px 20px', fontSize: 15, fontWeight: 800, cursor: 'pointer' }}>
                    Comenzar →
                  </button>
                </>
              )}
            </>
          )}

          {/* Estado: migrando */}
          {estado === 'migrando' && (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>⏳</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: '#334155', marginBottom: 8 }}>Importando datos...</div>
              <div style={{ fontSize: 14, color: '#64748b', fontWeight: 600 }}>
                Enviando {totalRegistros} registros y {totalAus} ausencias a Neon
              </div>
            </div>
          )}

          {/* Estado: ok */}
          {estado === 'ok' && resultado && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 }}>
                {[
                  { label: 'Registros importados', value: resultado.regsOk, color: '#166534', bg: '#dcfce7' },
                  { label: 'Ausencias importadas', value: resultado.ausOk,  color: '#166534', bg: '#dcfce7' },
                  { label: 'Registros con error',  value: resultado.regsFail, color: resultado.regsFail > 0 ? '#b91c1c' : '#166534', bg: resultado.regsFail > 0 ? '#fee2e2' : '#dcfce7' },
                  { label: 'Config',               value: resultado.cfgOk ? '✓ OK' : '—', color: '#166534', bg: '#dcfce7' },
                ].map(k => (
                  <div key={k.label} style={{ background: k.bg, borderRadius: 12, padding: '12px 16px', textAlign: 'center' }}>
                    <div style={{ fontSize: 22, fontWeight: 900, fontFamily: 'monospace', color: k.color }}>{k.value}</div>
                    <div style={{ fontSize: 12, color: k.color, fontWeight: 700, textTransform: 'uppercase', marginTop: 3 }}>{k.label}</div>
                  </div>
                ))}
              </div>

              {resultado.errores?.length > 0 && (
                <div style={{ background: '#fff7e0', border: '2px solid #f59e0b', borderRadius: 12, padding: '12px 16px', marginBottom: 20, fontSize: 12, color: '#78350f', fontFamily: 'monospace' }}>
                  {resultado.errores.slice(0, 3).map((e, i) => <div key={i}>⚠ {e}</div>)}
                  {resultado.errores.length > 3 && <div>...y {resultado.errores.length - 3} más</div>}
                </div>
              )}

              <button onClick={onCompletada}
                style={{ width: '100%', background: '#166534', color: '#fff', border: 'none', borderRadius: 12, padding: '14px 20px', fontSize: 15, fontWeight: 800, cursor: 'pointer' }}>
                ✓ Ir al sistema →
              </button>
            </>
          )}

          {/* Estado: error */}
          {estado === 'error' && (
            <>
              <div style={{ background: '#fee2e2', border: '2px solid #b91c1c', borderRadius: 12, padding: '14px 16px', marginBottom: 20, fontSize: 14, color: '#7f1d1d', fontWeight: 600 }}>
                ❌ Error: {errorMsg}
                <div style={{ marginTop: 8, fontSize: 13, fontWeight: 500 }}>
                  Verificá que el backend esté corriendo y que el API_KEY sea correcto.
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setEstado('idle')}
                  style={{ flex: 1, background: '#f1f5f9', color: '#334155', border: '2px solid #e2e8f0', borderRadius: 12, padding: '12px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                  ← Volver a intentar
                </button>
                <button onClick={handleSaltear}
                  style={{ flex: 1, background: '#005fa3', color: '#fff', border: 'none', borderRadius: 12, padding: '12px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                  Saltear e ir al sistema
                </button>
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  );
};