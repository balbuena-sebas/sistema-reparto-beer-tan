import React, { useMemo, useState } from "react";
import { MesSelector } from "./MesSelector";
import { fp, fn, semK, semL, isT, diasT, diasH } from "../utils/helpers";

const MESES_LABEL = [
  "Ene",
  "Feb",
  "Mar",
  "Abr",
  "May",
  "Jun",
  "Jul",
  "Ago",
  "Sep",
  "Oct",
  "Nov",
  "Dic",
];
const COLORES_ANIO = [
  "#b87c00",
  "#005fa3",
  "#166534",
  "#5b21b6",
  "#b91c1c",
  "#0891b2",
];

// ─── Variación % con flecha ──────────────────────────────────────────────────
const Variacion = ({ actual, anterior, invertido = false }) => {
  if (!anterior)
    return (
      <span style={{ color: "var(--text3)", fontSize: 13, fontWeight: 700 }}>
        — sin datos anteriores
      </span>
    );
  const pct = Math.round(((actual - anterior) / anterior) * 100);
  const sube = invertido ? pct < 0 : pct >= 0;
  return (
    <span
      style={{
        fontSize: 14,
        fontWeight: 800,
        color: sube ? "#166534" : "#b91c1c",
        background: sube ? "#dcfce7" : "#fee2e2",
        padding: "3px 10px",
        borderRadius: 20,
        border: `1px solid ${sube ? "#4ade80" : "#f87171"}`,
      }}>
      {pct >= 0 ? "▲" : "▼"} {Math.abs(pct)}%
    </span>
  );
};

// ─── Gráfico de líneas doble ─────────────────────────────────────────────────
const GraficoLineas = ({
  serieA,
  serieB,
  labelA,
  labelB,
  colorA = "#b87c00",
  colorB = "#005fa3",
  altura = 180,
}) => {
  const todos = [...serieA.map((d) => d.valor), ...serieB.map((d) => d.valor)];
  const max = Math.max(...todos, 1);
  const n = Math.max(serieA.length, serieB.length);
  if (n === 0)
    return <div className="empty-state">Sin datos para comparar</div>;

  const pct = (v) => Math.round((v / max) * 100);
  const W = 100 / n;

  return (
    <div>
      {/* Leyenda */}
      <div style={{ display: "flex", gap: 20, marginBottom: 16 }}>
        {[
          { label: labelA, color: colorA },
          { label: labelB, color: colorB },
        ].map((l) => (
          <div
            key={l.label}
            style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: 28,
                height: 4,
                background: l.color,
                borderRadius: 2,
              }}
            />
            <span
              style={{ fontSize: 13, fontWeight: 700, color: "var(--text2)" }}>
              {l.label}
            </span>
          </div>
        ))}
      </div>

      {/* Gráfico SVG */}
      <div
        style={{
          position: "relative",
          height: altura,
          background: "var(--bg3)",
          borderRadius: 12,
          border: "2px solid var(--border)",
          padding: "16px 16px 0",
        }}>
        <svg width="100%" height="100%" style={{ overflow: "visible" }}>
          {/* Líneas de guía horizontales */}
          {[0, 25, 50, 75, 100].map((p) => (
            <line
              key={p}
              x1="0%"
              y1={`${100 - p}%`}
              x2="100%"
              y2={`${100 - p}%`}
              stroke="var(--border)"
              strokeWidth="1"
              strokeDasharray="4,4"
            />
          ))}

          {/* Serie A */}
          {serieA.length > 1 && (
            <polyline
              points={serieA
                .map(
                  (d, i) =>
                    `${(i / (serieA.length - 1)) * 100}%,${100 - pct(d.valor)}%`,
                )
                .join(" ")}
              fill="none"
              stroke={colorA}
              strokeWidth="3"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}
          {serieA.map((d, i) => (
            <g key={i}>
              <circle
                cx={`${serieA.length > 1 ? (i / (serieA.length - 1)) * 100 : 50}%`}
                cy={`${100 - pct(d.valor)}%`}
                r="6"
                fill={colorA}
                stroke="#fff"
                strokeWidth="2"
              />
              <title>
                {d.label}: {fn(d.valor)}
              </title>
            </g>
          ))}

          {/* Serie B */}
          {serieB.length > 1 && (
            <polyline
              points={serieB
                .map(
                  (d, i) =>
                    `${(i / (serieB.length - 1)) * 100}%,${100 - pct(d.valor)}%`,
                )
                .join(" ")}
              fill="none"
              stroke={colorB}
              strokeWidth="3"
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray="8,4"
            />
          )}
          {serieB.map((d, i) => (
            <g key={i}>
              <circle
                cx={`${serieB.length > 1 ? (i / (serieB.length - 1)) * 100 : 50}%`}
                cy={`${100 - pct(d.valor)}%`}
                r="6"
                fill={colorB}
                stroke="#fff"
                strokeWidth="2"
              />
              <title>
                {d.label}: {fn(d.valor)}
              </title>
            </g>
          ))}
        </svg>
      </div>

      {/* Labels eje X */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 6,
          paddingLeft: 16,
          paddingRight: 16,
        }}>
        {Array.from({ length: n }, (_, i) => (
          <span
            key={i}
            style={{
              fontSize: 11,
              color: "var(--text3)",
              fontFamily: "var(--font-mono)",
              fontWeight: 700,
            }}>
            S{i + 1}
          </span>
        ))}
      </div>
    </div>
  );
};

// ─── Gráfico barras verticales con dos series ────────────────────────────────
const GraficoBarrasDoble = ({
  datos,
  colorA = "#b87c00",
  colorB = "#005fa3",
  labelA,
  labelB,
}) => {
  const max = Math.max(...datos.map((d) => Math.max(d.a || 0, d.b || 0)), 1);
  return (
    <div>
      <div style={{ display: "flex", gap: 20, marginBottom: 14 }}>
        {[
          { l: labelA, c: colorA },
          { l: labelB, c: colorB },
        ].map((x) => (
          <div
            key={x.l}
            style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: 16,
                height: 16,
                background: x.c,
                borderRadius: 4,
              }}
            />
            <span
              style={{ fontSize: 13, fontWeight: 700, color: "var(--text2)" }}>
              {x.l}
            </span>
          </div>
        ))}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 6,
          height: 160,
        }}>
        {datos.map((d, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              height: "100%",
            }}>
            <div
              style={{
                flex: 1,
                width: "100%",
                display: "flex",
                alignItems: "flex-end",
                gap: 2,
              }}>
              {[
                { v: d.a, c: colorA },
                { v: d.b, c: colorB },
              ].map((b, j) => (
                <div
                  key={j}
                  style={{
                    flex: 1,
                    height: `${Math.round(((b.v || 0) / max) * 100)}%`,
                    background: b.c,
                    borderRadius: "4px 4px 0 0",
                    minHeight: b.v > 0 ? 3 : 0,
                    transition: "height .4s",
                    opacity: b.v > 0 ? 1 : 0.2,
                  }}
                  title={`${fn(b.v || 0)}`}
                />
              ))}
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--text3)",
                fontFamily: "var(--font-mono)",
                fontWeight: 700,
                marginTop: 4,
              }}>
              {d.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Barra horizontal simple ─────────────────────────────────────────────────
const BarraH = ({ label, value, max, color, sub, badge }) => (
  <div style={{ marginBottom: 14 }}>
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 5,
      }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>
          {label}
        </span>
        {badge && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: 20,
              background: "#e8f3ff",
              color: "#1e40af",
              border: "1px solid #60a5fa",
            }}>
            {badge}
          </span>
        )}
      </div>
      <span
        style={{
          fontSize: 14,
          fontWeight: 800,
          fontFamily: "var(--font-mono)",
          color,
        }}>
        {value}
      </span>
    </div>
    <div
      style={{
        height: 10,
        background: "var(--bg3)",
        borderRadius: 5,
        overflow: "hidden",
        border: "1px solid var(--border)",
      }}>
      <div
        style={{
          height: "100%",
          width: `${max ? Math.min(100, Math.round((parseFloat(String(value).replace(/[^0-9]/g, "")) / max) * 100)) : 0}%`,
          background: color,
          borderRadius: 5,
          transition: "width .4s",
        }}
      />
    </div>
    {sub && (
      <div
        style={{
          fontSize: 12,
          color: "var(--text3)",
          marginTop: 3,
          fontWeight: 600,
        }}>
        {sub}
      </div>
    )}
  </div>
);

// ─── Tarjeta KPI ─────────────────────────────────────────────────────────────
const KpiCard = ({
  icon,
  label,
  value,
  sub,
  color,
  bg,
  variacion,
  varAnterior,
}) => (
  <div
    style={{
      background: bg || "var(--bg2)",
      border: `2px solid ${color}44`,
      borderTop: `4px solid ${color}`,
      borderRadius: "var(--radius-lg)",
      padding: "18px 20px",
      boxShadow: "var(--shadow)",
    }}>
    <div style={{ fontSize: 26, marginBottom: 4 }}>{icon}</div>
    <div
      style={{
        fontSize: String(value).length > 9 ? 22 : 30,
        fontWeight: 900,
        fontFamily: "var(--font-mono)",
        color,
        lineHeight: 1.1,
        wordBreak: "break-word",
        overflowWrap: "anywhere",
      }}>
      {value}
    </div>
    <div
      style={{
        fontSize: 12,
        fontWeight: 800,
        color: "var(--text2)",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        margin: "5px 0 4px",
      }}>
      {label}
    </div>
    {sub && (
      <div
        style={{
          fontSize: 12,
          color: "var(--text3)",
          fontWeight: 600,
          marginBottom: 6,
        }}>
        {sub}
      </div>
    )}
    {variacion !== undefined && (
      <Variacion actual={variacion} anterior={varAnterior} />
    )}
  </div>
);

// ─── Tabla simple ─────────────────────────────────────────────────────────────
const Tabla = ({ cols, rows, vacia = "Sin datos" }) => (
  <div className="table-wrap">
    <table className="dash-table">
      <thead>
        <tr>
          {cols.map((c, i) => (
            <th key={i}>{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={cols.length} className="empty-state">
              {vacia}
            </td>
          </tr>
        ) : (
          rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j}>{c}</td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  </div>
);

// ══════════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ══════════════════════════════════════════════════════════════════════════════
export const TReportes = ({
  rM,
  aM,
  K,
  cfg,
  mes,
  setMes,
  regsAll = [],
  ausAll = [],
  loggedInUser,
  onXLSX,
  onPDF,
}) => {
  const dt = diasT(mes);
  const dh = diasH(mes);
  const [seccion, setSeccion] = useState("resumen");
  const [anioVer, setAnioVer] = useState(new Date().getFullYear());

  // ── Mes anterior
  const mesAnterior = useMemo(() => {
    const [y, m] = mes.split("-").map(Number);
    const d = new Date(y, m - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }, [mes]);

  const rMAnterior = useMemo(
    () => regsAll.filter((r) => r.fecha?.startsWith(mesAnterior)),
    [regsAll, mesAnterior],
  );

  // ── Semanas del mes actual y anterior
  const semanasActual = useMemo(() => {
    const map = {};
    rM.forEach((r) => {
      const k = semK(r.fecha);
      if (!map[k]) map[k] = { repartos: 0, bultos: 0, recargas: 0 };
      map[k].repartos++;
      map[k].bultos += +r.bultos || 0;
      map[k].recargas += r.nRecargas || 0;
    });
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
  }, [rM]);

  const semanasAnterior = useMemo(() => {
    const map = {};
    rMAnterior.forEach((r) => {
      const k = semK(r.fecha);
      if (!map[k]) map[k] = { repartos: 0, bultos: 0, recargas: 0 };
      map[k].repartos++;
      map[k].bultos += +r.bultos || 0;
      map[k].recargas += r.nRecargas || 0;
    });
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
  }, [rMAnterior]);

  // ── Totales mes actual vs anterior
  const totActual = {
    bultos: rM.reduce((s, r) => s + (+r.bultos || 0), 0),
    repartos: rM.length,
    recargas: rM.reduce((s, r) => s + (r.nRecargas || 0), 0),
  };
  const totAnterior = {
    bultos: rMAnterior.reduce((s, r) => s + (+r.bultos || 0), 0),
    repartos: rMAnterior.length,
    recargas: rMAnterior.reduce((s, r) => s + (r.nRecargas || 0), 0),
  };

  // ── Datos por chofer
  const porChofer = useMemo(() => {
    const map = {};
    rM.forEach((r) => {
      if (!r.chofer) return;
      if (!map[r.chofer])
        map[r.chofer] = { repartos: 0, bultos: 0, recargas: 0, costo: 0 };
      map[r.chofer].repartos++;
      map[r.chofer].bultos += +r.bultos || 0;
      map[r.chofer].recargas += r.nRecargas || 0;
      map[r.chofer].costo += +r.costoReparto || 0;
    });
    return Object.entries(map).sort((a, b) => b[1].bultos - a[1].bultos);
  }, [rM]);

  // ── Por destino / cliente
  const porDestino = useMemo(() => {
    const map = {};
    rM.forEach((r) => {
      if (!r.destino) return;
      if (!map[r.destino])
        map[r.destino] = {
          repartos: 0,
          bultos: 0,
          costo: 0,
          localidades: new Set(),
        };
      map[r.destino].repartos++;
      map[r.destino].bultos += +r.bultos || 0;
      map[r.destino].costo += +r.costoReparto || 0;
      if (r.localidad)
        map[r.destino].localidades.add(r.localidad.split(" (")[0]);
    });
    return Object.entries(map)
      .map(([dest, d]) => [dest, { ...d, localidades: [...d.localidades] }])
      .sort((a, b) => b[1].bultos - a[1].bultos);
  }, [rM]);

  // ── Histórico anual
  const historico = useMemo(() => {
    const anios = {};
    regsAll.forEach((r) => {
      if (!r.fecha) return;
      const [y, m] = r.fecha.split("-").map(Number);
      if (!anios[y]) anios[y] = {};
      if (!anios[y][m])
        anios[y][m] = { bultos: 0, repartos: 0, recargas: 0, costo: 0 };
      anios[y][m].bultos += +r.bultos || 0;
      anios[y][m].repartos++;
      anios[y][m].recargas += r.nRecargas || 0;
      anios[y][m].costo += +r.costoReparto || 0;
    });
    return anios;
  }, [regsAll]);

  const aniosDisponibles = Object.keys(historico)
    .map(Number)
    .sort((a, b) => b - a);
  const anioActual = new Date().getFullYear();

  // Ranking anual de meses
  const rankingMeses = useMemo(() => {
    const meses = [];
    Object.entries(historico).forEach(([y, ms]) => {
      Object.entries(ms).forEach(([m, d]) => {
        meses.push({
          year: +y,
          mes: +m,
          label: `${MESES_LABEL[+m - 1]} ${y}`,
          ...d,
        });
      });
    });
    return meses.sort((a, b) => b.bultos - a.bultos).slice(0, 12);
  }, [historico]);

  // Ranking clientes histórico
  const rankingClientes = useMemo(() => {
    const map = {};
    regsAll.forEach((r) => {
      if (!r.destino) return;
      if (!map[r.destino])
        map[r.destino] = { bultos: 0, repartos: 0, costo: 0, zonas: new Set() };
      map[r.destino].bultos += +r.bultos || 0;
      map[r.destino].repartos++;
      map[r.destino].costo += +r.costoReparto || 0;
      if (r.localidad)
        map[r.destino].zonas.add(isT(r.localidad) ? "Tandil" : "Las Flores");
    });
    return Object.entries(map)
      .map(([dest, d]) => [dest, { ...d, zonas: [...d.zonas] }])
      .sort((a, b) => b[1].bultos - a[1].bultos);
  }, [regsAll]);

  const maxBultosCliente = rankingClientes[0]?.[1]?.bultos || 1;
  const maxBultosChofer = porChofer[0]?.[1]?.bultos || 1;

  // Datos para gráfico año vs año
  const datosAnioVer = historico[anioVer] || {};
  const datosAnioComp = historico[anioVer - 1] || {};
  // Avance del mes: solo tiene sentido si hay datos cargados en el mes
  const avanceMes = (dh && rM.length > 0) ? Math.round((dt / dh) * 100) : 0;
  const coloresMotivo = {
    Vacaciones: "#005fa3",
    Licencia: "#b91c1c",
    "Día Libre": "#5b21b6",
    Enfermedad: "#b87c00",
    "Sin Reparto": "#475569",
    Accidente: "#dc2626",
    Permiso: "#166534",
  };

  const porMotivo = useMemo(() => {
    const map = {};
    aM.forEach((a) => {
      map[a.motivo] = (map[a.motivo] || 0) + (a.dias || 1);
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [aM]);

  const tabs = [
    { id: "resumen", label: "📊 Resumen" },
    { id: "semanal", label: "📅 Semanal" },
    { id: "choferes", label: "🚛 Choferes" },
    { id: "clientes", label: "🏪 Clientes" },
    { id: "ausencias", label: "📋 Ausencias" },
    { id: "historico", label: "📈 Histórico" },
  ];

  return (
    <div className="dash-container">
      {/* Header */}
      <div className="dash-header">
        <div>
          <h2 className="dash-title">Reportes</h2>
          <p className="dash-sub">
            Análisis completo · {mes} · {dt}/{dh} días hábiles ({avanceMes}% del
            mes)
          </p>
        </div>
        <div className="dash-header-right">
          <MesSelector value={mes} onChange={setMes} regs={regsAll} aus={ausAll} />
          {(!loggedInUser || loggedInUser.role === 'admin') && (
            <>
              <button className="btn-action btn-secondary-action" onClick={onXLSX}>
                ↓ Excel
              </button>
              <button className="btn-action btn-secondary-action" onClick={onPDF}>
                ⎙ PDF
              </button>
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
          background: "var(--bg2)",
          padding: "10px 14px",
          borderRadius: "var(--radius-lg)",
          border: "2px solid var(--border)",
          boxShadow: "var(--shadow)",
        }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setSeccion(t.id)}
            style={{
              padding: "9px 18px",
              borderRadius: 10,
              border: "none",
              cursor: "pointer",
              fontFamily: "var(--font-head)",
              fontSize: 14,
              fontWeight: 700,
              background: seccion === t.id ? "var(--accent)" : "var(--bg3)",
              color: seccion === t.id ? "#fff" : "var(--text2)",
              transition: "all .15s",
              boxShadow:
                seccion === t.id ? "0 2px 8px rgba(184,124,0,.3)" : "none",
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ══ RESUMEN ══════════════════════════════════════════════════════════ */}
      {seccion === "resumen" && (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 14,
            }}>
            <KpiCard
              icon="🚛"
              label="Repartos"
              value={fn(rM.length)}
              sub={`${dt} días trabajados`}
              color="#b87c00"
              bg="#fff7e0"
              variacion={totActual.repartos}
              varAnterior={totAnterior.repartos}
            />
            <KpiCard
              icon="📦"
              label="Bultos"
              value={fn(K.bultos || 0)}
              sub={`Prom. ${fn(dt ? Math.round((K.bultos || 0) / dt) : 0)}/día`}
              color="#005fa3"
              bg="#e8f3ff"
              variacion={totActual.bultos}
              varAnterior={totAnterior.bultos}
            />
            <KpiCard
              icon="⚡"
              label="Recargas"
              value={fn(K.recargas || 0)}
              sub={`${K.recSI || 0} repartos afectados`}
              color="#b91c1c"
              bg="#fff1f1"
              variacion={totActual.recargas}
              varAnterior={totAnterior.recargas}
              invertido
            />
            <KpiCard
              icon="📋"
              label="Ausencias"
              value={fn(aM.length)}
              sub={`${[...new Set(aM.map((a) => a.persona))].length} personas`}
              color="#5b21b6"
              bg="#f5f0ff"
            />
            <KpiCard
              icon="📈"
              label="Avance del Mes"
              value={`${avanceMes}%`}
              sub={`${dt} de ${dh} días hábiles`}
              color="#166534"
              bg="#f0fdf4"
            />
            <KpiCard
              icon="💰"
              label="Costo Total"
              value={fp(rM.reduce((s, r) => s + (+r.costoReparto || 0), 0))}
              sub="repartos registrados"
              color="#475569"
              bg="#f8fafc"
            />
          </div>

          {/* Comparativo vs mes anterior */}
          <div className="dash-card">
            <div className="card-header">
              <span className="card-title">Comparativo vs Mes Anterior</span>
              <span className="card-badge">
                {mes} vs {mesAnterior}
              </span>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 16,
              }}>
              {[
                {
                  label: "Repartos",
                  actual: totActual.repartos,
                  anterior: totAnterior.repartos,
                  icon: "🚛",
                  color: "#b87c00",
                },
                {
                  label: "Bultos",
                  actual: totActual.bultos,
                  anterior: totAnterior.bultos,
                  icon: "📦",
                  color: "#005fa3",
                },
                {
                  label: "Recargas",
                  actual: totActual.recargas,
                  anterior: totAnterior.recargas,
                  icon: "⚡",
                  color: "#b91c1c",
                  invertido: true,
                },
              ].map((c) => (
                <div
                  key={c.label}
                  style={{
                    background: "var(--bg3)",
                    borderRadius: "var(--radius)",
                    padding: "16px 18px",
                    border: "2px solid var(--border)",
                    textAlign: "center",
                  }}>
                  <div style={{ fontSize: 22 }}>{c.icon}</div>
                  <div
                    style={{
                      fontSize: 26,
                      fontWeight: 900,
                      fontFamily: "var(--font-mono)",
                      color: c.color,
                      margin: "6px 0 2px",
                    }}>
                    {fn(c.actual)}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 800,
                      color: "var(--text3)",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      marginBottom: 8,
                    }}>
                    {c.label}
                  </div>
                  <Variacion
                    actual={c.actual}
                    anterior={c.anterior}
                    invertido={c.invertido}
                  />
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--text3)",
                      marginTop: 6,
                      fontWeight: 600,
                    }}>
                    Anterior: {fn(c.anterior)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ══ SEMANAL ══════════════════════════════════════════════════════════ */}
      {seccion === "semanal" && (
        <>
          {/* Explicación */}
          <div
            style={{
              background: "#e8f3ff",
              border: "2px solid #60a5fa",
              borderRadius: "var(--radius)",
              padding: "14px 18px",
              display: "flex",
              gap: 12,
            }}>
            <span style={{ fontSize: 22 }}>📅</span>
            <div>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 800,
                  color: "#1e40af",
                  marginBottom: 3,
                }}>
                Semana a semana: mes actual vs mes anterior
              </div>
              <div
                style={{
                  fontSize: 14,
                  color: "#1e3a8a",
                  fontWeight: 600,
                  lineHeight: 1.6,
                }}>
                La <strong>línea dorada</strong> es el mes actual ({mes}). La{" "}
                <strong>línea azul punteada</strong> es el mes anterior (
                {mesAnterior}). S1 = primera semana del mes, S2 = segunda, y
                así.
              </div>
            </div>
          </div>

          {/* Gráfico de líneas — Bultos */}
          <div className="dash-card">
            <div className="card-header">
              <span className="card-title">
                📦 Bultos por semana — comparativo
              </span>
            </div>
            <GraficoLineas
              serieA={semanasActual.map(([k, d], i) => ({
                label: `Semana ${i + 1}`,
                valor: d.bultos,
              }))}
              serieB={semanasAnterior.map(([k, d], i) => ({
                label: `Semana ${i + 1}`,
                valor: d.bultos,
              }))}
              labelA={mes}
              labelB={mesAnterior}
            />
          </div>

          {/* Gráfico barras doble — Repartos */}
          <div className="dash-card">
            <div className="card-header">
              <span className="card-title">
                🚛 Repartos por semana — comparativo
              </span>
            </div>
            <GraficoBarrasDoble
              datos={Array.from(
                {
                  length: Math.max(
                    semanasActual.length,
                    semanasAnterior.length,
                  ),
                },
                (_, i) => ({
                  label: `S${i + 1}`,
                  a: semanasActual[i]?.[1]?.repartos || 0,
                  b: semanasAnterior[i]?.[1]?.repartos || 0,
                }),
              )}
              labelA={mes}
              labelB={mesAnterior}
            />
          </div>

          {/* Tabla semana a semana */}
          <div className="dash-card">
            <div className="card-header">
              <span className="card-title">Detalle semana a semana</span>
            </div>
            <Tabla
              cols={[
                "Semana",
                `Bultos ${mes}`,
                `Bultos ${mesAnterior}`,
                "Variación",
                `Repartos ${mes}`,
                `Repartos ${mesAnterior}`,
              ]}
              rows={Array.from(
                {
                  length: Math.max(
                    semanasActual.length,
                    semanasAnterior.length,
                  ),
                },
                (_, i) => {
                  const a = semanasActual[i]?.[1];
                  const b = semanasAnterior[i]?.[1];
                  return [
                    <strong>Semana {i + 1}</strong>,
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontWeight: 700,
                        color: "#b87c00",
                      }}>
                      {fn(a?.bultos || 0)}
                    </span>,
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        color: "var(--text3)",
                      }}>
                      {fn(b?.bultos || 0)}
                    </span>,
                    <Variacion
                      actual={a?.bultos || 0}
                      anterior={b?.bultos || 0}
                    />,
                    fn(a?.repartos || 0),
                    <span style={{ color: "var(--text3)" }}>
                      {fn(b?.repartos || 0)}
                    </span>,
                  ];
                },
              )}
              vacia="Sin datos"
            />
          </div>
        </>
      )}

      {/* ══ CHOFERES ═════════════════════════════════════════════════════════ */}
      {seccion === "choferes" && (
        <>
          <div className="dash-card">
            <div className="card-header">
              <span className="card-title">Bultos por Chofer este mes</span>
            </div>
            {porChofer.length === 0 && (
              <div className="empty-state">Sin datos este mes</div>
            )}
            {porChofer.map(([name, d], i) => (
              <BarraH
                key={name}
                label={`${i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`} ${name}`}
                value={fn(d.bultos)}
                max={maxBultosChofer}
                color={
                  i === 0
                    ? "#b87c00"
                    : i === 1
                      ? "#64748b"
                      : i === 2
                        ? "#b45309"
                        : "var(--accent2)"
                }
                sub={`${d.repartos} repartos · ${d.recargas} recargas${d.costo ? ` · ${fp(d.costo)}` : ""}`}
              />
            ))}
          </div>
          <div className="dash-card">
            <div className="card-header">
              <span className="card-title">Tabla detallada Choferes</span>
            </div>
            <Tabla
              cols={[
                "#",
                "Chofer",
                "Repartos",
                "Bultos",
                "Recargas",
                "Prom. bultos/rep.",
                "Costo total",
              ]}
              rows={porChofer.map(([name, d], i) => [
                <span style={{ fontWeight: 800, color: "var(--text3)" }}>
                  {i + 1}
                </span>,
                <strong>{name}</strong>,
                d.repartos,
                <strong
                  style={{
                    color: "var(--accent)",
                    fontFamily: "var(--font-mono)",
                  }}>
                  {fn(d.bultos)}
                </strong>,
                <span
                  style={{
                    color: d.recargas > 0 ? "var(--red)" : "var(--green)",
                    fontWeight: 700,
                  }}>
                  {d.recargas}
                </span>,
                <span style={{ fontFamily: "var(--font-mono)" }}>
                  {d.repartos ? fn(Math.round(d.bultos / d.repartos)) : "—"}
                </span>,
                <span style={{ fontFamily: "var(--font-mono)" }}>
                  {d.costo ? fp(d.costo) : "—"}
                </span>,
              ])}
              vacia="Sin datos este mes"
            />
          </div>
        </>
      )}

      {/* ══ CLIENTES ═════════════════════════════════════════════════════════ */}
      {seccion === "clientes" && (
        <>
          {/* Ranking del mes */}
          <div className="dash-card">
            <div className="card-header">
              <span className="card-title">🏆 Ranking de Clientes — {mes}</span>
              <span className="card-badge">Por volumen de bultos</span>
            </div>
            {porDestino.length === 0 && (
              <div className="empty-state">Sin datos este mes</div>
            )}
            {porDestino.map(([dest, d], i) => (
              <BarraH
                key={dest}
                label={`${i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`} ${dest}`}
                value={fn(d.bultos)}
                max={porDestino[0]?.[1]?.bultos || 1}
                color={
                  i === 0
                    ? "#b87c00"
                    : i === 1
                      ? "#64748b"
                      : i === 2
                        ? "#b45309"
                        : "#005fa3"
                }
                badge={d.localidades.join(" · ")}
                sub={`${d.repartos} repartos · Costo: ${d.costo ? fp(d.costo) : "no registrado"}`}
              />
            ))}
          </div>

          {/* Tabla mes actual */}
          <div className="dash-card">
            <div className="card-header">
              <span className="card-title">
                Detalle por Cliente — mes actual
              </span>
            </div>
            <Tabla
              cols={[
                "#",
                "Cliente",
                "Zonas",
                "Repartos",
                "Bultos",
                "Prom. bultos/rep.",
                "Costo total",
              ]}
              rows={porDestino.map(([dest, d], i) => [
                <span style={{ fontWeight: 800, color: "var(--text3)" }}>
                  {i + 1}
                </span>,
                <strong>{dest}</strong>,
                <span style={{ fontSize: 12, color: "var(--text3)" }}>
                  {d.localidades.join(", ") || "—"}
                </span>,
                d.repartos,
                <strong
                  style={{
                    color: "var(--accent)",
                    fontFamily: "var(--font-mono)",
                  }}>
                  {fn(d.bultos)}
                </strong>,
                <span style={{ fontFamily: "var(--font-mono)" }}>
                  {d.repartos ? fn(Math.round(d.bultos / d.repartos)) : "—"}
                </span>,
                <span style={{ fontFamily: "var(--font-mono)" }}>
                  {d.costo ? fp(d.costo) : "—"}
                </span>,
              ])}
              vacia="Sin datos este mes"
            />
          </div>

          {/* Ranking histórico */}
          <div className="dash-card">
            <div className="card-header">
              <span className="card-title">
                🏆 Ranking Histórico de Clientes
              </span>
              <span className="card-badge">Todos los registros cargados</span>
            </div>
            {rankingClientes.length === 0 && (
              <div className="empty-state">Sin datos históricos</div>
            )}
            {rankingClientes.map(([dest, d], i) => (
              <BarraH
                key={dest}
                label={`${i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`} ${dest}`}
                value={fn(d.bultos)}
                max={maxBultosCliente}
                color={i < 3 ? ["#b87c00", "#64748b", "#b45309"][i] : "#005fa3"}
                badge={d.zonas.join(" · ")}
                sub={`${d.repartos} repartos históricos · Costo acumulado: ${d.costo ? fp(d.costo) : "no registrado"}`}
              />
            ))}
          </div>
        </>
      )}

      {/* ══ AUSENCIAS ════════════════════════════════════════════════════════ */}
      {seccion === "ausencias" && (
        <>
          <div className="dash-grid-2">
            <div className="dash-card">
              <div className="card-header">
                <span className="card-title">Días por Motivo</span>
              </div>
              {porMotivo.length === 0 && (
                <div className="empty-state">Sin ausencias este mes</div>
              )}
              {porMotivo.map(([motivo, dias]) => (
                <BarraH
                  key={motivo}
                  label={motivo}
                  value={`${dias} día${dias !== 1 ? "s" : ""}`}
                  max={porMotivo[0]?.[1] || 1}
                  color={coloresMotivo[motivo] || "var(--accent)"}
                />
              ))}
            </div>
            <div className="dash-card">
              <div className="card-header">
                <span className="card-title">Días por Persona</span>
              </div>
              {(() => {
                const map = {};
                aM.forEach((a) => {
                  map[a.persona] = (map[a.persona] || 0) + (a.dias || 1);
                });
                const lista = Object.entries(map).sort((a, b) => b[1] - a[1]);
                return lista.length === 0 ? (
                  <div className="empty-state">Sin ausencias este mes</div>
                ) : (
                  lista.map(([name, dias]) => (
                    <BarraH
                      key={name}
                      label={name}
                      value={`${dias}d`}
                      max={lista[0]?.[1] || 1}
                      color={
                        dias >= 5
                          ? "#b91c1c"
                          : dias >= 3
                            ? "#b87c00"
                            : "#5b21b6"
                      }
                    />
                  ))
                );
              })()}
            </div>
          </div>
          <div className="dash-card">
            <div className="card-header">
              <span className="card-title">Detalle de Ausencias</span>
              <span className="card-badge">{aM.length} registros</span>
            </div>
            <Tabla
              cols={[
                "Persona",
                "Motivo",
                "Desde",
                "Hasta",
                "Días",
                "Observaciones",
              ]}
              rows={aM.map((a) => [
                <strong>{a.persona}</strong>,
                <span
                  style={{
                    display: "inline-block",
                    padding: "3px 10px",
                    borderRadius: 20,
                    fontSize: 12,
                    fontWeight: 700,
                    background: (coloresMotivo[a.motivo] || "#475569") + "18",
                    color: coloresMotivo[a.motivo] || "#475569",
                    border: `1px solid ${coloresMotivo[a.motivo] || "#475569"}44`,
                  }}>
                  {a.motivo}
                </span>,
                a.fechaDesde,
                a.fechaHasta || "—",
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontWeight: 700,
                    color: "var(--accent)",
                  }}>
                  {a.dias || 1}
                </span>,
                <span style={{ color: "var(--text3)", fontStyle: "italic" }}>
                  {a.observaciones || "—"}
                </span>,
              ])}
              vacia="Sin ausencias este mes"
            />
          </div>
        </>
      )}

      {/* ══ HISTÓRICO ANUAL ══════════════════════════════════════════════════ */}
      {seccion === "historico" && (
        <>
          {/* Selector de año */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              background: "var(--bg2)",
              padding: "14px 20px",
              borderRadius: "var(--radius-lg)",
              border: "2px solid var(--border)",
              boxShadow: "var(--shadow)",
              flexWrap: "wrap",
            }}>
            <span
              style={{ fontSize: 15, fontWeight: 800, color: "var(--text2)" }}>
              Comparar año:
            </span>
            {aniosDisponibles.length === 0 ? (
              <span style={{ color: "var(--text3)", fontSize: 14 }}>
                Cargá más datos para ver el historial
              </span>
            ) : (
              aniosDisponibles.map((y) => (
                <button
                  key={y}
                  onClick={() => setAnioVer(y)}
                  style={{
                    padding: "8px 18px",
                    borderRadius: 10,
                    border: "none",
                    cursor: "pointer",
                    fontFamily: "var(--font-head)",
                    fontSize: 14,
                    fontWeight: 700,
                    background: anioVer === y ? "var(--accent)" : "var(--bg3)",
                    color: anioVer === y ? "#fff" : "var(--text2)",
                    transition: "all .15s",
                  }}>
                  {y}
                </button>
              ))
            )}
          </div>

          {/* Gráfico mes a mes año vs año */}
          <div className="dash-card">
            <div className="card-header">
              <span className="card-title">
                📦 Bultos mes a mes — {anioVer} vs {anioVer - 1}
              </span>
            </div>
            <GraficoBarrasDoble
              datos={Array.from({ length: 12 }, (_, i) => ({
                label: MESES_LABEL[i],
                a: datosAnioVer[i + 1]?.bultos || 0,
                b: datosAnioComp[i + 1]?.bultos || 0,
              }))}
              labelA={String(anioVer)}
              labelB={String(anioVer - 1)}
            />
          </div>

          {/* Gráfico repartos */}
          <div className="dash-card">
            <div className="card-header">
              <span className="card-title">
                🚛 Repartos mes a mes — {anioVer} vs {anioVer - 1}
              </span>
            </div>
            <GraficoLineas
              serieA={Array.from({ length: 12 }, (_, i) => ({
                label: MESES_LABEL[i],
                valor: datosAnioVer[i + 1]?.repartos || 0,
              }))}
              serieB={Array.from({ length: 12 }, (_, i) => ({
                label: MESES_LABEL[i],
                valor: datosAnioComp[i + 1]?.repartos || 0,
              }))}
              labelA={String(anioVer)}
              labelB={String(anioVer - 1)}
            />
          </div>

          {/* Ranking mejores meses */}
          <div className="dash-card">
            <div className="card-header">
              <span className="card-title">
                🏆 Ranking — Mejores meses históricos
              </span>
              <span className="card-badge">Por bultos entregados</span>
            </div>
            {rankingMeses.length === 0 && (
              <div className="empty-state">Sin datos históricos cargados</div>
            )}
            {rankingMeses.map((m, i) => (
              <BarraH
                key={`${m.year}-${m.mes}`}
                label={`${i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`} ${m.label}`}
                value={fn(m.bultos)}
                max={rankingMeses[0]?.bultos || 1}
                color={
                  COLORES_ANIO[
                    aniosDisponibles.indexOf(m.year) % COLORES_ANIO.length
                  ] || "#b87c00"
                }
                sub={`${m.repartos} repartos · ${m.recargas} recargas${m.costo ? ` · ${fp(m.costo)}` : ""}`}
              />
            ))}
          </div>

          {/* Tabla resumen anual */}
          <div className="dash-card">
            <div className="card-header">
              <span className="card-title">
                Tabla Resumen Anual — {anioVer}
              </span>
            </div>
            <Tabla
              cols={[
                "Mes",
                "Repartos",
                `Bultos`,
                `Recargas`,
                "Costo total",
                "vs Año anterior",
              ]}
              rows={Array.from({ length: 12 }, (_, i) => {
                const cur = datosAnioVer[i + 1] || {};
                const prev = datosAnioComp[i + 1] || {};
                return [
                  <strong>{MESES_LABEL[i]}</strong>,
                  <span style={{ fontFamily: "var(--font-mono)" }}>
                    {cur.repartos ? fn(cur.repartos) : "—"}
                  </span>,
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontWeight: 700,
                      color: cur.bultos ? "var(--accent)" : "var(--text3)",
                    }}>
                    {cur.bultos ? fn(cur.bultos) : "—"}
                  </span>,
                  <span
                    style={{
                      color: cur.recargas > 0 ? "var(--red)" : "var(--text3)",
                      fontWeight: 700,
                    }}>
                    {cur.recargas || "—"}
                  </span>,
                  <span style={{ fontFamily: "var(--font-mono)" }}>
                    {cur.costo ? fp(cur.costo) : "—"}
                  </span>,
                  cur.bultos && prev.bultos ? (
                    <Variacion actual={cur.bultos} anterior={prev.bultos} />
                  ) : (
                    <span style={{ color: "var(--text3)", fontSize: 12 }}>
                      sin datos
                    </span>
                  ),
                ];
              })}
              vacia="Sin datos para este año"
            />
          </div>
        </>
      )}
    </div>
  );
};