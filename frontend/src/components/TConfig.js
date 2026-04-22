import React, { useState, useCallback } from 'react';
import { PERMISOS_DEFAULTS, normalizarUsuario } from '../config/permissions';

// ── ListEditor fuera del componente para evitar re-mount en cada keystroke ────
const ListEditor = ({ label, listKey, placeholder, items, newVal, onNewVal, onAdd, onRemove, type="text" }) => (
  <div className="list-editor">
    <div className="list-editor-header">
      <span className="list-editor-title">{label}</span>
      <span className="list-editor-count">{items.length}</span>
    </div>
    <div className="list-tags">
      {items.map(item => {
        const val = typeof item === 'object' ? (item.fecha || item.label || '—') : item;
        return (
          <span key={val} className="list-tag">
            {val}
            <button className="tag-remove" onClick={() => onRemove(listKey, item)}>×</button>
          </span>
        );
      })}
    </div>
    <div className="list-add">
      <input
        className="filter-input"
        type={type}
        placeholder={placeholder}
        value={newVal}
        onChange={e => onNewVal(listKey, e.target.value)}
        onKeyDown={e => e.key === 'Enter' && onAdd(listKey)}
      />
      <button className="btn-action btn-primary-action" onClick={() => onAdd(listKey)}>+ Agregar</button>
    </div>
  </div>
);

export const TConfig = ({ cfg, onSave, loggedInUser }) => {
  const [form, setForm] = useState(() => {
    // Llenar permisos faltantes en usuarios existentes al cargar TConfig
    const cfgAjustada = { ...cfg };
    if (Array.isArray(cfgAjustada.usuarios)) {
      cfgAjustada.usuarios = cfgAjustada.usuarios.map(u => {
        // Si no tiene permisos definidos, usar los defaults del role
        // Si ya tiene permisos explícitos, usar SOLO esos sin sobrescribir
        const permisos = u.permisos && Object.keys(u.permisos).length > 0
          ? u.permisos
          : (PERMISOS_DEFAULTS[u.role] || PERMISOS_DEFAULTS.chofer);
        return { ...u, permisos };
      });
    }
    return cfgAjustada;
  });
  const [saved, setSaved] = useState(false);
  const [newItems, setNewItems] = useState({
    choferes: '', ayudantes: '', operarios: '', temporada: '', patentes: '',
    localidades: '', destinos: '', motivosAusencia: '', personasNotas: '',
  });
  const [nuevoUsuario, setNuevoUsuario] = useState({ nombre: '', dni: '', role: 'chofer' });
  const [usuarioEditandoIdx, setUsuarioEditandoIdx] = useState(null);

  // Sincronizar el formulario si cfg cambia externamente (ej: tras un refresh)
  React.useEffect(() => {
    setForm(prev => {
      // Solo actualizar si no hay cambios manuales en el formulario actual
      // para no pisar lo que el usuario está escribiendo.
      if (JSON.stringify(prev) === JSON.stringify(cfg)) return prev;
      return { ...cfg };
    });
  }, [cfg]);

  const addUsuario = () => {
    const nombre = (nuevoUsuario.nombre || '').trim();
    const dni = (nuevoUsuario.dni || '').trim();
    const role = (nuevoUsuario.role || 'chofer');
    if (!nombre || !dni) return;
    const usuariosPrev = Array.isArray(form.usuarios) ? form.usuarios : [];
    const nombreNorm = normalizarUsuario(nombre);
    const existeUsuario = usuariosPrev.some(u =>
      String(u.dni || '').trim() === dni || normalizarUsuario(u.nombre || '') === nombreNorm
    );
    if (existeUsuario) {
      setSaved(false);
      setNuevoUsuario({ nombre: '', dni: '', role: 'chofer' });
      return;
    }
    const permisos = PERMISOS_DEFAULTS[role] || PERMISOS_DEFAULTS.chofer;
    setF('usuarios', [...usuariosPrev, { nombre, dni, role, permisos }]);
    setNuevoUsuario({ nombre: '', dni: '', role: 'chofer' });
  };

  const removeUsuario = (idx) => {
    const user = (form.usuarios || [])[idx];
    if (!window.confirm(`¿Estás seguro que deseas ELIMINAR a ${user.nombre}?\n\nEsta acción es irreversible.`)) return;
    setF('usuarios', (form.usuarios || []).filter((_, i) => i !== idx));
  };

  const updateUsuarioPermiso = (idx, permiso, valor) => {
    const usuarios = Array.isArray(form.usuarios) ? form.usuarios : [];
    const nuevoUsuarios = usuarios.map((u, i) => {
      if (i === idx) {
        // Preservar TODOS los permisos existentes y actualizar el específico
        const permsActuales = u.permisos || {};
        const permisosActualizados = {
          ...permsActuales,
          [permiso]: valor === true
        };
        return { ...u, permisos: permisosActualizados };
      }
      return u;
    });
    setF('usuarios', nuevoUsuarios);
  };

  // Mes activo para parámetros por mes — inicia en el mes actual
  const [mesParam, setMesParam] = useState(() => {
    const hoy = new Date();
    return `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}`;
  });

  // Días no trabajados (paros, puentes, feriados extra)
  const [nuevoDia, setNuevoDia] = useState({ fecha: '', motivo: '' });
  const diasNoTrabajados = form.diasNoTrabajados || [];
  const addDia = () => {
    const fecha = nuevoDia.fecha.trim();
    if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return alert('Ingresá una fecha válida en formato YYYY-MM-DD');
    if (diasNoTrabajados.find(d => d.fecha === fecha)) return alert('Esa fecha ya está cargada');
    setF('diasNoTrabajados', [
      ...diasNoTrabajados,
      { fecha, motivo: nuevoDia.motivo.trim() || 'Sin especificar' },
    ].sort((a,b) => a.fecha.localeCompare(b.fecha)));
    setNuevoDia({ fecha: '', motivo: '' });
  };
  const removeDia = (fecha) => setF('diasNoTrabajados', diasNoTrabajados.filter(d => d.fecha !== fecha));
  const formatFecha = (iso) => { const [y,m,d] = iso.split('-'); return `${d}/${m}/${y}`; };

  // Driver map
  const [nuevoDriver, setNuevoDriver] = useState({ id: '', nombre: '', zona: '' });

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const addItem = useCallback((list) => {
    const val = newItems[list]?.trim();
    if (!val) return;
    setForm(f => {
      const current = f[list] || [];
      if (list === 'diasNoTrabajados') {
        if (current.some(d => d.fecha === val)) return f;
        return { ...f, [list]: [...current, { fecha: val }] };
      }
      if (current.includes(val)) return f;
      return { ...f, [list]: [...current, val] };
    });
    setNewItems(n => ({ ...n, [list]: '' }));
  }, [newItems]);

  const removeItem = useCallback((list, val) =>
    setForm(f => {
      const current = f[list] || [];
      if (list === 'diasNoTrabajados') {
        return { ...f, [list]: current.filter(d => d.fecha !== (val.fecha || val)) };
      }
      return { ...f, [list]: current.filter(x => x !== val) };
    })
  , []);

  const onNewVal = useCallback((list, val) =>
    setNewItems(n => ({ ...n, [list]: val }))
  , []);

  // Driver map helpers
  const driverMap = form.driverMap || [];
  const addDriver = () => {
    const id     = nuevoDriver.id.trim();
    const nombre = nuevoDriver.nombre.trim();
    const zona   = nuevoDriver.zona || '';
    if (!id || !nombre) return;
    const existe = driverMap.findIndex(d => d.id === id);
    const entry  = { id, nombre, zona };
    const nuevo  = existe >= 0
      ? driverMap.map((d, i) => i === existe ? entry : d)
      : [...driverMap, entry];
    setF('driverMap', nuevo);
    setNuevoDriver({ id: '', nombre: '', zona: '' });
  };
  const removeDriver = (id) => {
    const driver = driverMap.find(d => d.id === id);
    if (!window.confirm(`¿Estás seguro que deseas ELIMINAR el mapeo de ${driver.nombre}?\n\nEsta acción es irreversible.`)) return;
    setF('driverMap', driverMap.filter(d => d.id !== id));
  };

  // Bulk import
  const [bulkText, setBulkText] = useState('');
  const [showBulk, setShowBulk] = useState(false);
  const [bulkZona, setBulkZona] = useState('');
  const importarBulk = () => {
    const lineas = bulkText.split('\n').map(l => l.trim()).filter(Boolean);
    const nuevos = [];
    lineas.forEach(l => {
      const match = l.match(/^(\d+)[,\s\-]+([^,]+?)(?:[,\s]+(Tandil|Las Flores))?$/i);
      if (match) {
        const zona = match[3] || bulkZona || '';
        nuevos.push({ id: match[1].trim(), nombre: match[2].trim(), zona });
      }
    });
    if (nuevos.length === 0) return alert('No se encontraron IDs válidos. Formato: ID, Nombre (una por línea)');
    const merged = [...driverMap];
    nuevos.forEach(n => {
      const i = merged.findIndex(d => d.id === n.id);
      if (i >= 0) merged[i] = n; else merged.push(n);
    });
    setF('driverMap', merged);
    setBulkText('');
    setShowBulk(false);
    alert(`✓ ${nuevos.length} driver${nuevos.length !== 1 ? 's' : ''} importados`);
  };

  const [saving, setSaving] = useState(false);
  const handleSave = async () => {
    setSaving(true);
    // Normalizar permisos antes de guardar: asegurar que TODOS los permisos estén explícitamente definidos
    const permisosList = ['editar_contenido', 'dashboard', 'registros', 'ausencias', 'personal', 'costos', 'reportes', 'rechazos', 'foxtrot', 'importar', 'config', 'notas', 'biolinks'];
    const formNormalizado = {
      ...form,
      usuarios: (form.usuarios || []).map(u => ({
        ...u,
        permisos: permisosList.reduce((acc, p) => {
          acc[p] = (u.permisos || {})[p] === true ? true : false;
          return acc;
        }, {})
      }))
    };
    await onSave(formNormalizado);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="dash-container">
      <div className="dash-header">
        <div>
          <h2 className="dash-title">Configuración</h2>
          <p className="dash-sub">Parámetros del sistema</p>
        </div>
        <div className="dash-header-right">
          <button className="btn-action btn-primary-action" onClick={handleSave} disabled={saving}>
            {saving ? '⏳ Guardando...' : saved ? '✓ Guardado' : '💾 Guardar Cambios'}
          </button>
        </div>
      </div>

      {/* Empresa */}
      <div className="dash-card">
        <div className="card-header"><span className="card-title">Datos de la Empresa</span></div>
        <div className="config-grid">
          <div className="config-field">
            <label>Nombre de la Empresa</label>
            <input className="filter-input" value={form.empresa || ''} onChange={e => setF('empresa', e.target.value)} />
          </div>
          <div className="config-field">
            <label>Costo Chofer ($/mes)</label>
            <input className="filter-input" type="number" value={form.costoChofer ?? ''} onChange={e => setF('costoChofer', e.target.value === '' ? undefined : +e.target.value)} />
          </div>
          <div className="config-field">
            <label>Costo Ayudante ($/mes)</label>
            <input className="filter-input" type="number" value={form.costoAyudante ?? ''} onChange={e => setF('costoAyudante', e.target.value === '' ? undefined : +e.target.value)} />
          </div>
          <div className="config-field">
            <label>Costo Operario Chofer ($/mes)</label>
            <input className="filter-input" type="number" value={form.costoOperarioChofer ?? ''} onChange={e => setF('costoOperarioChofer', e.target.value === '' ? undefined : +e.target.value)} />
          </div>
          <div className="config-field">
            <label>Costo Operario Ayudante ($/mes)</label>
            <input className="filter-input" type="number" value={form.costoOperarioAyudante ?? ''} onChange={e => setF('costoOperarioAyudante', e.target.value === '' ? undefined : +e.target.value)} />
          </div>
          <div className="config-field">
            <label>Costo Personal Temporada ($/mes)</label>
            <input className="filter-input" type="number" value={form.costoTemporada ?? ''} onChange={e => setF('costoTemporada', e.target.value === '' ? undefined : +e.target.value)} />
          </div>
          <div className="config-field">
            <label>Obj. Bultos Tandil (mensual)</label>
            <input className="filter-input" type="number" value={form.objTandil ?? ''} onChange={e => setF('objTandil', e.target.value === '' ? undefined : +e.target.value)} />
          </div>
          <div className="config-field">
            <label>Obj. Bultos Las Flores (mensual)</label>
            <input className="filter-input" type="number" value={form.objFlores ?? ''} onChange={e => setF('objFlores', e.target.value === '' ? undefined : +e.target.value)} />
          </div>
          <div className="config-field">
            <label>Alerta Recargas (umbral)</label>
            <input className="filter-input" type="number" value={form.alertaRecargas ?? ''} onChange={e => setF('alertaRecargas', e.target.value === '' ? undefined : +e.target.value)} />
          </div>
          <div className="config-field">
            <label>Parámetro Bultos 1</label>
            <input className="filter-input" type="number" value={form.param1 ?? ''} onChange={e => setF('param1', e.target.value === '' ? undefined : +e.target.value)} />
          </div>
          <div className="config-field">
            <label>Parámetro Bultos 2</label>
            <input className="filter-input" type="number" value={form.param2 ?? ''} onChange={e => setF('param2', e.target.value === '' ? undefined : +e.target.value)} />
          </div>
          <div className="config-field">
            <label>Parámetro Bultos 3</label>
            <input className="filter-input" type="number" value={form.param3 ?? ''} onChange={e => setF('param3', e.target.value === '' ? undefined : +e.target.value)} />
          </div>
        </div>
      </div>

      {loggedInUser?.dni === 'admin' ? (
        <div className="dash-card">
          <div className="card-header">
            <span className="card-title">🔗 Mapeo Driver ID → Chofer</span>
            <span className="card-badge">{driverMap.length} drivers cargados</span>
          </div>
          <div style={{ background:'#e8f3ff', border:'2px solid #60a5fa', borderRadius:10, padding:'12px 16px', marginBottom:18, fontSize:13, color:'#1e3a8a', fontWeight:600, lineHeight:1.6 }}>
            📋 Los CSV de Foxtrot identifican al chofer con un número (Driver ID). <strong>El mismo chofer tiene un ID distinto por zona</strong> — por eso también guardamos la zona de cada ID.
            <br />Ejemplo: <code style={{ background:'#dbeafe', padding:'1px 6px', borderRadius:4 }}>7004 → Acosta Roberto (Tandil)</code> · <code style={{ background:'#dbeafe', padding:'1px 6px', borderRadius:4 }}>7005 → Acosta Roberto (Las Flores)</code>
          </div>

          {driverMap.length > 0 && (
            <div className="table-wrap" style={{ marginBottom:16 }}>
              <table className="dash-table">
                <thead><tr><th>Driver ID</th><th>Nombre del Chofer</th><th>Zona</th><th style={{ width:60 }}></th></tr></thead>
                <tbody>
                  {[...driverMap].sort((a,b) => a.id.localeCompare(b.id, undefined, { numeric:true })).map(d => (
                    <tr key={d.id}>
                      <td><code style={{ fontFamily:'var(--font-mono)', fontWeight:800, color:'#005fa3' }}>{d.id}</code></td>
                      <td><strong>{d.nombre}</strong></td>
                      <td>
                        {d.zona && (
                          <span style={{ fontSize:12, padding:'2px 10px', borderRadius:12, fontWeight:700, background:d.zona==='Tandil'?'#fff7e0':'#e8f3ff', color:d.zona==='Tandil'?'#78350f':'#1e40af', border:`1px solid ${d.zona==='Tandil'?'#f59e0b':'#60a5fa'}` }}>
                            📍 {d.zona}
                          </span>
                        )}
                      </td>
                      <td>
                        <button onClick={() => removeDriver(d.id)}
                          style={{ background:'#fee2e2', border:'none', color:'#b91c1c', borderRadius:6, padding:'4px 10px', cursor:'pointer', fontWeight:700, fontSize:13 }}>×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ display:'grid', gridTemplateColumns:'130px 1fr 150px auto', gap:10, marginBottom:12, alignItems:'end' }}>
            <div>
              <label style={{ display:'block', fontSize:12, fontWeight:800, color:'var(--text3)', textTransform:'uppercase', marginBottom:5 }}>Driver ID</label>
              <input className="filter-input" placeholder="ej: 7004"
                value={nuevoDriver.id}
                onChange={e => setNuevoDriver(n => ({ ...n, id: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && addDriver()} />
            </div>
            <div>
              <label style={{ display:'block', fontSize:12, fontWeight:800, color:'var(--text3)', textTransform:'uppercase', marginBottom:5 }}>Nombre del Chofer</label>
              <input className="filter-input" placeholder="ej: Acosta Roberto"
                value={nuevoDriver.nombre}
                onChange={e => setNuevoDriver(n => ({ ...n, nombre: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && addDriver()} />
            </div>
            <div>
              <label style={{ display:'block', fontSize:12, fontWeight:800, color:'var(--text3)', textTransform:'uppercase', marginBottom:5 }}>Zona</label>
              <select className="filter-select" style={{ width:'100%' }} value={nuevoDriver.zona || ''}
                onChange={e => setNuevoDriver(n => ({ ...n, zona: e.target.value }))}>
                <option value="">— Sin zona —</option>
                <option value="Tandil">Tandil</option>
                <option value="Las Flores">Las Flores</option>
              </select>
            </div>
            <button className="btn-action btn-primary-action" onClick={addDriver} style={{ marginBottom:2 }}>+ Agregar</button>
          </div>

          <button onClick={() => setShowBulk(b => !b)}
            style={{ background:'none', border:'2px dashed var(--border)', color:'var(--text3)', borderRadius:10, padding:'8px 16px', cursor:'pointer', fontSize:13, fontWeight:700, width:'100%', textAlign:'left' }}>
            {showBulk ? '▲ Ocultar importación masiva' : '▼ Importar varios IDs de una vez (pegar lista)'}
          </button>
          {showBulk && (
            <div style={{ marginTop:12 }}>
              <div style={{ fontSize:13, color:'var(--text3)', fontWeight:600, marginBottom:10 }}>
                Pegá una lista, un driver por línea. Podés especificar la zona en cada línea o elegir una zona por defecto abajo.
                <br /><code>7004, Acosta Roberto, Tandil</code> &nbsp;·&nbsp; <code>7004, Acosta Roberto</code>
              </div>
              <div style={{ display:'flex', gap:12, alignItems:'center', marginBottom:10 }}>
                <label style={{ fontSize:13, fontWeight:700, color:'var(--text2)', whiteSpace:'nowrap' }}>Zona por defecto:</label>
                <select className="filter-select" value={bulkZona} onChange={e => setBulkZona(e.target.value)} style={{ width:180 }}>
                  <option value="">— Sin zona por defecto —</option>
                  <option value="Tandil">📍 Tandil</option>
                  <option value="Las Flores">📍 Las Flores</option>
                </select>
                <span style={{ fontSize:12, color:'var(--text3)', fontWeight:600 }}>(Se aplica a las líneas que no tengan zona escrita)</span>
              </div>
              <textarea
                style={{ width:'100%', height:200, fontFamily:'var(--font-mono)', fontSize:13, border:'2px solid var(--border)', borderRadius:10, padding:10, resize:'vertical' }}
                placeholder={`7003, Romero Diego\n5904, Rodriguez Martin\n5843, Nuñez Gaston\n2195, Rodriguez Nicolas\n1546, Quiroga Luciano\n7004, Acosta Roberto\n211, Perez Fabian\n2016, Dealviso Guillermo`}
                value={bulkText}
                onChange={e => setBulkText(e.target.value)}
              />
              <div style={{ display:'flex', gap:10, marginTop:8 }}>
                <button className="btn-action btn-primary-action" onClick={importarBulk}>✓ Importar lista</button>
                <button className="btn-action btn-ghost" onClick={() => { setBulkText(''); setShowBulk(false); setBulkZona(''); }}>Cancelar</button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {/* ── MANTENIMIENTO NEON (SOLO ADMIN) ── */}
      {loggedInUser?.dni === 'admin' && (
        <div className="dash-card" style={{ border: '2px solid #b87c00', background: '#fffbeb' }}>
          <div className="card-header">
            <span className="card-title" style={{ color: '#92400e' }}>⚡ Mantenimiento de Datos (Neon)</span>
          </div>
          <div style={{ padding: '0 0 16px 0', fontSize: 13, color: '#92400e', fontWeight: 600 }}>
            Si el almacenamiento en Neon está casi lleno, podés comprimir los datos históricos (meses anteriores). 
            Esto liberará espacio borrando detalles innecesarios de registros viejos.
          </div>
          <button 
            className="btn-action" 
            style={{ background: '#d97706', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontWeight: 700, cursor: 'pointer' }}
            onClick={async () => {
              if (!window.confirm("¿Deseas iniciar la compactación de datos históricos?\n\nEste proceso comprimirá registros de Foxtrot y Rechazos de meses pasados.")) return;
              try {
                const res = await fetch(`${process.env.REACT_APP_API_URL}/mantenimiento/optimizar`, {
                  method: 'POST',
                  headers: { 
                    'Content-Type': 'application/json',
                    'x-api-key': process.env.REACT_APP_API_KEY 
                  }
                });
                const data = await res.json();
                if (data.ok) alert("✅ Optimización iniciada. El espacio en Neon bajará gradualmente.");
                else alert("❌ Error: " + data.error);
              } catch (err) {
                alert("❌ Fallo de conexión: " + err.message);
              }
            }}
          >
            🚀 Ejecutar Compactación Histórica
          </button>
        </div>
      )}

      {/* ── PARÁMETROS POR MES ── */}
      <div className="dash-card">
        <div className="card-header">
          <span className="card-title">📅 Parámetros por Mes</span>
          <span className="card-badge">Los valores anulan los globales para ese mes</span>
        </div>
        <div style={{ background:'#e8f3ff', border:'2px solid #60a5fa', borderRadius:10, padding:'12px 16px', marginBottom:18, fontSize:13, color:'#1e3a8a', fontWeight:600, lineHeight:1.6 }}>
          💡 Configurá objetivos y costos distintos para cada mes. Si un mes no tiene valores propios, se usan los globales de arriba.
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:18 }}>
          <label style={{ fontSize:13, fontWeight:800, color:'var(--text2)', whiteSpace:'nowrap' }}>Mes a configurar:</label>
          <input type="month" className="filter-input" style={{ width:200 }}
            value={mesParam} onChange={e => setMesParam(e.target.value)} />
          {(form.paramXMes||{})[mesParam]
            ? <span style={{ fontSize:12, padding:'3px 10px', borderRadius:8, background:'#dcfce7', color:'#166534', fontWeight:700, border:'1px solid #86efac' }}>✓ Configurado</span>
            : <span style={{ fontSize:12, color:'var(--text3)', fontWeight:600 }}>Sin configuración — se usan los valores globales</span>
          }
        </div>
        <div className="config-grid">
          {[
            { key:'objTandil',      label:'Obj. Bultos Tandil (mensual)',    global: form.objTandil },
            { key:'objFlores',      label:'Obj. Bultos Las Flores (mensual)', global: form.objFlores },
            { key:'costoChofer',    label:'Costo Chofer ($/mes)',             global: form.costoChofer },
            { key:'costoAyudante',  label:'Costo Ayudante ($/mes)',           global: form.costoAyudante },
            { key:'costoOperarioChofer',  label:'Costo Op. Chofer ($/mes)',     global: form.costoOperarioChofer },
            { key:'costoOperarioAyudante', label:'Costo Op. Ayudante ($/mes)',    global: form.costoOperarioAyudante },
            { key:'costoTemporada',       label:'Costo Temporada ($/mes)',       global: form.costoTemporada },
            { key:'alertaRecargas', label:'Alerta Recargas (umbral)',         global: form.alertaRecargas },
          ].map(({ key, label, global: gv }) => {
            const val = (form.paramXMes||{})[mesParam]?.[key];
            return (
              <div key={key} className="config-field">
                <label style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span>{label}</span>
                  {val !== undefined && (
                    <button onClick={() => {
                      const px = { ...(form.paramXMes||{}) };
                      const pm = { ...(px[mesParam]||{}) };
                      delete pm[key];
                      if (Object.keys(pm).length === 0) delete px[mesParam]; else px[mesParam] = pm;
                      setF('paramXMes', px);
                    }} style={{ fontSize:11, background:'none', border:'none', color:'#b91c1c', cursor:'pointer', fontWeight:700 }}>
                      × usar global ({gv||0})
                    </button>
                  )}
                </label>
                <input className="filter-input" type="number"
                  placeholder={`Global: ${gv||0}`}
                  value={val ?? ''}
                  onChange={e => {
                    const v = e.target.value === '' ? undefined : +e.target.value;
                    const px = { ...(form.paramXMes||{}) };
                    const pm = { ...(px[mesParam]||{}) };
                    if (v === undefined) delete pm[key]; else pm[key] = v;
                    if (Object.keys(pm).length === 0) delete px[mesParam]; else px[mesParam] = pm;
                    setF('paramXMes', px);
                  }}
                />
                {val === undefined && <div style={{ fontSize:11, color:'var(--text3)', marginTop:2 }}>Usando global: {gv||0}</div>}
              </div>
            );
          })}
        </div>
        {Object.keys(form.paramXMes||{}).length > 0 && (
          <div style={{ marginTop:16, paddingTop:14, borderTop:'2px solid var(--border)' }}>
            <div style={{ fontSize:12, fontWeight:800, color:'var(--text3)', textTransform:'uppercase', marginBottom:10 }}>Meses configurados</div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
              {Object.entries(form.paramXMes||{}).sort().map(([m, p]) => {
                const [y, mo] = m.split('-');
                const lbl = new Date(+y,+mo-1,2).toLocaleString('es-AR',{month:'short',year:'numeric'}).replace('.','');
                return (
                  <div key={m} onClick={() => setMesParam(m)}
                    style={{ padding:'6px 14px', borderRadius:10, cursor:'pointer', fontSize:13, fontWeight:700,
                      background: mesParam===m ? 'var(--accent)' : 'var(--bg3)',
                      color: mesParam===m ? '#fff' : 'var(--text2)',
                      border:'2px solid', borderColor: mesParam===m ? 'var(--accent)' : 'var(--border)' }}>
                    📅 {lbl} <span style={{ fontSize:11, opacity:.8 }}>{Object.keys(p).length} params</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Usuarios (Login) - SOLO ADMINS */}
      {loggedInUser?.dni === 'admin' ? (
        <div className="dash-card">
          <div className="card-header">
            <span className="card-title">👤 Usuarios</span>
            <span className="card-badge">Usuario = Nombre/Apellido, contraseña = DNI</span>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr auto', gap:10, marginBottom:12, alignItems:'end' }}>
            <div className="config-field" style={{ margin:0 }}>
              <label>Nombre y Apellido</label>
              <input className="filter-input" value={nuevoUsuario.nombre} onChange={e => setNuevoUsuario(u => ({ ...u, nombre: e.target.value }))} />
            </div>
            <div className="config-field" style={{ margin:0 }}>
              <label>DNI</label>
              <input className="filter-input" value={nuevoUsuario.dni} onChange={e => setNuevoUsuario(u => ({ ...u, dni: e.target.value }))} />
            </div>
            <div className="config-field" style={{ margin:0 }}>
              <label>Rol</label>
              <select className="filter-select" value={nuevoUsuario.role} onChange={e => setNuevoUsuario(u => ({ ...u, role: e.target.value }))}>
                <option value="admin">Admin</option>
                <option value="chofer">Chofer</option>
                <option value="ayudante">Ayudante</option>
              </select>
            </div>
            <button className="btn-action btn-primary-action" onClick={addUsuario} style={{ marginBottom: 2 }}>+ Agregar</button>
          </div>
          {(!form.usuarios || form.usuarios.length === 0) ? (
            <p style={{ fontSize:13, color:'var(--text3)', fontStyle:'italic' }}>
              Agregá usuarios para permitir el ingreso. El nombre puede ingresarse como "Apellido Nombre" o "Nombre Apellido".
            </p>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              {(form.usuarios || []).map((u, i) => (
                <div key={`${u.dni}-${i}`} style={{ border:'2px solid var(--border)', borderRadius:10, padding:12, background:'var(--bg2)' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: usuarioEditandoIdx === i ? 12 : 0 }}>
                    <div>
                      <div style={{ fontSize:14, fontWeight:800, color:'var(--text)' }}>{u.nombre}</div>
                      <div style={{ fontSize:12, color:'var(--text3)', fontWeight:600 }}>
                        DNI: <code style={{ fontFamily:'var(--font-mono)', color:'#005fa3' }}>{u.dni}</code> · 
                        Rol: <span style={{ 
                          padding:'2px 8px', 
                          borderRadius:6, 
                          background: u.role === 'admin' ? '#dbeafe' : u.role === 'chofer' ? '#fef3c7' : '#ddd6fe',
                          color: u.role === 'admin' ? '#1e40af' : u.role === 'chofer' ? '#92400e' : '#5b21b6',
                          fontWeight:700, 
                          fontSize:11 
                        }}>
                          {(u.role || 'chofer').toUpperCase()}
                        </span>
                      </div>
                    </div>
                    <div style={{ display:'flex', gap:8 }}>
                      <button 
                        onClick={() => setUsuarioEditandoIdx(usuarioEditandoIdx === i ? null : i)}
                        style={{ background:'#f0f9ff', border:'2px solid #60a5fa', color:'#0284c7', borderRadius:6, padding:'6px 12px', cursor:'pointer', fontWeight:700, fontSize:12 }}>
                        {usuarioEditandoIdx === i ? '▲ Cerrar' : '▼ Permisos'}
                      </button>
                      <button onClick={() => removeUsuario(i)} style={{ background:'#fee2e2', border:'none', color:'#b91c1c', borderRadius:6, padding:'6px 10px', cursor:'pointer', fontWeight:700, fontSize:13 }}>×</button>
                    </div>
                  </div>

                  {usuarioEditandoIdx === i && (
                    <div style={{ paddingTop:12, borderTop:'2px solid var(--border)', background:'var(--bg3)', padding:12, borderRadius:8 }}>
                      <div style={{ fontSize:12, fontWeight:800, color:'var(--text3)', textTransform:'uppercase', marginBottom:12 }}>Permisos</div>
                      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                        {['editar_contenido', 'dashboard', 'registros', 'ausencias', 'personal', 'costos', 'reportes', 'rechazos', 'foxtrot', 'importar', 'config', 'notas', 'biolinks'].map(permiso => {
                          const valor = (u.permisos || {})[permiso] === true;
                          const labels = {
                            editar_contenido: '🔓 Crear/Editar Contenido',
                            dashboard: '📊 Dashboard', registros: '🚛 Registros', ausencias: '📋 Ausencias',
                            personal: '👥 Personal', costos: '💰 Costos', reportes: '📈 Reportes',
                            rechazos: '❌ Rechazos', foxtrot: '📡 Foxtrot', importar: '📂 Importar',
                            config: '⚙ Config', notas: '📌 Notas', biolinks: '🔗 Links',
                          };
                          return (
                            <label key={permiso} style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', opacity: valor ? 1 : 0.6 }}>
                              <input
                                type="checkbox"
                                checked={valor}
                                onChange={e => updateUsuarioPermiso(i, permiso, e.target.checked)}
                                style={{ cursor:'pointer', width:16, height:16 }}
                              />
                              <span style={{ fontSize:12, fontWeight:700, color:'var(--text2)' }}>{labels[permiso]}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="dash-card" style={{ background:'linear-gradient(135deg, #fee2e2 0%, #fecaca 100%)', border:'2px solid #fca5a5' }}>
          <div style={{ display:'flex', alignItems:'center', gap:16 }}>
            <div style={{ fontSize:40 }}>🔐</div>
            <div>
              <div style={{ fontSize:14, fontWeight:800, color:'#b91c1c', marginBottom:4 }}>Sección Bloqueada</div>
              <div style={{ fontSize:13, color:'#991b1b', fontWeight:600, lineHeight:1.6 }}>
                Solo el <strong>ADMIN</strong> puede gestionar usuarios y permisos del sistema.<br/>
                Si necesitás un permiso, deberá solicitárselo al administrador.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Días no trabajados */}
      <div className="dash-card">
        <div className="card-header">
          <span className="card-title">📅 Días no trabajados</span>
          <span style={{ fontSize:12, color:'var(--text3)', fontWeight:600 }}>
            Paros, feriados puente o cualquier día que no se repartió · Los feriados nacionales argentinos ya están incluidos automáticamente
          </span>
        </div>
        <div style={{ display:'flex', gap:10, alignItems:'flex-end', marginBottom:14, flexWrap:'wrap' }}>
          <div className="config-field" style={{ margin:0 }}>
            <label>Fecha</label>
            <input type="date" className="filter-input" style={{ width:170 }}
              value={nuevoDia.fecha}
              onChange={e => setNuevoDia(n => ({ ...n, fecha: e.target.value }))} />
          </div>
          <div className="config-field" style={{ margin:0, flex:1, minWidth:200 }}>
            <label>Motivo (opcional)</label>
            <input className="filter-input" placeholder="Ej: Paro de transporte, Feriado puente..."
              value={nuevoDia.motivo}
              onChange={e => setNuevoDia(n => ({ ...n, motivo: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && addDia()} />
          </div>
          <button className="btn-action btn-primary-action" onClick={addDia}>+ Agregar</button>
        </div>
        {diasNoTrabajados.length === 0
          ? <p style={{ fontSize:13, color:'var(--text3)', fontStyle:'italic' }}>No hay días extra cargados. Los feriados nacionales se descuentan automáticamente.</p>
          : (
            <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
              {diasNoTrabajados.map(d => (
                <span key={d.fecha} style={{ display:'inline-flex', alignItems:'center', gap:6, background:'var(--bg2)', border:'1.5px solid var(--border)', borderRadius:10, padding:'5px 12px', fontSize:13, fontWeight:700 }}>
                  📅 {formatFecha(d.fecha)}
                  {d.motivo && <span style={{ fontWeight:400, color:'var(--text2)' }}>— {d.motivo}</span>}
                  <button onClick={() => removeDia(d.fecha)} style={{ background:'none', border:'none', cursor:'pointer', color:'#b91c1c', fontWeight:900, fontSize:15, lineHeight:1, padding:'0 2px' }}>×</button>
                </span>
              ))}
            </div>
          )
        }
      </div>

      {/* Listas */}
      <div className="dash-grid-2">
        <ListEditor label="Choferes"               listKey="choferes"        placeholder="Apellido Nombre..."    items={form.choferes||[]}        newVal={newItems.choferes}        onNewVal={onNewVal} onAdd={addItem} onRemove={removeItem} />
        <ListEditor label="Ayudantes"              listKey="ayudantes"       placeholder="Apellido Nombre..."    items={form.ayudantes||[]}       newVal={newItems.ayudantes}       onNewVal={onNewVal} onAdd={addItem} onRemove={removeItem} />
        <ListEditor label="Personal de Temporada"   listKey="temporada"       placeholder="Apellido Nombre..."    items={form.temporada||[]}       newVal={newItems.temporada}       onNewVal={onNewVal} onAdd={addItem} onRemove={removeItem} />
        <ListEditor label="Operarios"              listKey="operarios"       placeholder="Apellido Nombre..."    items={form.operarios||[]}       newVal={newItems.operarios}       onNewVal={onNewVal} onAdd={addItem} onRemove={removeItem} />
        <ListEditor label="Patentes"               listKey="patentes"        placeholder="ABC 123..."            items={form.patentes||[]}        newVal={newItems.patentes}        onNewVal={onNewVal} onAdd={addItem} onRemove={removeItem} />
        <ListEditor label="Localidades"            listKey="localidades"     placeholder="LOCALIDAD (Zona)..."   items={form.localidades||[]}     newVal={newItems.localidades}     onNewVal={onNewVal} onAdd={addItem} onRemove={removeItem} />
        <ListEditor label="Destinos"               listKey="destinos"        placeholder="Nombre destino..."     items={form.destinos||[]}        newVal={newItems.destinos}        onNewVal={onNewVal} onAdd={addItem} onRemove={removeItem} />
        <ListEditor label="Motivos de Ausencia"    listKey="motivosAusencia" placeholder="Motivo..."            items={form.motivosAusencia||[]} newVal={newItems.motivosAusencia} onNewVal={onNewVal} onAdd={addItem} onRemove={removeItem} />
        <ListEditor label="Personas para Notas 📋" listKey="personasNotas"   placeholder="Apellido Nombre..."   items={form.personasNotas||[]}   newVal={newItems.personasNotas||''} onNewVal={onNewVal} onAdd={addItem} onRemove={removeItem} />
      </div>
    </div>
  );
};