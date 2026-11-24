// simulacion/chequeos.js — "Revisá antes de cerrar": junta en UNA lista todo lo que puede estar mal en el reparto,
// para no tener que buscarlo en cada tarjeta. Es una función pura (no toca la pantalla), fácil de probar.
//
// Cada ítem: { id, nivel: 'error' | 'aviso' | 'info', paso: 1..4, titulo, detalle?, foco? }
//   foco: { camion: índice de ruta } | { filtro: 'grandes' | 'notoca' | 'fuera' }  → a dónde lleva al tocarlo.
import { minutosRuta } from './engine';

const f0 = (n) => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(n || 0);

export function calcularChequeos(d) {
  const out = [];
  const { sim, pedidosN, sinUbicN, quedanN, quedanBultos, choferesRutas, personalPresente, tiempos, noTocanN, grandesFueraN,
    fueraSinMotivoN, costoSinConfig, preciosViejos, precioError, agregados } = d;
  if (!pedidosN) { out.push({ id: 'pedidos', nivel: 'error', paso: 1, titulo: 'Todavía no hay pedidos cargados', detalle: 'Subí el Excel de pedidos de Chess para simular.' }); return out; }
  if (!sim) { out.push({ id: 'salen', nivel: 'error', paso: 1, titulo: 'No sale ninguna localidad', detalle: 'Tildá alguna localidad para simular.' }); return out; }

  if (sinUbicN > 0) out.push({ id: 'sinub', nivel: 'aviso', paso: 1, titulo: `${sinUbicN} cliente(s) sin ubicación`, detalle: 'No entran en el mapa ni en los km. Cargá la maestra de clientes o el romaneo en Importar → Ruteo.' });
  if (quedanN > 0) out.push({ id: 'quedan', nivel: 'info', paso: 1, titulo: `Quedan para otro día ${quedanN} clientes (${f0(quedanBultos)} bultos)`, detalle: 'Son las localidades que destildaste en el paso 1.' });

  if (sim.tope && sim.tope.pendientes && sim.tope.pendientes.length) {
    const sinCamion = sim.tope.pendientes.reduce((t, x) => t + x.bultos, 0);
    out.push({ id: 'tope', nivel: 'error', paso: 2, titulo: `⛔ No alcanzan los camiones: ${f0(sinCamion)} bultos quedan sin camión (${sim.tope.pendientes.length} grupo(s))`,
      detalle: `Con ${sim.tope.max} camiones, aun cargados al máximo, no entra todo. Sumá un camión o un utilitario, hacé un segundo viaje o pasá esos clientes al día siguiente.` });
  } else if (sim.tope && sim.tope.ajuste) {
    out.push({ id: 'tope-aj', nivel: 'aviso', paso: 2, titulo: `Hay ${sim.tope.max} camiones y hacían falta ${sim.tope.necesarios}: salen más cargados`, detalle: `Para no agregar camiones: ${sim.tope.ajuste}. Revisá la recarga, las personas y la jornada de cada uno.` });
  }
  const sinChofer = (choferesRutas || []).map((x, i) => (!x || !x.chofer ? i : -1)).filter((i) => i >= 0);
  if (sinChofer.length) out.push({ id: 'chofer', nivel: 'error', paso: 2, titulo: `${sinChofer.length} camión(es) sin chofer`, detalle: 'Hay más camiones que choferes disponibles. Elegí uno a mano o revisá las ausencias.', foco: { camion: sinChofer[0] } });
  if (sim.totales.personas > personalPresente) out.push({ id: 'personal', nivel: 'error', paso: 2, titulo: `Falta personal: hacen falta ${sim.totales.personas} y hay ${personalPresente}`, detalle: 'Se cuentan los choferes y ayudantes de Configuración menos las ausencias del día.' });
  const llenos = sim.rutas.map((r, i) => (r.ocupacion > 1 ? i : -1)).filter((i) => i >= 0);
  if (llenos.length) out.push({ id: 'cap', nivel: 'error', paso: 2, titulo: `⛔ ${llenos.length} camión(es) pasan la capacidad física (más de ${f0(sim.params.palletsPorCamion * sim.params.bultosPorPallet)} bultos)`, detalle: 'Pasá clientes a otro camión o sumá uno.', foco: { camion: llenos[0] } });
  const largas = sim.rutas.map((r, i) => (minutosRuta(tiempos, { paradas: r.paradas.length, km: r.km, bultos: r.bultos }) > tiempos.limite ? i : -1)).filter((i) => i >= 0);
  if (largas.length) out.push({ id: 'jornada', nivel: 'aviso', paso: 2, titulo: `${largas.length} jornada(s) más largas que lo habitual`, detalle: 'Partí el camión en 2 o pasá clientes a otro.', foco: { camion: largas[0] } });
  const conRec = sim.rutas.map((r, i) => (r.recargas > 0 && !r.autoelevador ? i : -1)).filter((i) => i >= 0);
  if (conRec.length) out.push({ id: 'recarga-n', nivel: 'aviso', paso: 2, titulo: `${conRec.length} camión(es) con recarga: pasan los bultos que entran de una vez`, detalle: 'Cada recarga suma tiempo y costo. Ponele 3 personas al camión (selector «Personas») o pasá clientes a otro.', foco: { camion: conRec[0] } });
  const recA = sim.rutas.map((r, i) => (r.alertaRecarga ? i : -1)).filter((i) => i >= 0);
  if (recA.length) out.push({ id: 'recarga', nivel: 'aviso', paso: 2, titulo: `${recA.length} camión(es) con una recarga que conviene revisar`, detalle: 'Llevan más bultos de lo normal con recarga.', foco: { camion: recA[0] } });
  const poca = sim.rutas.map((r, i) => (r.pocaCarga ? i : -1)).filter((i) => i >= 0);
  if (poca.length) out.push({ id: 'poca', nivel: 'aviso', paso: 2, titulo: `${poca.length} camión(es) con muy poca carga`, detalle: 'Conviene postergar esos clientes o agruparlos con otro camión.', foco: { camion: poca[0] } });

  if (agregados > 0) out.push({ id: 'agregados', nivel: 'aviso', paso: 3, titulo: `Entraron ${agregados} clientes nuevos desde que editaste`, detalle: 'Se sumaron al camión más cercano. Revisalos.' });
  if (noTocanN > 0) out.push({ id: 'notoca', nivel: 'aviso', paso: 3, titulo: `${noTocanN} cliente(s) a los que hoy no les toca entrega`, detalle: 'Según la hoja Frecuencia. Dejalos fuera con el botón 📅.', foco: { filtro: 'notoca' } });
  if (grandesFueraN > 0) out.push({ id: 'grandes', nivel: 'aviso', paso: 3, titulo: `${grandesFueraN} cliente(s) grande(s) que suelen ir aparte`, detalle: 'Según el historial casi siempre se llevan aparte o no salen.', foco: { filtro: 'grandes' } });
  if (fueraSinMotivoN > 0) out.push({ id: 'motivo', nivel: 'info', paso: 3, titulo: `${fueraSinMotivoN} cliente(s) fuera sin motivo`, detalle: 'Anotá por qué no salen: la app aprende de eso.', foco: { filtro: 'fuera' } });

  if (costoSinConfig) out.push({ id: 'costo', nivel: 'aviso', paso: 4, titulo: 'Falta el costo de chofer y ayudante', detalle: 'Cargalo en Configuración para ver el costo del personal y de cada recarga.' });
  if (precioError) out.push({ id: 'precio', nivel: 'aviso', paso: 4, titulo: 'No se pudo leer el precio actual del gasoil', detalle: 'Se usan los precios fijos, que pueden estar viejos.' });
  else if (preciosViejos) out.push({ id: 'precio', nivel: 'info', paso: 4, titulo: 'Hay precios de gasoil con más de 14 días', detalle: 'Tocá «Actualizar precios ahora» en el paso 4.' });
  return out;
}
