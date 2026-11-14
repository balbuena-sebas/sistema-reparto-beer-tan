// components/CargaRuteo.js — Sección de la pestaña Importar: romaneo del ruteador y maestra de clientes
// (alimentan la pestaña Simulación). Solo admin o usuarios con permiso "simulacion".
import React, { useMemo, useRef, useState } from 'react';
import { cargarRomaneos, cargarMaestra } from '../simulacion/cargas';

export const CargaRuteo = ({ loggedInUser }) => {
  const rol = String(loggedInUser?.role || '').toLowerCase();
  const permitido = rol === 'admin' || (loggedInUser?.permisos || {}).simulacion === true;
  const hdr = useMemo(() => ({ 'x-user-name': encodeURIComponent(loggedInUser?.nombre || '') }), [loggedInUser]);
  const [msg, setMsg] = useState(null); const [ocupado, setOcupado] = useState(false);
  const refR = useRef(null); const refM = useRef(null);
  if (!permitido) return null;

  const correr = async (fn, ok) => {
    setOcupado(true);
    try { const n = await fn(); setMsg({ t: 'ok', x: ok(n) }); } catch (e) { setMsg({ t: 'err', x: e.message }); }
    setOcupado(false);
  };
  const prog = (x) => setMsg({ t: 'ok', x });
  const caja = { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, marginBottom: 16 };
  const btn = { border: '1px solid var(--border2)', background: 'var(--bg2)', borderRadius: 9, padding: '9px 14px', fontWeight: 700, fontSize: 13, cursor: ocupado ? 'wait' : 'pointer' };

  return (
    <div style={caja}>
      <div style={{ fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text3)', marginBottom: 6 }}>🧭 Ruteo (para la pestaña Simulación)</div>
      <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 12, lineHeight: 1.6 }}>
        Subí el <b>Excel de planificación del ruteador</b> (hoja Romaneiro; podés elegir varios días a la vez) y, una sola vez, la <b>maestra de clientes</b> con coordenadas.
        Los pedidos del día siguiente se suben en la pestaña Simulación. Los rechazos que ya cargás acá se cruzan solos con el romaneo.
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <input ref={refR} type="file" accept=".xlsb,.xlsx" multiple hidden
          onChange={(e) => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) correr(() => cargarRomaneos(fs, hdr, prog), (n) => `Romaneo guardado: ${n} día(s).`); }} />
        <button style={btn} disabled={ocupado} onClick={() => refR.current.click()}>🗂️ Subir romaneo del ruteador</button>
        <input ref={refM} type="file" accept=".xlsx,.xls" hidden
          onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) correr(() => cargarMaestra(f, hdr, prog), (n) => `Maestra cargada: ${n} clientes con ubicación.`); }} />
        <button style={btn} disabled={ocupado} onClick={() => refM.current.click()}>👥 Subir maestra de clientes</button>
      </div>
      {msg && <div style={{ marginTop: 12, fontSize: 13, fontWeight: 600, color: msg.t === 'err' ? 'var(--red)' : 'var(--green)' }}>{msg.x}</div>}
    </div>
  );
};

export default CargaRuteo;
