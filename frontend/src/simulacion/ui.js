// simulacion/ui.js — Piezas visuales reutilizables de la pestaña Simulación:
// ayuda contextual (ⓘ), secciones plegables y el glosario con las palabras del negocio.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

// Una sola definición de cada concepto: la usan todos los ⓘ de la pantalla.
export const GLOSARIO = {
  paso1: 'Cargá los pedidos de mañana y decidí qué localidades salen. Con eso el sistema arma una propuesta de camiones.',
  paso2: 'Revisá cada camión: quién lo maneja, cuánta carga lleva y cuánto tarda. Acá también juntás, partís o reordenás camiones.',
  paso3: 'Cliente por cliente: pasalo a otro camión, dejalo fuera para otro día o dividí su carga entre varios camiones.',
  paso4: 'Cuánto cuesta el día (combustible y personal), por localidad, y en qué estación conviene cargar.',
  recarga: 'Cuando la carga no entra en un solo viaje, el camión vuelve al depósito y carga otra vez. Sale una sola vez por camión. El límite de bultos sin recarga sale de Configuración (con 2 personas y con 3 personas).',
  ocupacion: 'Qué parte de la capacidad del camión se usa (pallets cargados ÷ pallets que entran). Verde: bien aprovechado. Amarillo: va casi vacío.',
  jornada: 'Horas estimadas del día del camión: salida y carga + conducción + paradas. Se aprende de los romaneos reales. La marca roja es el límite habitual: al 90 % de las jornadas reales les alcanzó.',
  frecuencia: 'Los días de la semana en que le toca entrega a cada cliente según la hoja Frecuencia del ruteador. Si hoy no toca, conviene dejarlo fuera para otro día.',
  grande: 'Cliente de mucho volumen. Se marca con ⚠ para que decidas uno por uno si sale en un camión normal, se lleva aparte (mercados, terceros) o se divide entre camiones.',
  dividir: 'Reparte los bultos de un mismo cliente entre varios camiones. El cliente aparece en cada camión con su parte y km, pallets y personas se recalculan.',
  motivo: 'Por qué un cliente no sale hoy. Queda anotado y la app aprende de esas decisiones.',
  autoelevador: 'Las Flores se descarga con autoelevador: sale el chofer solo y no se paga recarga. Si fuese descarga manual, se destilda.',
  personal: 'Siempre sale chofer + 1 ayudante. Si un camión cae en recarga y sobran ayudantes, se le suma un 2º ayudante para evitarla. Los ausentes (pestaña Ausencias) se descuentan solos.',
  editado: 'Mientras nadie toca nada, el sistema recalcula solo. En cuanto movés algo a mano, el reparto queda fijo: los clientes nuevos se suman al camión más cercano y podés volver al automático cuando quieras.',
  tope: 'Camiones que hay hoy para salir (8 en total menos los que están en el taller). Si no alcanzan, el sistema los apila y te avisa qué queda sin camión.',
  km: 'Km medidos por calles (🛣️) cuando ya se calculó el recorrido; si no, se estiman en línea recta × factor de ruta.',
  costo: 'Combustible = litros × precio de la estación elegida. Personal = sueldo mensual de Configuración ÷ días hábiles del mes, por cada persona del camión.',
};

// ⓘ que abre una burbuja con la explicación. Se cierra tocando afuera o con Esc; sirve igual con mouse y con el dedo.
export function Ayuda({ clave, texto }) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef(null);
  const pop = useRef(null);
  const [corr, setCorr] = useState(0);
  useEffect(() => {
    if (!abierto) return undefined;
    const fuera = (e) => { if (caja.current && !caja.current.contains(e.target)) setAbierto(false); };
    const esc = (e) => { if (e.key === 'Escape') setAbierto(false); };
    document.addEventListener('mousedown', fuera); document.addEventListener('touchstart', fuera); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fuera); document.removeEventListener('touchstart', fuera); document.removeEventListener('keydown', esc); };
  }, [abierto]);
  // Si la burbuja se sale de la pantalla (celular), se corre para adentro.
  useLayoutEffect(() => {
    if (!abierto || !pop.current) { setCorr(0); return; }
    const r = pop.current.getBoundingClientRect(), W = window.innerWidth;
    setCorr(r.right > W - 8 ? -(r.right - W + 8) : r.left < 8 ? 8 - r.left : 0);
  }, [abierto]);
  const t = texto || GLOSARIO[clave];
  if (!t) return null;
  return (
    <span className="sim-ayuda" ref={caja}>
      <button type="button" className="sim-ayuda-b" aria-label="¿Qué es esto?" aria-expanded={abierto} onClick={(e) => { e.stopPropagation(); setAbierto((v) => !v); }}>ⓘ</button>
      {abierto && <span ref={pop} role="note" className="sim-ayuda-pop" style={corr ? { transform: `translateX(${corr}px)` } : undefined}>{t}</span>}
    </span>
  );
}

// Sección plegable con título, ayuda y una insignia (por ejemplo la cantidad de avisos).
export function Seccion({ titulo, ayuda, insignia, tono, abierta = true, children, extra }) {
  const [on, setOn] = useState(abierta);
  return (
    <section className={`sim-card sim-sec ${on ? 'on' : ''}`}>
      <div className="sim-sec-h">
        <button type="button" className="sim-sec-t" aria-expanded={on} onClick={() => setOn((v) => !v)}>
          <span className="sim-sec-flecha">{on ? '▾' : '▸'}</span> {titulo}
          {insignia != null && insignia !== '' && <span className={`sim-pill ${tono || ''}`}>{insignia}</span>}
        </button>
        {ayuda && <Ayuda clave={ayuda} />}
        {extra && <span className="sim-sec-extra">{extra}</span>}
      </div>
      {on && <div className="sim-sec-c">{children}</div>}
    </section>
  );
}
