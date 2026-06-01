import React, { useEffect, useState } from 'react';
import { getDbStats, postArchiveMonth, postReplicateNeon } from '../api/client';

const QUOTAS = {
  supabase: 500 * 1024 * 1024 * 1024,
  neon: 10 * 1024 * 1024 * 1024,
  r2: 10 * 1024 * 1024 * 1024,
};

function bytesToPretty(bytes) {
  if (bytes === null || bytes === undefined) return 'N/A';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function UsageBar({ percent }) {
  const color = percent > 90 ? '#dc2626' : percent > 70 ? '#f97316' : '#22c55e';
  return (
    <div style={{ height: 14, borderRadius: 7, background: '#e2e8f0', overflow: 'hidden', marginTop: 10 }}>
      <div style={{ width: `${Math.min(percent, 100)}%`, height: '100%', background: color, transition: 'width 0.35s ease' }} />
    </div>
  );
}

export function TDbStats({ loggedInUser }) {
  const [stats, setStats] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [mesInput, setMesInput] = useState('');
  const [repMonths, setRepMonths] = useState(3);

  useEffect(() => {
    let mounted = true;
    let stopped = false;
    const fetchOnce = () => getDbStats()
      .then((r) => { if (mounted && !stopped) setStats(r); })
      .catch((e) => { console.error('Error fetching dbstats', e); if (mounted && !stopped) setErr(e.message || String(e)); });

    fetchOnce();
    const iv = setInterval(() => { fetchOnce(); }, 15000);
    return () => { mounted = false; stopped = true; clearInterval(iv); };
  }, []);

  if (err) return <div style={{ padding: 20 }}>Error: {err}</div>;
  if (!stats) return <div style={{ padding: 20 }}>Cargando uso de bases de datos...</div>;

  const { supabase, neon, r2, topTables } = stats;
  const supPct = supabase?.bytes ? (supabase.bytes / QUOTAS.supabase) * 100 : 0;
  const neonPct = neon?.bytes ? (neon.bytes / QUOTAS.neon) * 100 : 0;
  const r2Accounts = (r2?.accounts || []).map((a) => ({
    ...a,
    percent: a.usedBytes ? (a.usedBytes / QUOTAS.r2) * 100 : 0,
    pretty: bytesToPretty(a.usedBytes),
  }));

  return (
    <div style={{ padding: 18 }}>
      <h2>Estado de Bases de Datos</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 14 }}>
        <div style={{ padding: 18, borderRadius: 16, border: '1px solid #e2e8f0', background: '#f8fafc' }}>
          <strong style={{ display: 'block', marginBottom: 8, fontSize: 16 }}>Supabase (Principal)</strong>
          <div style={{ fontSize: 26, fontWeight: 700, marginBottom: 6 }}>{supabase?.pretty || 'N/A'}</div>
          <div style={{ color: '#475569' }}>Usado: {bytesToPretty(supabase?.bytes)} / 500 GB</div>
          <div style={{ color: '#475569' }}>{supPct.toFixed(2)}% utilizado, {((100 - supPct) < 0 ? 0 : (100 - supPct)).toFixed(2)}% disponible</div>
          <UsageBar percent={supPct} />
        </div>

        <div style={{ padding: 18, borderRadius: 16, border: '1px solid #e2e8f0', background: '#f8fafc' }}>
          <strong style={{ display: 'block', marginBottom: 8, fontSize: 16 }}>Neon (Backup)</strong>
          <div style={{ fontSize: 26, fontWeight: 700, marginBottom: 6 }}>{neon?.pretty || 'N/A'}</div>
          <div style={{ color: '#475569' }}>Usado: {bytesToPretty(neon?.bytes)} / 10 GB</div>
          <div style={{ color: '#475569' }}>{neonPct.toFixed(2)}% utilizado, {((100 - neonPct) < 0 ? 0 : (100 - neonPct)).toFixed(2)}% disponible</div>
          <UsageBar percent={neonPct} />
        </div>

        <div style={{ padding: 18, borderRadius: 16, border: '1px solid #e2e8f0', background: '#f8fafc' }}>
          <strong style={{ display: 'block', marginBottom: 8, fontSize: 16 }}>Cloudflare R2 (Archivos)</strong>
          <div style={{ fontSize: 26, fontWeight: 700, marginBottom: 6 }}>{bytesToPretty(r2?.totalBytes)} totales</div>
          <div style={{ color: '#475569', marginBottom: 12 }}>Cuenta(s): {r2Accounts.length || 0}</div>
          {r2Accounts.map((account) => (
            <div key={account.id} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{account.bucketName}</div>
              <div style={{ color: '#475569', fontSize: 13, marginBottom: 4 }}>{account.pretty} / 10 GB ({account.percent.toFixed(1)}%)</div>
              <UsageBar percent={account.percent} />
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 22, padding: 18, borderRadius: 16, border: '1px solid #e2e8f0', background: '#ffffff' }}>
        <h3>Tablas más grandes (Top 10)</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: 10, borderBottom: '1px solid #e2e8f0' }}>Tabla</th>
              <th style={{ textAlign: 'right', padding: 10, borderBottom: '1px solid #e2e8f0' }}>Tamaño</th>
            </tr>
          </thead>
          <tbody>
            {(topTables || []).map(t => (
              <tr key={t.tabla}>
                <td style={{ padding: 10, borderBottom: '1px solid #f1f5f9' }}>{t.tabla}</td>
                <td style={{ padding: 10, textAlign: 'right', borderBottom: '1px solid #f1f5f9' }}>{t.pretty}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 18, color: '#64748b' }}>
        Nota: Solo los administradores ven esta solapa. Puedes configurar umbrales automáticos para archivar datos antiguos.
      </div>

      <div style={{ marginTop: 18, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{ padding: 12, border: '1px solid #eef2f7', borderRadius: 8 }}>
          <h4>Archivado manual (R2)</h4>
          <div style={{ display: 'flex', gap: 8 }}>
            <input placeholder="YYYY-MM" value={mesInput} onChange={e => setMesInput(e.target.value)} />
            <button disabled={busy || !mesInput} onClick={async () => {
              setBusy(true);
              try {
                await postArchiveMonth(mesInput);
                // refrescar stats
                const s = await getDbStats(); setStats(s);
                setMesInput('');
              } catch (e) { alert('Error: ' + (e.message || e)); }
              setBusy(false);
            }}>Archivar</button>
          </div>
        </div>

        <div style={{ padding: 12, border: '1px solid #eef2f7', borderRadius: 8 }}>
          <h4>Replicar a Neon (parcial)</h4>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="number" min={1} max={12} value={repMonths} onChange={e => setRepMonths(Number(e.target.value))} style={{ width: 80 }} />
            <button disabled={busy} onClick={async () => {
              setBusy(true);
              try {
                await postReplicateNeon(repMonths);
                const s = await getDbStats(); setStats(s);
              } catch (e) { alert('Error: ' + (e.message || e)); }
              setBusy(false);
            }}>Replicar</button>
          </div>
          <div style={{ marginTop: 8, color: '#64748b' }}>Replica solo los últimos meses para tablas pesadas y evita llenar Neon.</div>
        </div>
      </div>
    </div>
  );
}

export default TDbStats;
