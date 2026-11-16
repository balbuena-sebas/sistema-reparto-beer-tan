// components/CargaRuteo.js — Sección de la pestaña Importar: romaneo del ruteador y maestra de clientes
// (alimentan la pestaña Simulación). Solo admin o usuarios con permiso "simulacion".
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../api/client';
import { cargarRomaneos, cargarMaestra } from '../simulacion/cargas';

export const CargaRuteo = ({ loggedInUser }) => {
  const rol = String(loggedInUser?.role || '').toLowerCase();
  const permitido = rol === 'admin' || (loggedInUser?.permisos || {}).simulacion === true;
  const hdr = useMemo(() => ({ 'x-user-name': encodeURIComponent(loggedInUser?.nombre || '') }), [loggedInUser]);
  const [msg, setMsg] = useState(null); const [ocupado, setOcupado] = useState(false);
  const refR = useRef(null); const refM = useRef(null);
  const [estado, setEstado] = useState(null);     // maestra vigente
  const leerEstado = useCallback(async () => {
    try { const r = await apiFetch('/api/ruteo/ubicaciones'); setEstado({ n: (r.data || []).length, cuando: r.updatedAt, quien: r.updatedBy }); } catch { /* sin dato */ }
  }, []);
  useEffect(() => { if (permitido) leerEstado(); }, [permitido, leerEstado]);
  if (!permitido) return null;

  const correr = async (fn, ok) => {
    setOcupado(true);
    try { const n = await fn(); setMsg({ t: 'ok', x: ok(n) }); leerEstado(); } catch (e) { setMsg({ t: 'err', x: e.message }); }
    setOcupado(false);
  };
  const prog = (x) => setMsg({ t: 'ok', x });
  const caja = { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, marginBottom: 16 };
  const btn = { border: '1px solid var(--border2)', background: 'var(--bg2)', borderRadius: 9, padding: '9px 14px', fontWeight: 700, fontSize: 13, cursor: ocupado ? 'wait' : 'pointer' };

  return (
    <div style={caja}>
      <div style={{ fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text3)', marginBottom: 6 }}>🧭 Ruteo (para la pestaña Simulación)</div>
      <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 12, lineHeight: 1.6 }}>
        Subí el <b>Excel de planificación del ruteador</b> (hoja Romaneiro) o tu <b>Excel de entrega diaria</b> (hoja Datos, carga todos los días juntos); podés elegir varios archivos a la vez y la <b>maestra de clientes</b> con coordenadas.
        La maestra queda guardada y se usa siempre; solo se reemplaza cuando subís una nueva (la nueva pisa a la vieja).
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
      <div style={{ marginTop: 10, fontSize: 13, color: 'var(--text2)' }}>
        {estado == null ? '' : estado.n > 0
          ? <>👥 Maestra vigente: <b>{estado.n}</b> clientes{estado.cuando ? ` · actualizada ${new Date(estado.cuando).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}{estado.quien ? ` por ${estado.quien}` : ''}</>
          : <>⚠ Todavía no hay maestra de clientes cargada: sin ella la simulación no puede ubicar los pedidos.</>}
      </div>
      {msg && <div style={{ marginTop: 12, fontSize: 13, fontWeight: 600, color: msg.t === 'err' ? 'var(--red)' : 'var(--green)' }}>{msg.x}</div>}
    </div>
  );
};

export default CargaRuteo;
