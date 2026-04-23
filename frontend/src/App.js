// src/App.js — Versión con backend Neon
import React, { useState, useEffect, useMemo, useCallback } from "react";
import "./styles/custom.css";
import { exportarReporteXLSX } from "./utils/exportXLSX";

import { TDash } from "./components/TDash";
import { TRegs } from "./components/TRegs";
import { TAus } from "./components/TAus";
import { TConfig } from "./components/TConfig";
import { MReg } from "./components/MReg";
import { MAus } from "./components/MAus";
import { TMigracion } from "./components/TMigracion";
import { TPersonal } from "./components/TPersonal";
import { TCostos } from "./components/TCostos";
import { TReportes } from "./components/TReportes";
import { TRechazos } from "./components/TRechazos";
import { TFoxtrot } from "./components/TFoxtrot";
import { TImportacion } from "./components/TImportacion";
import { TNotas } from "./components/TNotas";
import { TBiolinks } from "./components/TBiolinks";

import { DC } from "./constants";
import { PERMISOS_DEFAULTS, normalizarUsuario } from "./config/permissions";
import { mesN, isT } from "./utils/helpers";

import {
  getRegistros,
  crearRegistro,
  actualizarRegistro,
  eliminarRegistro,
  getAusencias,
  crearAusencia,
  actualizarAusencia,
  eliminarAusencia,
  getConfig,
  guardarConfig,
  getRechazos,
  importarRechazos,
  editarRechazo,
  eliminarRechazo,
  getBultosPorMes,
  getNotas,
  crearNota,
  actualizarNota,
  eliminarNota,
  getFoxtrotKpisPorChofer,
  getChecklists,
  guardarChecklist,
} from "./api/client";

// ─── Pantalla de carga / error ────────────────────────────────────────────────
const Cargando = ({ error }) => (
  <div
    style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "#f8fafc",
    }}>
    <div style={{ textAlign: "center", padding: 40 }}>
      {error ? (
        <>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <div
            style={{
              fontSize: 20,
              fontWeight: 800,
              color: "#b91c1c",
              marginBottom: 8,
            }}>
            No se pudo conectar al servidor
          </div>
          <div
            style={{
              fontSize: 14,
              color: "#64748b",
              maxWidth: 420,
              lineHeight: 1.8,
              marginBottom: 20,
            }}>
            {error}
            <br />
            <br />
            Verificá que el backend esté corriendo:
            <br />
            <code
              style={{
                background: "#f1f5f9",
                padding: "4px 10px",
                borderRadius: 6,
                fontSize: 13,
              }}>
              cd backend &amp;&amp; npm start
            </code>
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "10px 28px",
              background: "#005fa3",
              color: "#fff",
              border: "none",
              borderRadius: 10,
              fontSize: 15,
              fontWeight: 700,
              cursor: "pointer",
            }}>
            Reintentar
          </button>
        </>
      ) : (
        <>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🚛</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#64748b" }}>
            Cargando sistema...
          </div>
        </>
      )}
    </div>
  </div>
);

// ════════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [menuOpen, setMenuOpen] = useState(false);
  const [regs, setRegs] = useState([]);
  const [aus, setAus] = useState([]);
  const [cfg, setCfg] = useState(DC);
  const [rechazos, setRechazos] = useState([]);
  const [debugRechazos, setDebugRechazos] = useState([]);
  const [bultosXMes, setBultosXMes] = useState({});
  const [mes, setMes] = useState(mesN());
  const [toast, setToast] = useState(null);
  const [modal, setModal] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [errConex, setErrConex] = useState(null);
  const [mostrarMigracion, setMostrarMigracion] = useState(false);

  const [loggedInUser, setLoggedInUser] = useState(null);
  const [loginNombre, setLoginNombre] = useState("");
  const [loginDni, setLoginDni] = useState("");
  const [loginError, setLoginError] = useState("");

  const [cargandoFoxtrotKpis, setCargandoFoxtrotKpis] = useState(false);
  const [foxtrotKpis, setFoxtrotKpis] = useState([]);
  const [checklistCompletado, setChecklistCompletado] = useState(true); // Bloqueo si es false
  const [checklistsHoy, setChecklistsHoy] = useState([]);

  // ── Restauración de sesión Persistente ──────────────────
  useEffect(() => {
    const savedUser = localStorage.getItem("bt_user_session");
    if (savedUser) {
      try {
        const user = JSON.parse(savedUser);
        if (user && user.dni) {
          setLoggedInUser(user);
          // Reiniciar sincronización de pestañas para el usuario restaurado
          const sessionKey = `app_session_${user.dni}`;
          const sessionId = Math.random().toString(36).substring(2, 15);
          sessionStorage.setItem(sessionKey, sessionId);
          if (!window.activeSessions) window.activeSessions = {};
          window.activeSessions[user.dni] = sessionId;
        }
      } catch (e) {
        console.error("Error restaurando sesión:", e);
        localStorage.removeItem("bt_user_session");
      }
    }
  }, []);

  // ── Recordatorio de Checklist (07:15 AM) ──────────────────
  useEffect(() => {
    const role = String(loggedInUser?.role || "").toLowerCase();
    if (!loggedInUser || role !== "chofer") return;

    // Solicitar permiso de notificaciones solo la primera vez que inicia sesión como chofer
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }

    const checkChecklist = () => {
      const ahora = new Date();
      const hora = ahora.getHours();
      const mins = ahora.getMinutes();
      const hoy = ahora.toLocaleDateString('sv-SE');

      // Verificamos si ya pasó el horario límite (07:15) y no notificamos hoy
      if (
        (hora > 7 || (hora === 7 && mins >= 15)) &&
        localStorage.getItem("last_checklist_notify") !== hoy
      ) {
        // En lugar de una alerta invasiva, usamos notificaciones del navegador
        // Verificamos de forma inteligente si ya hizo algún registro hoy
        const yaHizoRegistro = regs.some(
          (r) =>
            r.fecha === hoy &&
            (r.chofer === loggedInUser.nombre ||
              r.createdByDni === loggedInUser.dni),
        );

        if (!yaHizoRegistro && Notification.permission === "granted") {
          navigator.serviceWorker.ready.then((registration) => {
            registration.showNotification("📋 Control de Camión", {
              body: "Debes realizar el check list del camión antes de salir a ruta.",
              icon: "/icon-day.png",
              badge: "/icon-day.png",
              tag: "checklist-reminder",
              vibrate: [200, 100, 200],
              data: { url: window.location.origin }
            });
            localStorage.setItem("last_checklist_notify", hoy);
          });
        }
      }
    };

    // Revisar al montar y luego cada 5 minutos
    checkChecklist();
    const interval = setInterval(checkChecklist, 300000);
    return () => clearInterval(interval);
  }, [loggedInUser, regs]);

  const notify = useCallback((msg, type = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const normalizarNombre = useCallback((s) => {
    if (!s) return "";
    // Elimina caracteres invisibles y espacios de no-ruptura comunes en teclados móviles
    const limpio = String(s)
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\u00A0/g, " ");
    return normalizarUsuario(limpio);
  }, []);

  const usuarioCoincide = useCallback((entrada, registro) => {
    const entradaNorm = normalizarNombre(entrada);
    const registroNorm = normalizarNombre(registro || "");
    if (!entradaNorm || !registroNorm) return false;

    // Coincidencia exacta (después de normalizar)
    if (entradaNorm === registroNorm) return true;

    const tokensE = entradaNorm.split(" ").filter(Boolean);
    const tokensR = registroNorm.split(" ").filter(Boolean);

    // Verificación por tokens (orden indistinto)
    if (tokensE.length >= 2 && tokensR.length >= 2) {
      // Si todos los tokens de la entrada están en el registro, o viceversa
      const matchE = tokensE.every(t => tokensR.includes(t));
      const matchR = tokensR.every(t => tokensE.includes(t));
      if (matchE || matchR) return true;
    }

    // Fallback: si uno contiene al otro
    if (entradaNorm.includes(registroNorm) || registroNorm.includes(entradaNorm)) return true;

    // Single token match: si uno tiene 1 token y el otro lo contiene
    if (tokensE.length === 1 && tokensR.some((t) => t === tokensE[0]))
      return true;
    if (tokensR.length === 1 && tokensE.some((t) => t === tokensR[0]))
      return true;

    return false;
  }, [normalizarNombre]);

  const validarCredenciales = (nombre, dni) => {
    const usuarios = Array.isArray(cfg.usuarios) ? cfg.usuarios : [];
    if (!usuarios.length)
      return {
        ok: false,
        msg: "No hay usuarios configurados. Agrega al menos uno en Config.",
      };
    const isSpecialAdmin = String(dni || "").toLowerCase() === 'admin';
    const dniClean = isSpecialAdmin ? 'admin' : String(dni || "").replace(/\D/g, ""); 
    
    if (!dniClean) return { ok: false, msg: "Ingrese DNI." };
    
    const match = usuarios.find((u) => {
      const dbDniRaw = String(u.dni || "");
      const dbDniClean = dbDniRaw.replace(/\D/g, "");
      
      // Si el DNI en DB es 'admin', comparamos exacto
      if (dbDniRaw.toLowerCase() === 'admin') {
        return dniClean === 'admin' && usuarioCoincide(nombre, u.nombre);
      }
      
      if (!dbDniClean || dbDniClean !== dniClean) return false;
      return usuarioCoincide(nombre, u.nombre);
    });

    if (!match) {
      console.warn("Login fallido:", { nombreTyped: nombre, dniTyped: dniClean });
    }

    return match
      ? { ok: true, user: match }
      : { ok: false, msg: `Usuario o DNI incorrecto. (DNI detectado: ${dniClean})` };
  };

  // ── Sincronización Checklist (Choferes) ──────────────────
  useEffect(() => {
    const role = String(loggedInUser?.role || "").toLowerCase();
    if (!loggedInUser || role !== "chofer") {
      setChecklistCompletado(true);
      return;
    }
    // Usar fecha local (Argentina) para el checklist, no UTC
    const hoy = new Date().toLocaleDateString('sv-SE'); // sv-SE da YYYY-MM-DD
    getChecklists(hoy)
      .then((res) => {
        const yaLoHizo = res.some((c) => c.dni === loggedInUser.dni);
        setChecklistCompletado(yaLoHizo);
      })
      .catch(() => setChecklistCompletado(true)); // En caso de error api no bloquear compulsivamente
  }, [loggedInUser]);

  const handleChecklistConfirm = async (estado = "completado") => {
    const hoy = new Date().toLocaleDateString('sv-SE');
    try {
      await guardarChecklist({
        chofer: loggedInUser.nombre,
        dni: loggedInUser.dni,
        fecha: hoy,
        estado: estado,
      });
      setChecklistCompletado(true);
      notify(
        estado === "completado"
          ? "✓ Checklist confirmado"
          : "ℹ️ Registrado como 'Sin ruta'",
      );
      refrescarDatos(true); // Refrescar para que el admin lo vea
    } catch (err) {
      console.error("Error confirmando checklist:", err);
      notify(`❌ Error al guardar estado: ${err.message}`, "w");
    }
  };

  const handleLogin = () => {
    const result = validarCredenciales(loginNombre, loginDni);
    if (!result.ok) {
      setLoginError(result.msg);
      // En móvil, a veces el usuario no ve el error, lo forzamos con un alert si es necesario
      if (window.innerWidth < 768) alert("Error de acceso: " + result.msg);
      return;
    }
    const user = result.user;

    if (user.nombre === "Administrador" && user.dni === "admin") {
      user.role = "admin";
      // El admin principal siempre tiene permiso de editar contenido
      if (!user.permisos) user.permisos = {};
      user.permisos.editar_contenido = true;
    }

    setLoggedInUser(user);
    // Persistencia de sesión para móviles/PWA
    localStorage.setItem("bt_user_session", JSON.stringify(user));
    
    setLoginError("");
    setLoginNombre("");
    setLoginDni("");
    // Para choferes y ayudantes, mostrar primero la pestaña de Links
    const role = String(user.role || "").toLowerCase();
    if (role === "chofer" || role === "ayudante") {
      setTab("biolinks");
    }
    notify(`✓ Bienvenido ${result.user.nombre}`);
  };

  // ── Seguridad de Sesión (Evitar doble login) ──────────────────
  useEffect(() => {
    if (!loggedInUser) return;

    const userDni = loggedInUser.dni;
    const sessionKey = `app_session_${userDni}`;
    
    // Si no hay sessionId en esta pestaña, creamos uno
    let sessionId = sessionStorage.getItem(sessionKey);
    if (!sessionId) {
      sessionId = Math.random().toString(36).substring(2, 15);
      sessionStorage.setItem(sessionKey, sessionId);
    }

    const handleStorageChange = (e) => {
      if (e.key === sessionKey && e.newValue && e.newValue !== sessionId) {
        handleLogout();
        alert("⚠️ Sesión cerrada: se detectó inicio de sesión en otro dispositivo/navegador");
      }
    };

    window.addEventListener("storage", handleStorageChange);

    // Verificación proactiva cada 5s por si el evento storage no llega
    const interval = setInterval(() => {
      const current = sessionStorage.getItem(sessionKey);
      if (current && current !== sessionId) {
        handleLogout();
      }
    }, 5000);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      clearInterval(interval);
    };
  }, [loggedInUser]);

  const handleLogout = () => {
    localStorage.removeItem("bt_user_session");
    setLoggedInUser(null);
    setLoginError("");
    setToast(null);
    setTab("dashboard");
  };

  // ── Función para Refrescar Datos (Polling) ──────────────────────────────────
  const refrescarDatos = useCallback(async (silencioso = false) => {
    try {
      if (!silencioso) setCargando(true);
      
      // En la carga inicial (no silenciosa), intentamos despertar el servidor
      if (!silencioso) {
        await fetch(`${process.env.REACT_APP_API_URL}/health`, {
          headers: { "x-api-key": process.env.REACT_APP_API_KEY },
        }).catch(() => {});
      }

      const fetchMes = mes || new Date().toLocaleDateString('sv-SE').slice(0, 7);

      const [todosRegs, todosAus, cfgGuardada, todosRechazos, xMes, todosChk] =
        await Promise.all([
          getRegistros(fetchMes),
          getAusencias(fetchMes),
          getConfig(), 
          getRechazos().then(res => {
            setRechazos(res.data || []);
            setDebugRechazos(res.debug || []);
          }),
          getBultosPorMes(),
          getChecklists(new Date().toLocaleDateString('sv-SE')),
        ]);

      setRegs(todosRegs || []);
      setAus(todosAus || []);
      setRechazos(todosRechazos || []);
      setBultosXMes(xMes || {});
      setChecklistsHoy(Array.isArray(todosChk) ? todosChk : []);
      
      const cfgFinal = { ...DC, ...(cfgGuardada || {}) };
      const keys = [
        'driverMap', 'diasNoTrabajados', 'operarios', 'temporada', 'paramXMes', 'usuarios',
        'choferes', 'ayudantes', 'patentes', 'localidades', 'destinos', 'motivosAusencia', 'personasNotas',
        'costoChofer', 'costoAyudante', 'costoOperarioChofer', 'costoOperarioAyudante', 'costoTemporada',
        'objTandil', 'objFlores', 'alertaRecargas', 'param1', 'param2', 'param3', 'empresa', 'bultosXMes', 'updatedAt'
      ];
      keys.forEach(k => {
        if (cfgGuardada?.[k] !== undefined && cfgGuardada?.[k] !== null) {
          cfgFinal[k] = cfgGuardada[k];
        }
      });
      
      // Si no hay usuarios en DB, usar los por defecto (admin)
      if (!cfgFinal.usuarios || cfgFinal.usuarios.length === 0) {
        cfgFinal.usuarios = DC.usuarios;
      } else {
        cfgFinal.usuarios = cfgFinal.usuarios.map((u) => ({
          ...u,
          permisos: {
            ...(PERMISOS_DEFAULTS[u.role] || PERMISOS_DEFAULTS.chofer),
            ...(u.permisos || {}),
          },
        }));
      }
      
      setCfg(cfgFinal);
      setRechazos(todosRechazos || []);
      
      // Combinar datos: Prioridad a lo que viene de la DB real (xMes)
      const xMesFinal = { ...(xMes || {}) };
      const xMesDeConfig = cfgGuardada?.bultosXMes || {};
      
      Object.keys(xMesDeConfig).forEach((m) => {
        // Solo usamos el dato de configuración si NO existe en la DB real
        // o si el dato de la DB real está vacío.
        if (!xMesFinal[m] || xMesFinal[m].total === 0) {
          xMesFinal[m] = xMesDeConfig[m];
        }
      });
      setBultosXMes(xMesFinal);
      
      if (!silencioso) {
        setCargando(false);
        // Verificar migración solo en carga inicial
        const yaMigro = sessionStorage.getItem("reparto_migrado");
        if (!yaMigro) {
          const claves = ["reparto_data", "reparto", "reparto-data", "data"];
          const hayLocal = claves.some((k) => {
            try {
              const raw = localStorage.getItem(k);
              if (!raw) return false;
              const p = JSON.parse(raw);
              return p.regs?.length > 0 || p.aus?.length > 0;
            } catch {
              return false;
            }
          });
          if (hayLocal) setMostrarMigracion(true);
          else sessionStorage.setItem("reparto_migrado", "true");
        }
      }
    } catch (err) {
      console.error("Error al refrescar datos:", err);
      if (!silencioso) {
        setErrConex(err.message || "Error desconocido. Verificá que el backend esté corriendo.");
        setCargando(false);
      }
    }
  }, [mes]);

  // ── Carga inicial y Configuración del Polling (cada 30s) ──────────────────
  useEffect(() => {
    refrescarDatos(false);
    const interval = setInterval(() => {
      refrescarDatos(true);
    }, 30000);
    return () => clearInterval(interval);
  }, [refrescarDatos]);

  // ── Cargar KPIs Foxtrot cada vez que cambia el mes ────────────────────────
  // Se hace desde App.js para que tanto el Dashboard como TFoxtrot compartan
  // el mismo dato sin duplicar requests cuando el usuario está en el dashboard.
  useEffect(() => {
    if (cargando) return; // esperar a que la carga inicial termine
    const [y, m] = mes.split("-");
    const desde = `${y}-${m}-01`;
    const ultimo = new Date(Number(y), Number(m), 0).getDate();
    const hasta = `${y}-${m}-${String(ultimo).padStart(2, "0")}`;

    setCargandoFoxtrotKpis(true);
    getFoxtrotKpisPorChofer({ desde, hasta })
      .then((data) => setFoxtrotKpis(Array.isArray(data) ? data : []))
      .catch(() => setFoxtrotKpis([]))
      .finally(() => setCargandoFoxtrotKpis(false));
  }, [mes, cargando]);

  // ── handleSetMes — cambia el mes global y recarga Foxtrot automáticamente ─
  // TFoxtrot y TDash usan este mismo setter, así el mes queda siempre sincronizado.
  const handleSetMes = useCallback((nuevoMes) => {
    setMes(nuevoMes);
  }, []);

  const onMigracionCompletada = async () => {
    setMostrarMigracion(false);
    await refrescarDatos(false);
    notify("✓ Datos migrados correctamente");
  };

  // ── Filtros y KPIs ────────────────────────────────────────────────────────
  const rM = useMemo(() => {
    // Admin: solo mes actual; Chofer/Ayudante: TODO su historico
    const datosBase =
      !loggedInUser || loggedInUser.role === "admin"
        ? regs.filter((r) => r.fecha?.startsWith(mes))
        : regs; // Choferes/Ayudantes ven TODOS sus registros historicos

    if (!loggedInUser || loggedInUser.role === "admin") return datosBase;

    // Para CHOFER: solo sus propios registros (TODO el historico)
    if (loggedInUser.role === "chofer") {
      return datosBase.filter((r) => {
        const userDni = String(loggedInUser.dni || "").trim();
        const createdBy = String(r.createdByDni || "").trim();
        // Match por DNI del creador (prioritario)
        if (createdBy && createdBy === userDni) return true;
        // Match por nombre del chofer - buscar si ALGUNA palabra coincide
        const choferRaw = r.chofer || "";
        const userRaw = loggedInUser.nombre || "";
        if (!choferRaw || !userRaw) return false;
        // Comparar tokens: si el chofer contiene tokens del usuario o viceversa
        const choferTokens = normalizarNombre(choferRaw)
          .split(/\s+/)
          .filter(Boolean);
        const userTokens = normalizarNombre(userRaw)
          .split(/\s+/)
          .filter(Boolean);
        return (
          choferTokens.some((t) => userTokens.includes(t)) ||
          userTokens.some((t) => choferTokens.includes(t))
        );
      });
    }

    // Para AYUDANTE: registros donde fue asignado (TODO el historico)
    if (loggedInUser.role === "ayudante") {
      return datosBase.filter((r) => {
        const userDni = String(loggedInUser.dni || "").trim();
        const createdBy = String(r.createdByDni || "").trim();
        if (createdBy && createdBy === userDni) return true;
        // Match si fue asignado como ay1 o ay2 - búsqueda por tokens
        const ay1Raw = r.ay1 || "";
        const ay2Raw = r.ay2 || "";
        const userRaw = loggedInUser.nombre || "";
        if (!userRaw) return false;
        const userTokens = normalizarNombre(userRaw)
          .split(/\s+/)
          .filter(Boolean);
        const ay1Tokens = normalizarNombre(ay1Raw).split(/\s+/).filter(Boolean);
        const ay2Tokens = normalizarNombre(ay2Raw).split(/\s+/).filter(Boolean);
        return (
          userTokens.some((t) => ay1Tokens.includes(t)) ||
          userTokens.some((t) => ay2Tokens.includes(t)) ||
          userTokens.some((t) => ay2Tokens.includes(t)) ||
          userTokens.some((t) => ay2Tokens.includes(t))
        );
      });
    }

    return datosBase;
  }, [regs, mes, loggedInUser, normalizarNombre]);

  const aM = useMemo(() => {
    // Admin: solo mes actual; Chofer/Ayudante: TODO su historico de ausencias
    const datosBase =
      !loggedInUser || loggedInUser.role === "admin"
        ? aus.filter((a) => {
            if (!a.fechaDesde) return false;
            // Rango de la ausencia [aS, aE]
            const aS = a.fechaDesde;
            const aE = a.fechaHasta || a.fechaDesde;
            
            // Rango del mes seleccionado [mS, mNext)
            const [y, m] = mes.split("-").map(Number);
            const mS = `${mes}-01`;
            const mNext = m === 12 
              ? `${y + 1}-01-01` 
              : `${y}-${String(m + 1).padStart(2, "0")}-01`;
            
            // Hay solapamiento si: (Inicio Ausencia < Fin del Mes) Y (Fin Ausencia >= Inicio del Mes)
            return aS < mNext && aE >= mS;
          })
        : aus; // Choferes/Ayudantes ven TODAS sus ausencias (pasadas, presentes, futuras)

    if (!loggedInUser || loggedInUser.role === "admin") return datosBase;

    // Para CHOFER: solo sus propias ausencias (TODO el historico)
    if (loggedInUser.role === "chofer") {
      return datosBase.filter((a) => {
        const userDni = String(loggedInUser.dni || "").trim();
        const createdBy = String(a.createdByDni || "").trim();
        if (createdBy && createdBy === userDni) return true;

        // Match por nombre: buscar en chofer, persona, nombre
        const userRaw = loggedInUser.nombre || "";
        if (!userRaw) return false;

        const choferRaw = a.chofer || "";
        const personaRaw = a.persona || "";
        const nombreRaw = a.nombre || "";

        if (choferRaw && usuarioCoincide(choferRaw, userRaw)) return true;
        if (personaRaw && usuarioCoincide(personaRaw, userRaw)) return true;
        if (nombreRaw && usuarioCoincide(nombreRaw, userRaw)) return true;

        return false;
      });
    }

    // Para AYUDANTE: sus propias ausencias (TODO el historico)
    if (loggedInUser.role === "ayudante") {
      return datosBase.filter((a) => {
        const userDni = String(loggedInUser.dni || "").trim();
        const createdBy = String(a.createdByDni || "").trim();
        if (createdBy && createdBy === userDni) return true;

        // Match por nombre: buscar en persona, nombre, chofer
        const userRaw = loggedInUser.nombre || "";
        if (!userRaw) return false;

        const personaRaw = a.persona || "";
        const nombreRaw = a.nombre || "";
        const choferRaw = a.chofer || "";

        if (personaRaw && usuarioCoincide(personaRaw, userRaw)) return true;
        if (nombreRaw && usuarioCoincide(nombreRaw, userRaw)) return true;
        if (choferRaw && usuarioCoincide(choferRaw, userRaw)) return true;

        return false;
      });
    }

    return datosBase;
  }, [aus, mes, loggedInUser, usuarioCoincide]);

  // Filtrar rechazos por permiso: si tiene permiso, muestra datos según rol
  const rechazosM = useMemo(() => {
    // Verificar si el usuario tiene permiso de "rechazos"
    const tienePermiso =
      loggedInUser && (loggedInUser.permisos || {}).rechazos === true;
    if (!tienePermiso) return [];

    // Si no hay usuario o es admin, mostrar todos
    if (!loggedInUser || loggedInUser.role === "admin") return rechazos;

    // Para CHOFER: solo sus propios rechazos
    if (loggedInUser.role === "chofer") {
      return rechazos.filter((r) => {
        const userDni = String(loggedInUser.dni || "").trim();
        const createdByDni = String(r.createdByDni || "").trim();
        if (createdByDni && createdByDni === userDni) return true;

        const userRaw = loggedInUser.nombre || "";
        if (!userRaw) return false;

        const choferDescRaw = r.choferDesc || "";
        const choferRaw = r.chofer || "";

        if (choferDescRaw && usuarioCoincide(choferDescRaw, userRaw))
          return true;
        if (choferRaw && usuarioCoincide(choferRaw, userRaw)) return true;

        return false;
      });
    }

    // Para AYUDANTE: mostrar rechazos de los choferes con los que trabajó
    if (loggedInUser.role === "ayudante") {
      // Buscar en rM los choferes con los que trabajó
      const choferesDelAyudante = new Set();
      rM.forEach((r) => {
        if (r.chofer) choferesDelAyudante.add((r.chofer || "").trim());
      });

      // Si no trabajó con nadie, no mostrar rechazos
      if (choferesDelAyudante.size === 0) return [];

      // Filtrar rechazos de esos choferes
      return rechazos.filter((r) => {
        const choferDescRaw = r.choferDesc || "";
        const choferRaw = r.chofer || "";

        for (const choferNombre of choferesDelAyudante) {
          if (!choferNombre) continue;
          if (choferDescRaw && usuarioCoincide(choferDescRaw, choferNombre))
            return true;
          if (choferRaw && usuarioCoincide(choferRaw, choferNombre))
            return true;
        }
        return false;
      });
    }

    return [];
  }, [rechazos, loggedInUser, rM, usuarioCoincide]);

  // Filtrar foxtrot por permiso: si tiene permiso, muestra datos según rol
  const foxtrotKpisM = useMemo(() => {
    // Verificar si el usuario tiene permiso de "foxtrot"
    const tienePermiso =
      loggedInUser && (loggedInUser.permisos || {}).foxtrot === true;
    if (!tienePermiso) return [];

    // Si no hay usuario o es admin, mostrar todos
    if (!loggedInUser || loggedInUser.role === "admin") return foxtrotKpis;

    // Para CHOFER: solo sus propios datos
    if (loggedInUser.role === "chofer") {
      return foxtrotKpis.filter((kpi) => {
        const userDni = String(loggedInUser.dni || "").trim();
        const createdByDni = String(kpi.createdByDni || "").trim();
        if (createdByDni && createdByDni === userDni) return true;

        const userRaw = loggedInUser.nombre || "";
        if (!userRaw) return false;

        const choferMapeadoRaw = kpi.choferMapeado || "";
        const driverNameRaw = kpi.driverName || "";

        if (choferMapeadoRaw && usuarioCoincide(choferMapeadoRaw, userRaw))
          return true;
        if (driverNameRaw && usuarioCoincide(driverNameRaw, userRaw))
          return true;

        return false;
      });
    }

    // Para AYUDANTE: mostrar KPIs de los choferes con los que trabajó
    if (loggedInUser.role === "ayudante") {
      // Buscar en rM los choferes con los que trabajó
      const choferesDelAyudante = new Set();
      rM.forEach((r) => {
        if (r.chofer) choferesDelAyudante.add((r.chofer || "").trim());
      });

      // Si no trabajó con nadie, no mostrar KPIs
      if (choferesDelAyudante.size === 0) return [];

      // Filtrar KPIs de esos choferes
      return foxtrotKpis.filter((kpi) => {
        const choferMapeadoRaw = kpi.choferMapeado || "";
        const driverNameRaw = kpi.driverName || "";

        for (const choferNombre of choferesDelAyudante) {
          if (!choferNombre) continue;
          if (
            choferMapeadoRaw &&
            usuarioCoincide(choferMapeadoRaw, choferNombre)
          )
            return true;
          if (driverNameRaw && usuarioCoincide(driverNameRaw, choferNombre))
            return true;
        }
        return false;
      });
    }

    return [];
  }, [foxtrotKpis, loggedInUser, rM, usuarioCoincide]);

  const K = useMemo(() => {
    const bultos = rM.reduce((s, r) => s + (+r.bultos || 0), 0);
    const recargas = rM.reduce((s, r) => s + (r.nRecargas || 0), 0);
    const recSI = rM.filter((r) => r.nRecargas > 0).length;
    const tandilB = rM
      .filter((r) => isT(r.localidad))
      .reduce((s, r) => s + (+r.bultos || 0), 0);
    const floresB = rM
      .filter((r) => !isT(r.localidad))
      .reduce((s, r) => s + (+r.bultos || 0), 0);
    return { bultos, recargas, recSI, tandilB, floresB, total: rM.length };
  }, [rM]);

  const alertas = useMemo(() => {
    const al = [];
    if (K.recargas >= cfg.alertaRecargas)
      al.push(`⚡ Se alcanzó el umbral de ${cfg.alertaRecargas} recargas`);
    const pend = rM.filter(
      (r) => r.recCant === "Pendiente FTE" || r.recCant === "Pendiente Bultos",
    );
    if (pend.length > 0)
      al.push(`📋 ${pend.length} registros con datos pendientes`);
    return al;
  }, [rM, K, cfg]);

  // ── CRUD Registros ────────────────────────────────────────────────────────
  const saveReg = useCallback(
    async (f) => {
      try {
        const esEdicion = regs.some((r) => r.id === f.id);
        const sourceReg = esEdicion ? regs.find(r => r.id === f.id) : null;
        const payload = { 
          ...f,
          createdByDni: esEdicion ? (sourceReg.createdByDni || loggedInUser?.dni) : loggedInUser?.dni,
          createdByNombre: esEdicion ? (sourceReg.createdByNombre || loggedInUser?.nombre) : loggedInUser?.nombre
        };
        const guardado = esEdicion
          ? await actualizarRegistro(f.id, payload)
          : await crearRegistro(payload);
        setRegs((prev) =>
          esEdicion
            ? prev.map((r) => (r.id === guardado.id ? guardado : r))
            : [guardado, ...prev],
        );
        notify(esEdicion ? "✓ Registro actualizado" : "✓ Registro guardado");
      } catch (err) {
        notify(`❌ ${err.message}`, "w");
      }
    },
    [regs, notify, loggedInUser],
  );

  const delReg = useCallback(
    async (id) => {
      try {
        await eliminarRegistro(id);
        setRegs((prev) => prev.filter((r) => r.id !== id));
        notify("Registro eliminado", "w");
      } catch (err) {
        notify(`❌ ${err.message}`, "w");
      }
    },
    [notify],
  );

  // ── CRUD Ausencias ────────────────────────────────────────────────────────
  const saveAus = useCallback(
    async (f) => {
      try {
        const esEdicion = aus.some((a) => a.id === f.id);
        const sourceAus = esEdicion ? aus.find(a => a.id === f.id) : null;
        const payload = { 
          ...f,
          createdByDni: esEdicion ? (sourceAus.createdByDni || loggedInUser?.dni) : loggedInUser?.dni,
          createdByNombre: esEdicion ? (sourceAus.createdByNombre || loggedInUser?.nombre) : loggedInUser?.nombre
        };
        const guardada = esEdicion
          ? await actualizarAusencia(f.id, payload)
          : await crearAusencia(payload);
        setAus((prev) =>
          esEdicion
            ? prev.map((a) => (a.id === guardada.id ? guardada : a))
            : [guardada, ...prev],
        );
        notify("✓ Ausencia guardada");
      } catch (err) {
        notify(`❌ ${err.message}`, "w");
      }
    },
    [aus, notify, loggedInUser],
  );

  const delAus = useCallback(
    async (id) => {
      try {
        await eliminarAusencia(id);
        setAus((prev) => prev.filter((a) => a.id !== id));
        notify("Ausencia eliminada", "w");
      } catch (err) {
        notify(`❌ ${err.message}`, "w");
      }
    },
    [notify],
  );

  // ── Config ────────────────────────────────────────────────────────────────
  const saveCfg = useCallback(
    async (nc) => {
      try {
        // Validar permiso de editar_contenido
        const tienePermiso = (loggedInUser?.permisos || {}).editar_contenido === true;
        const esAdmin = loggedInUser?.role === "admin";

        if (!esAdmin && !tienePermiso) {
          notify("❌ No tienes permiso para editar la configuración", "w");
          return;
        }

        // Caso especial: si es admin pero no tiene el permiso, permitir solo si se lo está auto-asignando
        if (esAdmin && !tienePermiso) {
          const usuariosRaw = Array.isArray(nc.usuarios) ? nc.usuarios : [];
          const usuarioEnNuevoCfg = usuariosRaw.find(
            (u) =>
              String(u.dni || "").trim() === String(loggedInUser.dni).trim(),
          );
          const seAsignaPermiso =
            usuarioEnNuevoCfg &&
            (usuarioEnNuevoCfg.permisos || {}).editar_contenido === true;

          if (!seAsignaPermiso) {
            notify(
              "❌ No tienes permiso para editar contenido. Solicítale al administrador principal o asígnatelo si eres admin.",
              "w",
            );
            return;
          }
        }

        const usuariosRaw = Array.isArray(nc.usuarios) ? nc.usuarios : [];
        const cfgActual = cfg || {};
        const usuariosActuales = Array.isArray(cfgActual.usuarios)
          ? cfgActual.usuarios
          : [];

        // Mapas rápidos por DNI
        const permisosByDni = {};
        const roleByDni = {};
        usuariosActuales.forEach((u) => {
          const dni = String(u.dni || "").trim();
          if (u.permisos) permisosByDni[dni] = u.permisos;
          if (u.role) roleByDni[dni] = u.role; // Preservar role existente
        });

        const usuariosNormalizados = [];
        const seenDnis = new Set();
        const seenNombres = new Set();

        usuariosRaw.forEach((u) => {
          const nombre = String(u.nombre || "").trim();
          const dni = String(u.dni || "").trim();
          const claveNombre = normalizarNombre(nombre);
          if (!nombre || !dni) return;
          if (seenDnis.has(dni)) return;
          if (seenNombres.has(claveNombre)) return;
          seenDnis.add(dni);
          seenNombres.add(claveNombre);

          // Preservar: role existente en BD > role nuevo > default 'chofer'
          const role = u.role || roleByDni[dni] || "chofer";

          // Preservar: NEW del form > old de BD > vacío
          const permisos = u.permisos || permisosByDni[dni] || {};

          usuariosNormalizados.push({ nombre, dni, role, permisos });
        });

        const payload = { ...nc, usuarios: usuariosNormalizados };
        const guardada = await guardarConfig(payload);

        const cfgMerge = { ...DC, ...guardada };
        const keys3 = [
          'driverMap', 'diasNoTrabajados', 'operarios', 'temporada', 'paramXMes', 'usuarios',
          'choferes', 'ayudantes', 'patentes', 'localidades', 'destinos', 'motivosAusencia', 'personasNotas',
          'costoChofer', 'costoAyudante', 'costoOperarioChofer', 'costoOperarioAyudante', 'costoTemporada',
          'objTandil', 'objFlores', 'alertaRecargas', 'param1', 'param2', 'param3', 'empresa', 'bultosXMes', 'updatedAt'
        ];
        keys3.forEach(k => {
          if (guardada?.[k] !== undefined && guardada?.[k] !== null) {
            cfgMerge[k] = guardada[k];
          }
        });
        setCfg(cfgMerge);

        // Actualizar loggedInUser SI está loguado, buscando por DNI en la nueva config
        if (loggedInUser && loggedInUser.dni) {
          const usuarioActualizado = (cfgMerge.usuarios || []).find(
            (u) =>
              String(u.dni || "").trim() === String(loggedInUser.dni).trim(),
          );
          if (usuarioActualizado) {
            setLoggedInUser((prev) => ({
              ...prev,
              role: usuarioActualizado.role || prev.role,
              permisos: usuarioActualizado.permisos || prev.permisos,
            }));
          }
        }

        notify("✓ Configuración guardada");
      } catch (err) {
        notify(`❌ ${err.message}`, "w");
      }
    },
    [notify, normalizarNombre, cfg, loggedInUser],
  );

  // ── Rechazos ──────────────────────────────────────────────────────────────
  const saveRechazos = useCallback(
    async (rows, archivo, totalesArchivo) => {
      try {
        const res = await importarRechazos(rows, archivo);
        const todos = await getRechazos();
        setRechazos(Array.isArray(todos) ? todos : []);
        const mesesEnRows = [
          ...new Set(
            rows
              .map((r) => (r.fecha || "").slice(0, 7))
              .filter((m) => m.length === 7),
          ),
        ];
        const mesArchivo = mesesEnRows.length === 1 ? mesesEnRows[0] : null;
        if (mesArchivo && totalesArchivo?.bultosTotal > 0) {
          const cfgActual = await getConfig();
          const bultosXMesActual = { ...(cfgActual?.bultosXMes || {}) };
          bultosXMesActual[mesArchivo] = {
            total: Math.round(totalesArchivo.bultosTotal),
            porChofer: totalesArchivo.bultosPorChofer || {},
          };
          const cfgActualizada = {
            ...cfgActual,
            bultosTotal: Math.round(totalesArchivo.bultosTotal),
            bultosPorChofer: totalesArchivo.bultosPorChofer || {},
            bultosXMes: bultosXMesActual,
          };
          await guardarConfig(cfgActualizada);
          setCfg((prev) => ({ ...prev, ...cfgActualizada }));
          setBultosXMes(bultosXMesActual);
        }
        const r = res?.resultado;
        notify(
          r
            ? `✓ ${r.ok} rechazos guardados${r.fail > 0 ? ` · ${r.fail} fallaron` : ""}`
            : `✓ ${rows.length} rechazos guardados`,
        );
      } catch (err) {
        notify(`❌ Error al guardar rechazos: ${err.message}`, "w");
      }
    },
    [notify],
  );

  const editRec = useCallback(
    async (datos) => {
      try {
        const res = await editarRechazo(datos.id, datos);
        const guardado = res?.data || res;
        setRechazos((prev) =>
          prev.map((r) => (r.id === guardado?.id ? guardado : r)),
        );
        notify("✓ Rechazo actualizado");
      } catch (err) {
        notify(`❌ ${err.message}`, "w");
      }
    },
    [notify],
  );

  const delRec = useCallback(
    async (id) => {
      try {
        await eliminarRechazo(id);
        setRechazos((prev) => prev.filter((r) => r.id !== id));
        notify("Rechazo eliminado", "w");
      } catch (err) {
        notify(`❌ ${err.message}`, "w");
      }
    },
    [notify],
  );

  const allP = useMemo(
    () => [...new Set([...(cfg.choferes || []), ...(cfg.ayudantes || []), ...(cfg.operarios || [])])],
    [cfg],
  );
  const navMap = {
    registros: "registros",
    ausencias: "ausencias",
    reportes: "reportes",
  };

  const tabs = [
    { id: "dashboard", lb: "📊 Dashboard" },
    { id: "registros", lb: "🚛 Registros" },
    { id: "ausencias", lb: "📋 Ausencias" },
    { id: "personal", lb: "👥 Personal" },
    { id: "costos", lb: "💰 Costos" },
    { id: "reportes", lb: "📈 Reportes" },
    { id: "rechazos", lb: "❌ Rechazos" },
    { id: "foxtrot", lb: "📡 Foxtrot" },
    { id: "importar", lb: "📂 Importar" },
    { id: "config", lb: "⚙ Config" },
    { id: "notas", lb: "📌 Notas" },
    { id: "biolinks", lb: "🔗 Links" },
  ];

  // Filtrar tabs según permisos del usuario loguado (TODOS incluido admin)
  const tabsVisibles = useMemo(() => {
    if (!loggedInUser) return tabs;
    const role = String(loggedInUser.role || "").toLowerCase();
    if (role === "admin") return tabs; // Admin ve todo
    const permisos = loggedInUser.permisos || {};
    return tabs.filter((t) => permisos[t.id] === true);
  }, [loggedInUser, tabs]);

  // CRÍTICO: Si usuario no tiene acceso a tab actual, redirigir al PRIMER tab permitido
  useEffect(() => {
    if (!loggedInUser) {
      setTab("dashboard");
      return;
    }

    if (String(loggedInUser.role || "").toLowerCase() === "admin") return; // admin ve todo

    const permisos = loggedInUser.permisos || {};
    const tabPermitido = permisos[tab] === true;

    if (!tabPermitido) {
      // Ir al primer tab que tenga permiso
      const primerTabPermitido = tabs.find((t) => permisos[t.id] === true);
      if (primerTabPermitido) {
        setTab(primerTabPermitido.id);
      }
    }
  }, [loggedInUser, tab, tabs]);

  // ── Renderizado ───────────────────────────────────────────────────────────
  if (cargando || errConex) return <Cargando error={errConex} />;
  if (mostrarMigracion)
    return <TMigracion onCompletada={onMigracionCompletada} />;
  if (!loggedInUser) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f8fafc",
          padding: 24,
        }}>
        <div
          style={{
            width: "100%",
            maxWidth: 360,
            background: "#fff",
            borderRadius: 12,
            border: "1px solid #e2e8f0",
            boxShadow: "0 4px 16px rgba(0,0,0,.08)",
            padding: 24,
          }}>
          <div style={{ textAlign: "center", marginBottom: 20 }}>
            <div style={{ fontSize: 56, marginBottom: 12 }} id="loginLogo">
              <img
                src="/icon-day.png?v=1"
                alt="logo"
                style={{ height: 64, display: "block" }}
                onLoad={(e) => (e.target.style.display = "block")}
                onError={(e) => {
                  e.target.style.display = "none";
                  document.getElementById("loginLogo").textContent = "🍺";
                }}
              />
            </div>
            <h1
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: "#1f2937",
                margin: 0,
              }}>
              Beer Tan Sa
            </h1>
            <p style={{ fontSize: 12, color: "#64748b", margin: "4px 0 0 0" }}>
              Sistema de Reparto
            </p>
          </div>
          <h2 style={{ marginBottom: 6 }}>🔒 Acceso al sistema</h2>
          <p style={{ color: "#64748b", marginBottom: 16 }}>
            Ingresá nombre y apellido, y DNI como contraseña.
          </p>
          <div style={{ display: "grid", gap: 12 }}>
            <input
              className="filter-input"
              placeholder="Nombre y Apellido"
              value={loginNombre}
              onChange={(e) => setLoginNombre(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" &&
                document.getElementById("loginDniInput")?.focus()
              }
            />
            <input
              id="loginDniInput"
              className="filter-input"
              type="password"
              placeholder="DNI"
              value={loginDni}
              onChange={(e) => setLoginDni(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            />
            <button
              className="btn-action btn-primary-action"
              onClick={handleLogin}
              disabled={cargando || !cfg.usuarios || cfg.usuarios.length === 0}
            >
              {cargando ? "Cargando sistema..." : "Entrar"}
            </button>
            {loginError && (
              <div style={{ color: "#b91c1c", fontWeight: 700 }}>
                {loginError}
              </div>
            )}
            {!cfg.usuarios || cfg.usuarios.length === 0 ? (
              <div style={{ color: "#f59e0b", fontSize: 13 }}>
                No hay usuarios configurados. Abrí Configuración para agregar
                usuarios con DNI.
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  const paramDelMes = (cfg.paramXMes || {})[mes] || {};
  const cfgConBultos = { ...cfg, bultosXMes };
  const cfgConMes = { ...cfgConBultos, ...paramDelMes };

  return (
    <div className="app-root">
      <nav className="app-nav">
        <div className="nav-brand">
          <div className="nav-logo">
            <img src="/icon-day.png" alt="logo" style={{ height: 32, display: "block" }} 
                 onError={(e) => { e.target.style.display='none'; e.target.parentElement.textContent='🚛'; }} />
          </div>
          <div>
            <span className="nav-title">
              {cfg.empresa || "Sistema de Reparto"}
            </span>
            <span className="nav-sub">Panel Operativo · v4 (Checklist)</span>
          </div>
        </div>
        <div className="nav-tabs">
          {tabsVisibles.map((t) => (
            <button
              key={t.id}
              className={`nav-tab ${tab === t.id ? "nav-tab-active" : ""}`}
              onClick={() => setTab(t.id)}>
              {t.lb}
              {t.id === "dashboard" && alertas.length > 0 && (
                <span className="nav-alert-dot" />
              )}
            </button>
          ))}
        </div>
        <div className="nav-right">
          {loggedInUser && (
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ textAlign: "right", fontSize: 12 }}>
                <div style={{ fontWeight: 700, color: "#1f2937" }}>
                  👤 {loggedInUser.nombre}
                </div>
                <div
                  style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>
                  {String(loggedInUser.role || '').toLowerCase() === "admin"
                    ? "🔑 Admin"
                    : String(loggedInUser.role || '').toLowerCase() === "chofer"
                      ? "🚗 Chofer"
                      : "🤝 Ayudante"}
                </div>
              </div>
              <button
                className="btn-action btn-ghost"
                style={{ padding: "6px 12px", fontSize: 12, marginRight: 8 }}
                onClick={handleLogout}>
                Salir
              </button>
            </div>
          )}
          <span className="nav-date">
            {new Date().toLocaleDateString("es-AR", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            })}
          </span>
          <button
            className="nav-hamburger"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Menú">
            {menuOpen ? "✕" : "☰"}
          </button>
        </div>
      </nav>

      {menuOpen && (
        <div className="nav-dropdown">
          {tabsVisibles.map((t) => (
            <button
              key={t.id}
              className={`nav-dropdown-item ${tab === t.id ? "nav-dropdown-item-active" : ""}`}
              onClick={() => {
                setTab(t.id);
                setMenuOpen(false);
              }}>
              {t.lb}
              {t.id === "dashboard" && alertas.length > 0 && (
                <span
                  className="nav-alert-dot"
                  style={{
                    position: "static",
                    display: "inline-block",
                    marginLeft: 6,
                  }}
                />
              )}
            </button>
          ))}
        </div>
      )}

      <main className="app-main">
        {/* BLOQUEO PARA CHOFERES (CHECKLIST) */}
        {!checklistCompletado && String(loggedInUser?.role || "").toLowerCase() === "chofer" && (
          <div style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", backdropFilter: "blur(10px)",
            zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20
          }}>
            <div style={{
              background: "#fff", borderRadius: 24, maxWidth: 500, width: "100%", padding: 32,
              textAlign: "center", boxShadow: "0 20px 50px rgba(0,0,0,0.3)"
            }}>
              <div style={{ fontSize: 64, marginBottom: 16 }}>🚛</div>
              <h2 style={{ fontSize: 24, fontWeight: 900, color: "#111827", marginBottom: 12 }}>¡Atención Chofer!</h2>
              <p style={{ fontSize: 16, color: "#4b5563", lineHeight: 1.6, marginBottom: 24 }}>
                Debes realizar el <strong>Checklist del Camión</strong> antes de comenzar tu jornada.
                Es obligatorio para poder usar el sistema.
              </p>
              <div style={{ display: "grid", gap: 12 }}>
                <a
                  href="https://forms.gle/FJmEb7dEcvTrDrga9"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-action btn-primary-action"
                  style={{ textDecoration: "none", display: "block", fontSize: 16, padding: "14px" }}
                >
                  📝 Abrir Formulario Checklist
                </a>
                <button
                  onClick={() => handleChecklistConfirm("completado")}
                  className="btn-action btn-secondary-action"
                  style={{ fontSize: 16, padding: "14px", background: "#dcfce7", color: "#166534", border: "2px solid #4ade80" }}
                >
                  ✅ Ya lo completé en Google Forms
                </button>
                <button
                  onClick={() => handleChecklistConfirm("sin_ruta")}
                  style={{
                    background: "none", border: "none", color: "#64748b", textDecoration: "underline",
                    fontSize: 13, fontWeight: 600, cursor: "pointer", marginTop: 8
                  }}
                >
                  No tengo ruta asignada para el día de hoy
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === "dashboard" && (
          <TDash
            K={K}
            rM={rM}
            aM={aM}
            cfg={cfgConMes}
            mes={mes}
            setMes={handleSetMes}
            alertas={alertas}
            onR={() => setModal({ t: "reg" })}
            onA={() => setModal({ t: "aus" })}
            onEdit={(r) => setModal({ t: "reg", d: r })}
            onDel={delReg}
            onNav={(dest) => setTab(navMap[dest] || dest)}
            regsAll={regs}
            rechazos={rechazos}
            onNavRechazos={() => setTab("rechazos")}
            foxtrotKpis={foxtrotKpis}
            onNavFoxtrot={() => setTab("foxtrot")}
            loggedInUser={loggedInUser}
            checklistsHoy={checklistsHoy}
          />
        )}
        {tab === "registros" && (
          <TRegs
            rM={rM}
            mes={mes}
            setMes={handleSetMes}
            regsAll={regs}
            ausAll={aus}
            onNew={() => setModal({ t: "reg" })}
            onEdit={(r) => setModal({ t: "reg", d: r })}
            onDel={delReg}
            loggedInUser={loggedInUser}
          />
        )}
        {tab === "ausencias" && (
          <TAus
            aM={aM}
            mes={mes}
            setMes={handleSetMes}
            regsAll={regs}
            ausAll={aus}
            onNew={() => setModal({ t: "aus" })}
            onEdit={(a) => setModal({ t: "aus", d: a })}
            onDel={delAus}
            loggedInUser={loggedInUser}
          />
        )}
        {tab === "personal" && (
          <TPersonal
            rM={rM}
            aM={aM}
            cfg={cfgConMes}
            mes={mes}
            setMes={handleSetMes}
            loggedInUser={loggedInUser}
            regsAll={regs}
            ausAll={aus}
          />
        )}
        {tab === "costos" && (
          <TCostos
            rM={rM}
            K={K}
            cfg={cfgConMes}
            mes={mes}
            setMes={handleSetMes}
            regsAll={regs}
            ausAll={aus}
            loggedInUser={loggedInUser}
          />
        )}
        {tab === "reportes" && (
          <TReportes
            rM={rM}
            aM={aM}
            K={K}
            cfg={cfgConMes}
            mes={mes}
            setMes={handleSetMes}
            regsAll={regs}
            ausAll={aus}
            loggedInUser={loggedInUser}
            onXLSX={() => {
              try {
                exportarReporteXLSX({
                  rM,
                  aM,
                  K,
                  cfg: cfgConMes,
                  mes,
                  regsAll: regs,
                  ausAll: aus,
                });
                notify("✓ Excel generado correctamente");
              } catch (e) {
                notify("❌ Error al generar Excel: " + e.message, "w");
              }
            }}
            onPDF={() => {
              window.print();
              notify("Abriendo PDF");
            }}
          />
        )}
        {tab === "rechazos" && (
          <TRechazos
            rechazos={rechazosM}
            debug={debugRechazos}
            regs={regs}
            cfg={cfgConMes}
            loggedInUser={loggedInUser}
            onEditar={editRec}
            onEliminar={delRec}
          />
        )}
        {tab === "foxtrot" && (
          // TFoxtrot recibe mes/setMes del padre para que el selector quede sincronizado
          // con el resto de la app. También recibe kpisExternos para evitar un re-fetch
          // cuando el usuario viene directo del dashboard (los datos ya están cargados).
          <TFoxtrot
            cfg={cfgConMes}
            mes={mes}
            setMes={handleSetMes}
            kpisExternos={foxtrotKpisM}
            kpisAllForRanking={foxtrotKpis}
            cargandoExterno={cargandoFoxtrotKpis}
            loggedInUser={loggedInUser}
          />
        )}
        {tab === "importar" && (
          <TImportacion
            cfg={cfg}
            aus={aus}
            onSaveReg={saveReg}
            onSaveRechazos={saveRechazos}
          />
        )}
        {tab === "config" && (
          <TConfig
            key={cfg.updatedAt || "config"}
            cfg={cfg}
            onSave={saveCfg}
            loggedInUser={loggedInUser}
          />
        )}
        {tab === "notas" && (
          <TNotas
            cfg={cfg}
            mes={mes}
            setMes={handleSetMes}
            regsAll={regs}
            ausAll={aus}
            loggedInUser={loggedInUser}
            notify={notify}
          />
        )}
        {tab === "biolinks" && <TBiolinks />}
      </main>

      {modal?.t === "reg" && (
        <MReg
          d={modal.d}
          cfg={cfg}
          aus={aus}
          onSave={saveReg}
          onClose={() => setModal(null)}
          loggedInUser={loggedInUser}
        />
      )}
      {modal?.t === "aus" && (
        <MAus
          d={modal.d}
          cfg={cfg}
          all={allP}
          onSave={saveAus}
          onClose={() => setModal(null)}
          loggedInUser={loggedInUser}
        />
      )}

      {toast && (
        <div className="toast-wrap">
          <div className={`toast-msg toast-${toast.type}`}>
            {toast.type === "w" ? "⚠ " : "✓ "}
            {toast.msg}
          </div>
        </div>
      )}

      <footer className="app-footer">
        © {new Date().getFullYear()} Beer Tan SA · Todos los derechos reservados
      </footer>
    </div>
  );
}
