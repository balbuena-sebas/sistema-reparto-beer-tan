$file = 'c:\Users\sebas\Documents\CHOFERES\mi-app-reparto\frontend\src\components\TNotas.js'
$content = [IO.File]::ReadAllText($file, [Text.Encoding]::UTF8)

# Reemplazar la sección de botones
$oldSection = '        </div>
        <div style={{ display:''flex'', gap:6, flexShrink:0 }}>
          {!resuelta && (
            <button onClick={() => onResolver(nota.id)} title="Marcar como resuelta"
              style={{ width:30, height:30, borderRadius:8, border:''2px solid #86efac'',
                background:''#dcfce7'', color:''#166534'', cursor:''pointer'', fontSize:14,
                display:''flex'', alignItems:''center'', justifyContent:''center'' }}>✓</button>
          )}
          {!resuelta && (
            <button onClick={() => onEditar(nota)} title="Editar"
              style={{ width:30, height:30, borderRadius:8, border:''2px solid #f59e0b'',
                background:''#fef3c7'', color:''#78350f'', cursor:''pointer'', fontSize:13,
                display:''flex'', alignItems:''center'', justifyContent:''center'' }}>✏</button>
          )}
          <button onClick={() => { if (window.confirm(''¿Eliminar esta nota?'')) onEliminar(nota.id); }}
            style={{ width:30, height:30, borderRadius:8, border:''2px solid #fca5a5'',
              background:''#fee2e2'', color:''#b91c1c'', cursor:''pointer'', fontSize:13,
              display:''flex'', alignItems:''center'', justifyContent:''center'' }}>🗑</button>
        </div>'

$newSection = '        </div>
        {canEdit && (
          <div style={{ display:''flex'', gap:6, flexShrink:0 }}>
            {!resuelta && (
              <button onClick={() => onResolver(nota.id)} title="Marcar como resuelta"
                style={{ width:30, height:30, borderRadius:8, border:''2px solid #86efac'',
                  background:''#dcfce7'', color:''#166534'', cursor:''pointer'', fontSize:14,
                  display:''flex'', alignItems:''center'', justifyContent:''center'' }}>✓</button>
            )}
            {!resuelta && (
              <button onClick={() => onEditar(nota)} title="Editar"
                style={{ width:30, height:30, borderRadius:8, border:''2px solid #f59e0b'',
                  background:''#fef3c7'', color:''#78350f'', cursor:''pointer'', fontSize:13,
                  display:''flex'', alignItems:''center'', justifyContent:''center'' }}>✏</button>
            )}
            <button onClick={() => { if (window.confirm(''¿Eliminar esta nota?'')) onEliminar(nota.id); }}
              style={{ width:30, height:30, borderRadius:8, border:''2px solid #fca5a5'',
                background:''#fee2e2'', color:''#b91c1c'', cursor:''pointer'', fontSize:13,
                display:''flex'', alignItems:''center'', justifyContent:''center'' }}>🗑</button>
          </div>
        )}'

$content = $content -replace [regex]::Escape($oldSection), $newSection

# Actualizar llamadas a CardNota en ColumnaPersona
$content = $content -replace 'CardNota key=\{n\.id\} nota=\{n\} onEditar=\{onEditar\} onResolver=\{onResolver\} onEliminar=\{onEliminar\}', 'CardNota key={n.id} nota={n} onEditar={onEditar} onResolver={onResolver} onEliminar={onEliminar} loggedInUser={loggedInUser}'

# Actualizar constructor de ColumnaPersona
$content = $content -replace 'const ColumnaPersona = \({ persona, notas, onEditar, onResolver, onEliminar, onNueva }\)', 'const ColumnaPersona = ({ persona, notas, onEditar, onResolver, onEliminar, onNueva, loggedInUser })'

# Actualizar botón "Nueva nota" en ColumnaPersona
$content = $content -replace 'onClick={() => onNueva}\(persona\)', 'onClick={() => {if (!loggedInUser || loggedInUser.role === "admin") onNueva(persona)}}'

[IO.File]::WriteAllText($file, $content, [Text.Encoding]::UTF8)
Write-Host "✓ TNotas.js actualizado"
