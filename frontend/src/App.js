// src/App.js — Versión con backend Neon
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import './styles/custom.css';
import { exportarReporteXLSX } from './utils/exportXLSX';

import { TDash }        from './components/TDash';
import { TRegs }        from './components/TRegs';
import { TAus }         from './components/TAus';
import { TConfig }      from './components/TConfig';
import { MReg }         from './components/MReg';
import { MAus }         from './components/MAus';
import { TMigracion }   from './components/TMigracion';
import { TPersonal }    from './components/TPersonal';
import { TCostos }      from './components/TCostos';
import { TReportes }    from './components/TReportes';
import { TRechazos }    from './components/TRechazos';
import { TFoxtrot }     from './components/TFoxtrot';
import { TImportacion } from './components/TImportacion';
import { TNotas }       from './components/TNotas';

import { DC }          from './constants';
import { PERMISOS_DEFAULTS, normalizarUsuario } from './config/permissions';
import { mesN, isT }   from './utils/helpers';

import {
  getRegistros, crearRegistro, actualizarRegistro, eliminarRegistro,
  getAusencias, crearAusencia, actualizarAusencia, eliminarAusencia,
  getConfig, guardarConfig,
  getRechazos, importarRechazos, editarRechazo, eliminarRechazo,
  getBultosPorMes,
  getNotas, crearNota, actualizarNota, eliminarNota,
  getFoxtrotKpisPorChofer,
} from './api/client';

// ─── Pantalla de carga / error ────────────────────────────────────────────────
const Cargando = ({ error }) => (
  <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
    <div style={{ textAlign: 'center', padding: 40 }}>
      {error ? (
        <>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#b91c1c', marginBottom: 8 }}>No se pudo conectar al servidor</div>
          <div style={{ fontSize: 14, color: '#64748b', maxWidth: 420, lineHeight: 1.8, marginBottom: 20 }}>
            {error}
            <br /><br />
            Verificá que el backend esté corriendo:<br />
            <code style={{ background: '#f1f5f9', padding: '4px 10px', borderRadius: 6, fontSize: 13 }}>
              cd backend &amp;&amp; npm start
            </code>
          </div>
          <button onClick={() => window.location.reload()}
            style={{ padding: '10px 28px', background: '#005fa3', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
            Reintentar
          </button>
        </>
      ) : (
        <>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🚛</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#64748b' }}>Cargando sistema...</div>
        </>
      )}
    </div>
  </div>
);

// ════════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [tab,          setTab]          = useState('dashboard');
  const [menuOpen,     setMenuOpen]     = useState(false);
  const [regs,         setRegs]         = useState([]);
  const [aus,          setAus]          = useState([]);
  const [cfg,          setCfg]          = useState(DC);
  const [rechazos,     setRechazos]     = useState([]);
  const [bultosXMes,   setBultosXMes]   = useState({});
  const [mes,          setMes]          = useState(mesN());
  const [toast,        setToast]        = useState(null);
  const [modal,        setModal]        = useState(null);
  const [cargando,     setCargando]     = useState(true);
  const [errConex,     setErrConex]     = useState(null);
  const [mostrarMigracion, setMostrarMigracion] = useState(false);

  const [loggedInUser, setLoggedInUser] = useState(null);
  const [loginNombre, setLoginNombre] = useState('');
  const [loginDni, setLoginDni] = useState('');
  const [loginError, setLoginError] = useState('');

  // ── Estado Foxtrot KPIs (para Dashboard) ─────────────────────────────────
  const [foxtrotKpis,        setFoxtrotKpis]        = useState([]);
  const [cargandoFoxtrotKpis, setCargandoFoxtrotKpis] = useState(false);

  const notify = useCallback((msg, type = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const normalizarNombre = useCallback((s) => normalizarUsuario(s), []);

  const usuarioCoincide = useCallback((entrada, registro) => {
    const entradaNorm = normalizarNombre(entrada);
    const registroNorm = normalizarNombre(registro || '');
    if (!entradaNorm || !registroNorm) return false;
    
    // Coincidencia exacta (después de normalizar)
    if (entradaNorm === registroNorm) return true;

    const tokensE = entradaNorm.split(' ').filter(Boolean);
    const tokensR = registroNorm.split(' ').filter(Boolean);

    // Si ambos tienen al menos 2 palabras, verificar que compartan apellido y nombre
    if (tokensE.length >= 2 && tokensR.length >= 2) {
      // Mismo apellido (primer token)
      if (tokensE[0] === tokensR[0]) {
        // Mismo nombre (segundo token)
        if (tokensE[1] === tokensR[1]) return true;
      }
    }

    // Single token match: si uno tiene 1 token y el otro lo contiene
    if (tokensE.length === 1 && tokensR.some(t => t === tokensE[0])) return true;
    if (tokensR.length === 1 && tokensE.some(t => t === tokensR[0])) return true;

    return false;
  }, []);

  const validarCredenciales = (nombre, dni) => {
    const usuarios = Array.isArray(cfg.usuarios) ? cfg.usuarios : [];
    if (!usuarios.length) return { ok: false, msg: 'No hay usuarios configurados. Agrega al menos uno en Config.' };
    const dniClean = String(dni || '').trim();
    if (!dniClean) return { ok: false, msg: 'Ingrese DNI.' };
    const match = usuarios.find(u => {
      const userDni = String(u.dni || '').trim();
      if (!userDni || userDni !== dniClean) return false;
      return usuarioCoincide(nombre, u.nombre);
    });

    return match
      ? { ok: true, user: match }
      : { ok: false, msg: 'Usuario o DNI incorrecto.' };
  };

  const handleLogin = () => {
    const result = validarCredenciales(loginNombre, loginDni);
    if (!result.ok) {
      setLoginError(result.msg);
      return;
    }
    const user = result.user;
    
    // FIJO: Usuario Administrador siempre es admin
    if (user.nombre === 'Administrador' && user.dni === 'admin') {
      user.role = 'admin';
      // El admin principal siempre tiene permiso de editar contenido
      if (!user.permisos) user.permisos = {};
      user.permisos.editar_contenido = true;
    }
    
    // Detección robusta de login duplicado en otra pestaña/dispositivo
    const sessionKey = `app_session_${user.dni}`;
    const sessionId = Math.random().toString(36).substring(2, 15);
    sessionStorage.setItem(sessionKey, sessionId);
    
    // Guardar sessionId en window para poder verificarlo en el listener
    if (!window.activeSessions) window.activeSessions = {};
    window.activeSessions[user.dni] = sessionId;
    
    // Escuchar cambios de sesión en otras pestañas
    const handleStorageChange = (e) => {
      if (e.key === sessionKey && e.newValue && e.newValue !== window.activeSessions[user.dni]) {
        setLoggedInUser(null);
        setLoginError('⚠️ Sesión cerrada: iniciaste sesión en otro dispositivo/navegador');
        setLoginNombre('');
        setLoginDni('');
      }
    };
    
    if (!window.sessionListenerAttached) {
      window.addEventListener('storage', handleStorageChange);
      window.sessionListenerAttached = true;
    }
    
    // Verificación periódica del sessionId (cada 2s) en caso de tabs del mismo navegador
    const sessionCheckInterval = setInterval(() => {
      const currentSessionId = sessionStorage.getItem(sessionKey);
      if (currentSessionId && currentSessionId !== window.activeSessions[user.dni]) {
        setLoggedInUser(null);
        setLoginError('⚠️ Sesión cerrada: iniciaste sesión en otro dispositivo/navegador');
        setLoginNombre('');
        setLoginDni('');
        clearInterval(sessionCheckInterval);
      }
    }, 2000);
    
    // Limpiar intervalo al logout
    window.sessionCheckInterval = sessionCheckInterval;
    
    // Llenar permisos faltantes del usuario con los defaults del rol
    // Si el usuario ya tiene un permiso (incluso si es false), mantenerlo
    const defaultsParaRole = PERMISOS_DEFAULTS[user.role] || PERMISOS_DEFAULTS.chofer;
    Object.keys(defaultsParaRole).forEach(perm => {
      if (!(perm in (user.permisos || {}))) {
        if (!user.permisos) user.permisos = {};
        user.permisos[perm] = defaultsParaRole[perm];
      }
    });
    
    setLoggedInUser(user);
    setLoginError('');
    setLoginNombre('');
    setLoginDni('');
    notify(`✓ Bienvenido ${result.user.nombre}`);
  };

  const handleLogout = () => {
    // Limpiar intervalo de verificación de sesión
    if (window.sessionCheckInterval) clearInterval(window.sessionCheckInterval);
    if (loggedInUser?.dni) delete window.activeSessions?.[loggedInUser.dni];
    
    setLoggedInUser(null);
    setLoginError('');
    setToast(null);
    setTab('dashboard');
  };

  // ── Carga inicial ──────────────────────────────────────────────────────────
  useEffect(() => {
    async function cargarTodo() {
      try {
        const [todosRegs, todosAus, cfgGuardada, todosRechazos, xMes] = await Promise.all([
          getRegistros(),
          getAusencias(),
          getConfig(),
          getRechazos(),
          getBultosPorMes(),
        ]);
        setRegs(todosRegs || []);
        setAus(todosAus   || []);
        const cfgFinal = { ...DC, ...(cfgGuardada || {}) };
        if (cfgGuardada?.driverMap)        cfgFinal.driverMap        = cfgGuardada.driverMap;
        if (cfgGuardada?.diasNoTrabajados) cfgFinal.diasNoTrabajados = cfgGuardada.diasNoTrabajados;
        if (cfgGuardada?.paramXMes)        cfgFinal.paramXMes        = cfgGuardada.paramXMes;
        if (cfgGuardada?.usuarios)         cfgFinal.usuarios         = cfgGuardada.usuarios;
        // Si no hay usuarios en DB, usar los por defecto (admin)
        if (!cfgFinal.usuarios || cfgFinal.usuarios.length === 0) {
          cfgFinal.usuarios = DC.usuarios;
        } else {
          // Asegurar que todos los usuarios tengan permisos completos
          // Solo llenar los que faltan, preservando los que SÍ están configurados
          cfgFinal.usuarios = cfgFinal.usuarios.map(u => ({
            ...u,
            permisos: { ...PERMISOS_DEFAULTS[u.role] || PERMISOS_DEFAULTS.chofer, ...(u.permisos || {}) },
          }));
        }
        setCfg(cfgFinal);
        setRechazos(todosRechazos || []);
        const xMesDeConfig = cfgGuardada?.bultosXMes || {};
        const xMesFinal = { ...(xMes || {}) };
        Object.keys(xMesDeConfig).forEach(m => { xMesFinal[m] = xMesDeConfig[m]; });
        setBultosXMes(xMesFinal);
        setCargando(false);

        const yaMigro = sessionStorage.getItem('reparto_migrado');
        if (!yaMigro) {
          const claves = ['reparto_data', 'reparto', 'reparto-data', 'data'];
          const hayLocal = claves.some(k => {
            try {
              const raw = localStorage.getItem(k);
              if (!raw) return false;
              const p = JSON.parse(raw);
              return (p.regs?.length > 0 || p.aus?.length > 0);
            } catch { return false; }
          });
          if (hayLocal) setMostrarMigracion(true);
          else sessionStorage.setItem('reparto_migrado', 'true');
        }
      } catch (err) {
        console.error('Error de conexión:', err);
        setErrConex(err.message || 'Error desconocido. Verificá que el backend esté corriendo.');
        setCargando(false);
      }
    }
    cargarTodo();
  }, []);

  // ── Cargar KPIs Foxtrot cada vez que cambia el mes ────────────────────────
  // Se hace desde App.js para que tanto el Dashboard como TFoxtrot compartan
  // el mismo dato sin duplicar requests cuando el usuario está en el dashboard.
  useEffect(() => {
    if (cargando) return; // esperar a que la carga inicial termine
    const [y, m] = mes.split('-');
    const desde = `${y}-${m}-01`;
    const ultimo = new Date(Number(y), Number(m), 0).getDate();
    const hasta  = `${y}-${m}-${String(ultimo).padStart(2, '0')}`;

    setCargandoFoxtrotKpis(true);
    getFoxtrotKpisPorChofer({ desde, hasta })
      .then(data => setFoxtrotKpis(Array.isArray(data) ? data : []))
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
    try {
      const [todosRegs, todosAus, cfgGuardada] = await Promise.all([
        getRegistros(), getAusencias(), getConfig(),
      ]);
      setRegs(todosRegs || []);
      setAus(todosAus   || []);
      const cfgFinal2 = { ...DC, ...(cfgGuardada || {}) };
      if (cfgGuardada?.driverMap)        cfgFinal2.driverMap        = cfgGuardada.driverMap;
      if (cfgGuardada?.diasNoTrabajados) cfgFinal2.diasNoTrabajados = cfgGuardada.diasNoTrabajados;
      if (cfgGuardada?.paramXMes)        cfgFinal2.paramXMes        = cfgGuardada.paramXMes;
      if (cfgGuardada?.usuarios)         cfgFinal2.usuarios         = cfgGuardada.usuarios;
      // Rellenar permisos si falta
      if (cfgFinal2.usuarios && cfgFinal2.usuarios.length > 0) {
        const permisosDefaults = {
          admin: { dashboard: true, registros: true, ausencias: true, personal: true, costos: true, reportes: true, rechazos: true, foxtrot: true, importar: true, config: true, notas: true },
          chofer: { dashboard: true, registros: true, ausencias: true, personal: false, costos: false, reportes: false, rechazos: false, foxtrot: false, importar: false, config: false, notas: true },
          ayudante: { dashboard: true, registros: true, ausencias: true, personal: false, costos: false, reportes: false, rechazos: false, foxtrot: false, importar: false, config: false, notas: true },
        };
        cfgFinal2.usuarios = cfgFinal2.usuarios.map(u => ({
          ...u,
          permisos: u.permisos || permisosDefaults[u.role] || permisosDefaults.chofer,
        }));
      }
      setCfg(cfgFinal2);
      notify('✓ Datos migrados correctamente');
    } catch { /* si falla, usa los datos ya cargados */ }
  };

  // ── Filtros y KPIs ────────────────────────────────────────────────────────
  const rM = useMemo(() => {
    // Admin: solo mes actual; Chofer/Ayudante: TODO su historico
    const datosBase = (!loggedInUser || loggedInUser.role === 'admin') 
      ? regs.filter(r => r.fecha?.startsWith(mes))
      : regs; // Choferes/Ayudantes ven TODOS sus registros historicos

    if (!loggedInUser || loggedInUser.role === 'admin') return datosBase;

    // Para CHOFER: solo sus propios registros (TODO el historico)
    if (loggedInUser.role === 'chofer') {
      return datosBase.filter(r => {
        const userDni = String(loggedInUser.dni || '').trim();
        const createdBy = String(r.createdByDni || '').trim();
        // Match por DNI del creador (prioritario)
        if (createdBy && createdBy === userDni) return true;
        // Match por nombre del chofer - buscar si ALGUNA palabra coincide
        const choferRaw = r.chofer || '';
        const userRaw = loggedInUser.nombre || '';
        if (!choferRaw || !userRaw) return false;
        // Comparar tokens: si el chofer contiene tokens del usuario o viceversa
        const choferTokens = normalizarNombre(choferRaw).split(/\s+/).filter(Boolean);
        const userTokens = normalizarNombre(userRaw).split(/\s+/).filter(Boolean);
        return choferTokens.some(t => userTokens.includes(t)) || userTokens.some(t => choferTokens.includes(t));
      });
    }

    // Para AYUDANTE: registros donde fue asignado (TODO el historico)
    if (loggedInUser.role === 'ayudante') {
      return datosBase.filter(r => {
        const userDni = String(loggedInUser.dni || '').trim();
        const createdBy = String(r.createdByDni || '').trim();
        if (createdBy && createdBy === userDni) return true;
        // Match si fue asignado como ay1 o ay2 - búsqueda por tokens
        const ay1Raw = r.ay1 || '';
        const ay2Raw = r.ay2 || '';
        const userRaw = loggedInUser.nombre || '';
        if (!userRaw) return false;
        const userTokens = normalizarNombre(userRaw).split(/\s+/).filter(Boolean);
        const ay1Tokens = normalizarNombre(ay1Raw).split(/\s+/).filter(Boolean);
        const ay2Tokens = normalizarNombre(ay2Raw).split(/\s+/).filter(Boolean);
        return userTokens.some(t => ay1Tokens.includes(t)) || userTokens.some(t => ay2Tokens.includes(t)) ||
               userTokens.some(t => ay2Tokens.includes(t)) || userTokens.some(t => ay2Tokens.includes(t));
      });
    }

    return datosBase;
  }, [regs, mes, loggedInUser, normalizarNombre]);

  const aM = useMemo(() => {
    // Admin: solo mes actual; Chofer/Ayudante: TODO su historico de ausencias
    const datosBase = (!loggedInUser || loggedInUser.role === 'admin')
      ? aus.filter(a => a.fechaDesde?.startsWith(mes))
      : aus; // Choferes/Ayudantes ven TODAS sus ausencias (pasadas, presentes, futuras)

    if (!loggedInUser || loggedInUser.role === 'admin') return datosBase;

    // Para CHOFER: solo sus propias ausencias (TODO el historico)
    if (loggedInUser.role === 'chofer') {
      return datosBase.filter(a => {
        const userDni = String(loggedInUser.dni || '').trim();
        const createdBy = String(a.createdByDni || '').trim();
        if (createdBy && createdBy === userDni) return true;
        
        // Match por nombre: buscar en chofer, persona, nombre
        const userRaw = loggedInUser.nombre || '';
        if (!userRaw) return false;
        
        const choferRaw = a.chofer || '';
        const personaRaw = a.persona || '';
        const nombreRaw = a.nombre || '';
        
        if (choferRaw && usuarioCoincide(choferRaw, userRaw)) return true;
        if (personaRaw && usuarioCoincide(personaRaw, userRaw)) return true;
        if (nombreRaw && usuarioCoincide(nombreRaw, userRaw)) return true;
        
        return false;
      });
    }

    // Para AYUDANTE: sus propias ausencias (TODO el historico)
    if (loggedInUser.role === 'ayudante') {
      return datosBase.filter(a => {
        const userDni = String(loggedInUser.dni || '').trim();
        const createdBy = String(a.createdByDni || '').trim();
        if (createdBy && createdBy === userDni) return true;
        
        // Match por nombre: buscar en persona, nombre, chofer
        const userRaw = loggedInUser.nombre || '';
        if (!userRaw) return false;
        
        const personaRaw = a.persona || '';
        const nombreRaw = a.nombre || '';
        const choferRaw = a.chofer || '';
        
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
    const tienePermiso = loggedInUser && (loggedInUser.permisos || {}).rechazos === true;
    if (!tienePermiso) return [];
    
    // Si no hay usuario o es admin, mostrar todos
    if (!loggedInUser || loggedInUser.role === 'admin') return rechazos;
    
    // Para CHOFER: solo sus propios rechazos
    if (loggedInUser.role === 'chofer') {
      return rechazos.filter(r => {
        const userDni = String(loggedInUser.dni || '').trim();
        const createdByDni = String(r.createdByDni || '').trim();
        if (createdByDni && createdByDni === userDni) return true;
        
        const userRaw = loggedInUser.nombre || '';
        if (!userRaw) return false;
        
        const choferDescRaw = r.choferDesc || '';
        const choferRaw = r.chofer || '';
        
        if (choferDescRaw && usuarioCoincide(choferDescRaw, userRaw)) return true;
        if (choferRaw && usuarioCoincide(choferRaw, userRaw)) return true;
        
        return false;
      });
    }
    
    // Para AYUDANTE: mostrar rechazos de los choferes con los que trabajó
    if (loggedInUser.role === 'ayudante') {
      // Buscar en rM los choferes con los que trabajó
      const choferesDelAyudante = new Set();
      rM.forEach(r => {
        if (r.chofer) choferesDelAyudante.add((r.chofer || '').trim());
      });
      
      // Si no trabajó con nadie, no mostrar rechazos
      if (choferesDelAyudante.size === 0) return [];
      
      // Filtrar rechazos de esos choferes
      return rechazos.filter(r => {
        const choferDescRaw = r.choferDesc || '';
        const choferRaw = r.chofer || '';
        
        for (const choferNombre of choferesDelAyudante) {
          if (!choferNombre) continue;
          if (choferDescRaw && usuarioCoincide(choferDescRaw, choferNombre)) return true;
          if (choferRaw && usuarioCoincide(choferRaw, choferNombre)) return true;
        }
        return false;
      });
    }
    
    return [];
  }, [rechazos, loggedInUser, rM, usuarioCoincide]);

  // Filtrar foxtrot por permiso: si tiene permiso, muestra datos según rol
  const foxtrotKpisM = useMemo(() => {
    // Verificar si el usuario tiene permiso de "foxtrot"
    const tienePermiso = loggedInUser && (loggedInUser.permisos || {}).foxtrot === true;
    if (!tienePermiso) return [];
    
    // Si no hay usuario o es admin, mostrar todos
    if (!loggedInUser || loggedInUser.role === 'admin') return foxtrotKpis;
    
    // Para CHOFER: solo sus propios datos
    if (loggedInUser.role === 'chofer') {
      return foxtrotKpis.filter(kpi => {
        const userDni = String(loggedInUser.dni || '').trim();
        const createdByDni = String(kpi.createdByDni || '').trim();
        if (createdByDni && createdByDni === userDni) return true;
        
        const userRaw = loggedInUser.nombre || '';
        if (!userRaw) return false;
        
        const choferMapeadoRaw = kpi.choferMapeado || '';
        const driverNameRaw = kpi.driverName || '';
        
        if (choferMapeadoRaw && usuarioCoincide(choferMapeadoRaw, userRaw)) return true;
        if (driverNameRaw && usuarioCoincide(driverNameRaw, userRaw)) return true;
        
        return false;
      });
    }
    
    // Para AYUDANTE: mostrar KPIs de los choferes con los que trabajó
    if (loggedInUser.role === 'ayudante') {
      // Buscar en rM los choferes con los que trabajó
      const choferesDelAyudante = new Set();
      rM.forEach(r => {
        if (r.chofer) choferesDelAyudante.add((r.chofer || '').trim());
      });
      
      // Si no trabajó con nadie, no mostrar KPIs
      if (choferesDelAyudante.size === 0) return [];
      
      // Filtrar KPIs de esos choferes
      return foxtrotKpis.filter(kpi => {
        const choferMapeadoRaw = kpi.choferMapeado || '';
        const driverNameRaw = kpi.driverName || '';
        
        for (const choferNombre of choferesDelAyudante) {
          if (!choferNombre) continue;
          if (choferMapeadoRaw && usuarioCoincide(choferMapeadoRaw, choferNombre)) return true;
          if (driverNameRaw && usuarioCoincide(driverNameRaw, choferNombre)) return true;
        }
        return false;
      });
    }
    
    return [];
  }, [foxtrotKpis, loggedInUser, rM, usuarioCoincide]);

  const K = useMemo(() => {
    const bultos   = rM.reduce((s, r) => s + (+r.bultos || 0), 0);
    const recargas = rM.reduce((s, r) => s + (r.nRecargas || 0), 0);
    const recSI    = rM.filter(r => r.nRecargas > 0).length;
    const tandilB  = rM.filter(r => isT(r.localidad)).reduce((s, r) => s + (+r.bultos || 0), 0);
    const floresB  = rM.filter(r => !isT(r.localidad)).reduce((s, r) => s + (+r.bultos || 0), 0);
    return { bultos, recargas, recSI, tandilB, floresB, total: rM.length };
  }, [rM]);

  const alertas = useMemo(() => {
    const al = [];
    if (K.recargas >= cfg.alertaRecargas)
      al.push(`⚡ Se alcanzó el umbral de ${cfg.alertaRecargas} recargas`);
    const pend = rM.filter(r => r.recCant === 'Pendiente FTE' || r.recCant === 'Pendiente Bultos');
    if (pend.length > 0) al.push(`📋 ${pend.length} registros con datos pendientes`);
    return al;
  }, [rM, K, cfg]);

  // ── CRUD Registros ────────────────────────────────────────────────────────
  const saveReg = useCallback(async (f) => {
    try {
      const esEdicion = regs.some(r => r.id === f.id);
      const payload = { ...f };
      // Si es nueva creación y hay usuario loguado, guardar DNI del creador
      if (!esEdicion && loggedInUser) {
        payload.createdByDni = loggedInUser.dni;
      }
      const guardado  = esEdicion
        ? await actualizarRegistro(f.id, payload)
        : await crearRegistro(payload);
      setRegs(prev => esEdicion
        ? prev.map(r => r.id === guardado.id ? guardado : r)
        : [...prev, guardado]
      );
      notify(esEdicion ? '✓ Registro actualizado' : '✓ Registro guardado');
    } catch (err) {
      notify(`❌ ${err.message}`, 'w');
    }
  }, [regs, notify, loggedInUser]);

  const delReg = useCallback(async (id) => {
    try {
      await eliminarRegistro(id);
      setRegs(prev => prev.filter(r => r.id !== id));
      notify('Registro eliminado', 'w');
    } catch (err) {
      notify(`❌ ${err.message}`, 'w');
    }
  }, [notify]);

  // ── CRUD Ausencias ────────────────────────────────────────────────────────
  const saveAus = useCallback(async (f) => {
    try {
      const esEdicion = aus.some(a => a.id === f.id);
      const payload = { ...f };
      // Si es nueva creación y hay usuario loguado, guardar DNI del creador
      if (!esEdicion && loggedInUser) {
        payload.createdByDni = loggedInUser.dni;
      }
      const guardada  = esEdicion
        ? await actualizarAusencia(f.id, payload)
        : await crearAusencia(payload);
      setAus(prev => esEdicion
        ? prev.map(a => a.id === guardada.id ? guardada : a)
        : [...prev, guardada]
      );
      notify('✓ Ausencia guardada');
    } catch (err) {
      notify(`❌ ${err.message}`, 'w');
    }
  }, [aus, notify, loggedInUser]);

  const delAus = useCallback(async (id) => {
    try {
      await eliminarAusencia(id);
      setAus(prev => prev.filter(a => a.id !== id));
      notify('Ausencia eliminada', 'w');
    } catch (err) {
      notify(`❌ ${err.message}`, 'w');
    }
  }, [notify]);

  // ── Config ────────────────────────────────────────────────────────────────
  const saveCfg = useCallback(async (nc) => {
    try {
      // Validar permiso de editar_contenido para admin
      if (loggedInUser && loggedInUser.role === 'admin') {
        const tienePermiso = (loggedInUser.permisos || {}).editar_contenido === true;
        if (!tienePermiso) {
          // Permitir si el admin está intentando auto-asignarse el permiso (salida del círculo vicioso)
          const usuariosRaw = Array.isArray(nc.usuarios) ? nc.usuarios : [];
          const usuarioEnNuevoCfg = usuariosRaw.find(u => 
            String(u.dni || '').trim() === String(loggedInUser.dni).trim()
          );
          const seAsignaPermiso = usuarioEnNuevoCfg && (usuarioEnNuevoCfg.permisos || {}).editar_contenido === true;
          
          if (!seAsignaPermiso) {
            notify('❌ No tienes permiso para editar contenido. Solicítale al administrador principal.', 'w');
            return;
          }
        }
      } else if (!loggedInUser || loggedInUser.role !== 'admin') {
        // Solo admin puede guardar configuración
        notify('❌ Solo administradores pueden guardar cambios', 'w');
        return;
      }

      const usuariosRaw = Array.isArray(nc.usuarios) ? nc.usuarios : [];
      const cfgActual = cfg || {};
      const usuariosActuales = Array.isArray(cfgActual.usuarios) ? cfgActual.usuarios : [];
      
      // Mapas rápidos por DNI
      const permisosByDni = {};
      const roleByDni = {};
      usuariosActuales.forEach(u => {
        const dni = String(u.dni || '').trim();
        if (u.permisos) permisosByDni[dni] = u.permisos;
        if (u.role) roleByDni[dni] = u.role;  // Preservar role existente
      });

      const usuariosNormalizados = [];
      const seenDnis = new Set();
      const seenNombres = new Set();

      usuariosRaw.forEach(u => {
        const nombre = String(u.nombre || '').trim();
        const dni = String(u.dni || '').trim();
        const claveNombre = normalizarNombre(nombre);
        if (!nombre || !dni) return;
        if (seenDnis.has(dni)) return;
        if (seenNombres.has(claveNombre)) return;
        seenDnis.add(dni);
        seenNombres.add(claveNombre);

        // Preservar: role existente en BD > role nuevo > default 'chofer'
        const role = u.role || roleByDni[dni] || 'chofer';
        
        // Preservar: NEW del form > old de BD > vacío
        const permisos = u.permisos || permisosByDni[dni] || {};

        usuariosNormalizados.push({ nombre, dni, role, permisos });
      });

      const payload = { ...nc, usuarios: usuariosNormalizados };
      const guardada = await guardarConfig(payload);

      const cfgMerge = { ...DC, ...guardada };
      if (guardada?.driverMap)        cfgMerge.driverMap        = guardada.driverMap;
      if (guardada?.diasNoTrabajados) cfgMerge.diasNoTrabajados = guardada.diasNoTrabajados;
      if (guardada?.paramXMes)        cfgMerge.paramXMes        = guardada.paramXMes;
      if (guardada?.usuarios)         cfgMerge.usuarios         = guardada.usuarios;
      setCfg(cfgMerge);
      
      // Actualizar loggedInUser SI está loguado, buscando por DNI en la nueva config
      if (loggedInUser && loggedInUser.dni) {
        const usuarioActualizado = (cfgMerge.usuarios || []).find(u => 
          String(u.dni || '').trim() === String(loggedInUser.dni).trim()
        );
        if (usuarioActualizado) {
          setLoggedInUser(prev => ({
            ...prev,
            role: usuarioActualizado.role || prev.role,
            permisos: usuarioActualizado.permisos || prev.permisos,
          }));
        }
      }
      
      notify('✓ Configuración guardada');
    } catch (err) {
      notify(`❌ ${err.message}`, 'w');
    }
  }, [notify, normalizarNombre, cfg, loggedInUser]);

  // ── Rechazos ──────────────────────────────────────────────────────────────
  const saveRechazos = useCallback(async (rows, archivo, totalesArchivo) => {
    try {
      const res = await importarRechazos(rows, archivo);
      const todos = await getRechazos();
      setRechazos(Array.isArray(todos) ? todos : []);
      const mesesEnRows = [...new Set(rows.map(r => (r.fecha||'').slice(0,7)).filter(m => m.length===7))];
      const mesArchivo = mesesEnRows.length === 1 ? mesesEnRows[0] : null;
      if (mesArchivo && totalesArchivo?.bultosTotal > 0) {
        const cfgActual = await getConfig();
        const bultosXMesActual = { ...(cfgActual?.bultosXMes || {}) };
        bultosXMesActual[mesArchivo] = { total: Math.round(totalesArchivo.bultosTotal), porChofer: totalesArchivo.bultosPorChofer || {} };
        const cfgActualizada = { ...cfgActual, bultosTotal: Math.round(totalesArchivo.bultosTotal), bultosPorChofer: totalesArchivo.bultosPorChofer || {}, bultosXMes: bultosXMesActual };
        await guardarConfig(cfgActualizada);
        setCfg(prev => ({ ...prev, ...cfgActualizada }));
        setBultosXMes(bultosXMesActual);
      }
      const r = res?.resultado;
      notify(r ? `✓ ${r.ok} rechazos guardados${r.fail>0?` · ${r.fail} fallaron`:''}` : `✓ ${rows.length} rechazos guardados`);
    } catch (err) {
      notify(`❌ Error al guardar rechazos: ${err.message}`, 'w');
    }
  }, [notify]);

  const editRec = useCallback(async (datos) => {
    try {
      const res = await editarRechazo(datos.id, datos);
      const guardado = res?.data || res;
      setRechazos(prev => prev.map(r => r.id === guardado?.id ? guardado : r));
      notify('✓ Rechazo actualizado');
    } catch (err) {
      notify(`❌ ${err.message}`, 'w');
    }
  }, [notify]);

  const delRec = useCallback(async (id) => {
    try {
      await eliminarRechazo(id);
      setRechazos(prev => prev.filter(r => r.id !== id));
      notify('Rechazo eliminado', 'w');
    } catch (err) {
      notify(`❌ ${err.message}`, 'w');
    }
  }, [notify]);

  const allP   = useMemo(() => [...new Set([...cfg.choferes, ...cfg.ayudantes])], [cfg]);
  const navMap = { registros: 'registros', ausencias: 'ausencias', reportes: 'reportes' };

  const tabs = [
    { id: 'dashboard', lb: '📊 Dashboard' },
    { id: 'registros', lb: '🚛 Registros' },
    { id: 'ausencias', lb: '📋 Ausencias' },
    { id: 'personal',  lb: '👥 Personal'  },
    { id: 'costos',    lb: '💰 Costos'    },
    { id: 'reportes',  lb: '📈 Reportes'  },
    { id: 'rechazos',  lb: '❌ Rechazos'  },
    { id: 'foxtrot',   lb: '📡 Foxtrot'   },
    { id: 'importar',  lb: '📂 Importar'  },
    { id: 'config',    lb: '⚙ Config'    },
    { id: 'notas',     lb: '📌 Notas'     },
  ];

  // Filtrar tabs según permisos del usuario loguado (TODOS incluido admin)
  const tabsVisibles = useMemo(() => {
    if (!loggedInUser) return tabs;
    const permisos = loggedInUser.permisos || {};
    return tabs.filter(t => permisos[t.id] === true);
  }, [loggedInUser, tabs]);

  // CRÍTICO: Si usuario no tiene acceso a tab actual, redirigir al PRIMER tab permitido
  useEffect(() => {
    if (!loggedInUser) {
      setTab('dashboard');
      return;
    }
    
    if (loggedInUser.role === 'admin') return; // admin ve todo
    
    const permisos = loggedInUser.permisos || {};
    const tabPermitido = permisos[tab] === true;
    
    if (!tabPermitido) {
      // Ir al primer tab que tenga permiso
      const primerTabPermitido = tabs.find(t => permisos[t.id] === true);
      if (primerTabPermitido) {
        setTab(primerTabPermitido.id);
      }
    }
  }, [loggedInUser, tab, tabs]);

  // ── Renderizado ───────────────────────────────────────────────────────────
  if (cargando || errConex) return <Cargando error={errConex} />;
  if (mostrarMigracion)     return <TMigracion onCompletada={onMigracionCompletada} />;
  if (!loggedInUser) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', padding: 24 }}>
        <div style={{ width: 360, background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', boxShadow: '0 4px 16px rgba(0,0,0,.08)', padding: 24 }}>
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <div style={{ fontSize: 56, marginBottom: 12 }} id="loginLogo">
              <img src="/icon-day.png?v=1" alt="logo" style={{ height: 64, display: 'block' }} onLoad={(e) => e.target.style.display = 'block'} onError={(e) => {
                e.target.style.display = 'none';
                document.getElementById('loginLogo').textContent = '🍺';
              }} />
            </div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1f2937', margin: 0 }}>Beer Tan Sa</h1>
            <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 0 0' }}>Sistema de Reparto</p>
          </div>
          <h2 style={{ marginBottom: 6 }}>🔒 Acceso al sistema</h2>
          <p style={{ color: '#64748b', marginBottom: 16 }}>Ingresá nombre y apellido, y DNI como contraseña.</p>
          <div style={{ display: 'grid', gap: 12 }}>
            <input className="filter-input" placeholder="Nombre y Apellido" value={loginNombre}
              onChange={e => setLoginNombre(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && document.getElementById('loginDniInput')?.focus()} />
            <input id="loginDniInput" className="filter-input" type="password" placeholder="DNI" value={loginDni}
              onChange={e => setLoginDni(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()} />
            <button className="btn-action btn-primary-action" onClick={handleLogin}>Entrar</button>
            {loginError && <div style={{ color: '#b91c1c', fontWeight: 700 }}>{loginError}</div>}
            {!cfg.usuarios || cfg.usuarios.length === 0 ? (
              <div style={{ color: '#f59e0b', fontSize: 13 }}>No hay usuarios configurados. Abrí Configuración para agregar usuarios con DNI.</div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  const paramDelMes  = (cfg.paramXMes || {})[mes] || {};
  const cfgConBultos = { ...cfg, bultosXMes };
  const cfgConMes    = { ...cfgConBultos, ...paramDelMes };

  return (
    <div className="app-root">
      <nav className="app-nav">
        <div className="nav-brand">
          <span className="nav-logo">🚛</span>
          <div>
            <span className="nav-title">{cfg.empresa || 'Sistema de Reparto'}</span>
            <span className="nav-sub">Panel Operativo · v3</span>
          </div>
        </div>
        <div className="nav-tabs">
          {tabsVisibles.map(t => (
            <button key={t.id}
              className={`nav-tab ${tab === t.id ? 'nav-tab-active' : ''}`}
              onClick={() => setTab(t.id)}>
              {t.lb}
              {t.id === 'dashboard' && alertas.length > 0 && <span className="nav-alert-dot" />}
            </button>
          ))}
        </div>
        <div className="nav-right">
          {loggedInUser && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ textAlign: 'right', fontSize: 12 }}>
                <div style={{ fontWeight: 700, color: '#1f2937' }}>👤 {loggedInUser.nombre}</div>
                <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>
                  {loggedInUser.role === 'admin' ? '🔑 Admin' : loggedInUser.role === 'chofer' ? '🚗 Chofer' : '🤝 Ayudante'}
                </div>
              </div>
              <button className="btn-action btn-ghost" style={{ padding: '6px 12px', fontSize: 12, marginRight: 8 }} onClick={handleLogout}>Salir</button>
            </div>
          )}
          <span className="nav-date">
            {new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })}
          </span>
          <button className="nav-hamburger" onClick={() => setMenuOpen(o => !o)} aria-label="Menú">
            {menuOpen ? '✕' : '☰'}
          </button>
        </div>
      </nav>

      {menuOpen && (
        <div className="nav-dropdown">
          {tabsVisibles.map(t => (
            <button key={t.id}
              className={`nav-dropdown-item ${tab === t.id ? 'nav-dropdown-item-active' : ''}`}
              onClick={() => { setTab(t.id); setMenuOpen(false); }}>
              {t.lb}
              {t.id === 'dashboard' && alertas.length > 0 && <span className="nav-alert-dot" style={{ position:'static', display:'inline-block', marginLeft:6 }} />}
            </button>
          ))}
        </div>
      )}

      <main className="app-main">
        {tab === 'dashboard' && (
          <TDash K={K} rM={rM} aM={aM} cfg={cfgConMes} mes={mes} setMes={handleSetMes} alertas={alertas}
            onR={() => setModal({ t: 'reg' })} onA={() => setModal({ t: 'aus' })}
            onEdit={r => setModal({ t: 'reg', d: r })} onDel={delReg}
            onNav={dest => setTab(navMap[dest] || dest)}
            regsAll={regs} rechazos={rechazos} onNavRechazos={() => setTab('rechazos')}
            foxtrotKpis={foxtrotKpis} onNavFoxtrot={() => setTab('foxtrot')}
            loggedInUser={loggedInUser} />
        )}
        {tab === 'registros' && (
          <TRegs rM={rM} mes={mes} setMes={handleSetMes}
            regsAll={regs} ausAll={aus}
            onNew={() => setModal({ t: 'reg' })}
            onEdit={r => setModal({ t: 'reg', d: r })}
            onDel={delReg}
            loggedInUser={loggedInUser} />
        )}
        {tab === 'ausencias' && (
          <TAus aM={aM} mes={mes} setMes={handleSetMes}
            regsAll={regs} ausAll={aus}
            onNew={() => setModal({ t: 'aus' })}
            onEdit={a => setModal({ t: 'aus', d: a })}
            onDel={delAus}
            loggedInUser={loggedInUser} />
        )}
        {tab === 'personal' && (
          <TPersonal rM={rM} aM={aM} cfg={cfg} mes={mes} setMes={handleSetMes}
            loggedInUser={loggedInUser}
            regsAll={regs} ausAll={aus} />
        )}
        {tab === 'costos' && (
          <TCostos rM={rM} K={K} cfg={cfg} mes={mes} setMes={handleSetMes}
            regsAll={regs} ausAll={aus}
            loggedInUser={loggedInUser} />
        )}
        {tab === 'reportes' && (
          <TReportes rM={rM} aM={aM} K={K} cfg={cfg} mes={mes} setMes={handleSetMes}
            regsAll={regs} ausAll={aus}
            loggedInUser={loggedInUser}
            onXLSX={() => {
              try {
                exportarReporteXLSX({ rM, aM, K, cfg, mes, regsAll: regs, ausAll: aus });
                notify('✓ Excel generado correctamente');
              } catch(e) {
                notify('❌ Error al generar Excel: ' + e.message, 'w');
              }
            }}
            onPDF={() => { window.print(); notify('Abriendo PDF'); }} />
        )}
        {tab === 'rechazos' && (
          <TRechazos rechazos={rechazosM} regs={regs} cfg={cfgConMes} loggedInUser={loggedInUser}
            onEditar={editRec} onEliminar={delRec} />
        )}
        {tab === 'foxtrot' && (
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
        {tab === 'importar' && (
          <TImportacion cfg={cfg} aus={aus} onSaveReg={saveReg} onSaveRechazos={saveRechazos} />
        )}
        {tab === 'config' && (
          <TConfig cfg={cfg} onSave={saveCfg}
            loggedInUser={loggedInUser} />
        )}
        {tab === 'notas' && (
          <TNotas cfg={cfg} mes={mes} setMes={handleSetMes}
            regsAll={regs} ausAll={aus}
            loggedInUser={loggedInUser}
            notify={notify} />
        )}
      </main>

      {modal?.t === 'reg' && (
        <MReg d={modal.d} cfg={cfg} aus={aus} onSave={saveReg} onClose={() => setModal(null)} loggedInUser={loggedInUser} />
      )}
      {modal?.t === 'aus' && (
        <MAus d={modal.d} cfg={cfg} all={allP} onSave={saveAus} onClose={() => setModal(null)} loggedInUser={loggedInUser} />
      )}

      {toast && (
        <div className="toast-wrap">
          <div className={`toast-msg toast-${toast.type}`}>
            {toast.type === 'w' ? '⚠ ' : '✓ '}{toast.msg}
          </div>
        </div>
      )}

      <footer className="app-footer">
        © {new Date().getFullYear()} Beer Tan SA · Todos los derechos reservados
      </footer>
    </div>
  );
}