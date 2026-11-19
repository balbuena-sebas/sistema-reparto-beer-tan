// components/Tutorial.js — Tutorial guiado paso a paso + botón flotante "Tutorial".
// La primera vez que un usuario entra se muestra el recorrido general de su rol (admin / chofer / ayudante);
// la primera vez que abre una sección con ayuda, se muestra el de esa sección. Después queda solo el botón ❓.
// "Visto" se guarda por usuario en este navegador (localStorage).
import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import '../styles/tutorial.css';

const T = (id) => ({ tab: id });                       // resalta la pestaña del menú
const B = (texto) => ({ buscar: texto });              // resalta la tarjeta/botón que contiene ese texto

export const GENERAL = {
  admin: [
    { titulo: '¡Bienvenido!', texto: 'Este es el panel operativo de Beer Tan. En un minuto te muestro cada sección. Cuando quieras repetirlo, usá el botón ❓ Tutorial de abajo a la derecha.' },
    { sel: '.nav-tabs', titulo: 'Menú de secciones', texto: 'Arriba están todas las secciones. Cada una tiene además su propio tutorial: aparece solo la primera vez que la abrís.' },
    { ...T('registros'), titulo: 'Registros', texto: 'Cada reparto del día: chofer, ayudantes, bultos, recargas y costo.' },
    { ...T('ausencias'), titulo: 'Ausencias', texto: 'Vacaciones, licencias y días libres. La Simulación las lee sola para saber quién no está ese día.' },
    { ...T('costos'), titulo: 'Costos', texto: 'Personal y repartos del mes, con los montos que cargues en Config.' },
    { ...T('simulacion'), titulo: 'Simulación', texto: 'Arma el reparto de mañana: camiones, clientes, km, combustible, personal y recargas. Se actualiza en vivo a medida que cargás los pedidos.' },
    { ...T('importar'), titulo: 'Importar', texto: 'Acá subís el Excel del ruteador (romaneo), la maestra de clientes y los rechazos.' },
    { ...T('config'), titulo: 'Config', texto: 'Montos de chofer y ayudante, parámetros por mes, usuarios y días no trabajados. Toda la app toma de acá los importes: cargalos una vez por mes.' },
    { titulo: 'Listo', texto: 'Si te perdés, tocá ❓ Tutorial: repite esta guía o la de la sección en que estés.' },
  ],
  persona: [
    { titulo: '¡Bienvenido!', texto: 'Te muestro en un minuto lo que necesitás de esta app. Podés repetirlo cuando quieras con el botón ❓ Tutorial de abajo a la derecha.' },
    { sel: '.nav-tabs', titulo: 'Menú', texto: 'Estas son las secciones que tenés habilitadas.' },
    { ...T('registros'), titulo: 'Registros', texto: 'Tus repartos: ahí ves lo cargado de cada día y podés completar o corregir lo tuyo.' },
    { ...T('ausencias'), titulo: 'Ausencias', texto: 'Tus ausencias (vacaciones, licencias, días libres). Si necesitás cargar una, usá «+ Nueva Ausencia».' },
    { ...T('notas'), titulo: 'Notas', texto: 'Avisos y recordatorios del equipo.' },
    { ...T('biolinks'), titulo: 'Links', texto: 'Accesos rápidos, por ejemplo las tarjetas de seguro de los vehículos.' },
    { titulo: 'Listo', texto: 'Cuando tengas una duda, tocá ❓ Tutorial.' },
  ],
};

export const SECCION = {
  simulacion: [
    { titulo: 'Simulación del reparto', texto: 'Simula cómo conviene repartir mañana. Trabaja con los pedidos que cargás y se actualiza en vivo para todos los usuarios.' },
    { ...B('Subir pedidos'), titulo: '1. Pedidos', texto: 'Subí el Excel de pedidos y elegí la fecha de entrega. Podés sumar varios archivos (uno por día de pedido) y se acumulan.' },
    { ...B('Planilla de armado'), titulo: '2. Planilla de armado', texto: 'Todos los clientes con bultos, localidad, camión y chofer. Tildalos para sumarlos a un camión, dejarlos fuera (con motivo), o dividir la carga de un cliente grande con ✂.' },
    { ...B('Editar el reparto'), titulo: '3. Editar a mano', texto: 'Si querés cambiar lo que propuso el motor, tocá «Editar esta propuesta»: mové clientes, juntá o partí camiones y fijá el orden. Todo se recalcula.' },
    { titulo: '4. Mapa', texto: 'En el mapa podés marcar clientes con círculo, lazo o rectángulo (con Shift sumás) y mandarlos juntos a un camión o dejarlos fuera.' },
    { titulo: '5. Personal y recargas', texto: 'Todos salen con chofer y ayudante. Si un camión cae en recarga y sobran ayudantes, se le suma un 2º para evitarla. El costo de la recarga usa los montos de Config.' },
    { ...B('Choferes del día'), titulo: '6. Ausencias y choferes', texto: 'Los choferes y ayudantes que cargaste en Ausencias ese día se descuentan solos. También podés destildar a alguien a mano.' },
    { ...B('Parámetros'), titulo: '7. Parámetros', texto: 'Camiones disponibles hoy (hoy 7: 8 menos 1 en el taller), límites de recarga y autoelevador en Las Flores.' },
    { ...B('Probar el motor con este día'), titulo: '8. Probar el motor', texto: 'Con el romaneo real que te da el ruteador (puede ser al día siguiente), «Probar el motor con este día» compara lo que habría armado con lo que se hizo, y aprende.' },
  ],
  registros: [
    { ...B('Nuevo Registro'), titulo: 'Nuevo registro', texto: 'Con este botón cargás un reparto: chofer, ayudantes, bultos y recarga.' },
    { titulo: 'Lista', texto: 'Abajo ves los repartos del mes. Con ✏ editás y con 🗑 borrás (pide confirmación).' },
  ],
  ausencias: [
    { ...B('Nueva Ausencia'), titulo: 'Nueva ausencia', texto: 'Cargá vacaciones, licencias o días libres con fecha desde / hasta.' },
    { titulo: 'Para qué sirve', texto: 'La Simulación usa estas ausencias para saber qué choferes y ayudantes están disponibles ese día.' },
  ],
  config: [
    { ...B('Datos de la Empresa'), titulo: 'Montos', texto: 'Costo de chofer, ayudante, operarios y temporada, y los parámetros de bultos para recargas. Toda la app toma estos importes.' },
    { ...B('Parámetros por Mes'), titulo: 'Montos del mes', texto: 'Cuando tengas los montos del mes, cargalos acá: costos y simulación usan los del mes elegido.' },
    { ...B('Usuarios'), titulo: 'Usuarios', texto: 'Alta de usuarios y qué secciones ve cada uno. Cada rol ve su propio tutorial.' },
  ],
  importar: [
    { ...B('Importar Datos'), titulo: 'Importar', texto: 'Subí los archivos del día. El Excel de Planificación del ruteador (romaneo) alimenta la Simulación, que aprende de cada día.' },
  ],
};
const SECCION_PERSONA = {
  registros: [
    { ...B('Nuevo Registro'), titulo: 'Tu reparto', texto: 'Cargá o completá tu reparto del día con este botón.' },
    { titulo: 'Lista', texto: 'Ves solo lo tuyo. Con ✏ corregís lo que cargaste.' },
  ],
  ausencias: [
    { ...B('Nueva Ausencia'), titulo: 'Nueva ausencia', texto: 'Si vas a faltar, cargalo acá con fecha desde / hasta.' },
  ],
};

const rolDe = (u) => { const r = String((u && u.role) || '').toLowerCase(); return r === 'admin' ? 'admin' : 'persona'; };
const claveDe = (u, id) => `tut:${(u && (u.dni || u.nombre)) || 'anon'}:${id}`;
const visto = (u, id) => { try { return localStorage.getItem(claveDe(u, id)) === '1'; } catch { return false; } };
const marcar = (u, id) => { try { localStorage.setItem(claveDe(u, id), '1'); } catch { /* sin almacenamiento: se muestra de nuevo la próxima vez */ } };

function buscarEl(p) {
  if (p.sel) return document.querySelector(p.sel);
  if (p.tab) return document.querySelector(`[data-tut="tab-${p.tab}"]`);
  if (p.buscar) {
    const q = p.buscar.toLowerCase();
    const el = [...document.querySelectorAll('h1,h2,h3,button,.card-title,.dash-title')].find((e) => e.offsetParent && (e.textContent || '').toLowerCase().includes(q));
    return el ? (el.closest('.sim-card, .card') || el) : null;
  }
  return null;
}
const hayEl = (p) => !(p.sel || p.tab || p.buscar) || !!buscarEl(p);

export function Tutorial({ user, tab }) {
  const [ses, setSes] = useState(null);                    // { id, pasos, i }
  const [rect, setRect] = useState(null);
  const [menu, setMenu] = useState(false);
  const rol = rolDe(user);
  const general = GENERAL[rol];
  const seccion = (rol === 'persona' && SECCION_PERSONA[tab]) || SECCION[tab] || null;

  const abrir = useCallback((id, pasos) => {
    const ok = pasos.filter(hayEl);
    if (ok.length) { setSes({ id, pasos: ok, i: 0 }); setMenu(false); }
  }, []);
  const cerrar = useCallback(() => { if (ses) marcar(user, ses.id); setSes(null); setRect(null); }, [ses, user]);

  // Primera vez: recorrido general; si ya lo vio, el de la sección en que entra.
  useEffect(() => {
    if (!user || ses) return undefined;
    const t = setTimeout(() => {
      if (!visto(user, 'general')) abrir('general', general);
      else if (seccion && !visto(user, `sec-${tab}`)) abrir(`sec-${tab}`, seccion);
    }, 900);
    return () => clearTimeout(t);
  }, [user, tab]);  // eslint-disable-line react-hooks/exhaustive-deps

  const paso = ses ? ses.pasos[ses.i] : null;
  const medir = useCallback(() => {
    if (!paso) return;
    const el = buscarEl(paso);
    if (!el) { setRect(null); return; }
    const r = el.getBoundingClientRect();
    setRect(r.width && r.height ? { top: r.top, left: r.left, width: r.width, height: r.height } : null);
  }, [paso]);
  useLayoutEffect(() => {
    if (!paso) return undefined;
    const el = buscarEl(paso);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'auto' });
    medir();
    const t = setInterval(medir, 400);
    window.addEventListener('resize', medir); window.addEventListener('scroll', medir, true);
    return () => { clearInterval(t); window.removeEventListener('resize', medir); window.removeEventListener('scroll', medir, true); };
  }, [paso, medir]);
  useEffect(() => {
    if (!ses) return undefined;
    const k = (e) => { if (e.key === 'Escape') cerrar(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [ses, cerrar]);

  if (!user) return null;
  const ir = (d) => setSes((s) => ({ ...s, i: s.i + d }));
  const ultimo = ses && ses.i === ses.pasos.length - 1;
  // Posición de la tarjeta: debajo del elemento resaltado si entra, si no arriba; centrada si no hay elemento
  let pos = { top: '50%', left: '50%', transform: 'translate(-50%,-50%)' };
  if (rect) {
    const h = window.innerHeight, w = window.innerWidth, ancho = Math.min(340, w - 24);
    const abajo = rect.top + rect.height + 12 + 190 < h;
    pos = { top: abajo ? rect.top + rect.height + 12 : Math.max(12, rect.top - 190), left: Math.max(12, Math.min(rect.left, w - ancho - 12)) };
  }
  return (
    <>
      {ses && paso && (
        <div className="tut-capa" role="dialog" aria-label="Tutorial">
          {rect ? <div className="tut-foco" style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }} /> : <div className="tut-fondo" />}
          <div className="tut-caja" style={pos}>
            <div className="tut-paso">Paso {ses.i + 1} de {ses.pasos.length}</div>
            <div className="tut-titulo">{paso.titulo}</div>
            <div className="tut-texto">{paso.texto}</div>
            <div className="tut-botones">
              <button className="tut-btn tut-omitir" onClick={cerrar}>Omitir</button>
              <span style={{ flex: 1 }} />
              {ses.i > 0 && <button className="tut-btn" onClick={() => ir(-1)}>Anterior</button>}
              {ultimo ? <button className="tut-btn tut-primario" onClick={cerrar}>Terminar</button> : <button className="tut-btn tut-primario" onClick={() => ir(1)}>Siguiente</button>}
            </div>
          </div>
        </div>
      )}
      <div className="tut-flotante">
        {menu && (
          <div className="tut-menu">
            {seccion && <button className="tut-btn" onClick={() => abrir(`sec-${tab}`, seccion)}>Esta pantalla</button>}
            <button className="tut-btn" onClick={() => abrir('general', general)}>Recorrido general</button>
          </div>
        )}
        <button className="tut-fab" title="Tutorial" onClick={() => (seccion ? setMenu((m) => !m) : abrir('general', general))}>❓ Tutorial</button>
      </div>
    </>
  );
}
export default Tutorial;
