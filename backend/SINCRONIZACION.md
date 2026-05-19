# 🔄 Sincronización Neon → Supabase

## Problema Detectado

La tabla `registros` en Supabase tiene una **estructura incorrecta** que no coincide con lo que el código espera. Esto causa el error **500** en `/api/registros`.

### Errores Encontrados:
- ❌ Tabla `registros` en Supabase tiene campos antiguos (hl, recarga, ayudante, etc.)
- ❌ Faltan campos críticos: `ay1`, `ay2`, `patente`, `costo_reparto`, `destinos_gz`, `bultos_clark`, `bultos_rec`, `created_by_dni`, `created_by_nombre`
- ❌ Cuando exportaste manualmente, los datos se copiaron a una tabla con estructura diferente

### Cambios Realizados:
✅ Se actualizó `backend/db.js` con la estructura correcta de `registros`  
✅ Se creó `backend/scripts/sync_neon_to_supabase.js` para sincronizar datos

---

## 🚀 Pasos para Ejecutar la Sincronización

### Scripts disponibles:
```bash
npm run sync-neon        # Sincronizar Neon → Supabase (migraciones de datos)
npm run sync-tables      # Completar tablas faltantes entre Supabase y Neon
npm run verify-schemas   # Verificar que los esquemas sean idénticos
npm run fix-schemas      # Corregir inconsistencias en Neon
npm run check-db         # Diagnosticar estado de la BD
npm start                # Iniciar el servidor
```

### 1️⃣ Verificar que tienes Neon en .env

En `backend/.env`, asegúrate de tener:
```
DATABASE_URL=postgresql://...supabase...  # Tu conexión actual a Supabase
NEON_DATABASE_URL=postgresql://...neon...  # Tu conexión ANTIGUA a Neon
```

Si **no tienes NEON_DATABASE_URL**, debes recuperarla:
- Abre el dashboard de Neon en https://neon.tech
- Ve a "Connection Details"
- Copia la connection string y agrégala a tu `.env`

### 2️⃣ Verificar esquemas
IMPORTANTE: Ejecuta esto ANTES de sincronizar para identificar diferencias:
```bash
npm run verify-schemas
```

Si hay diferencias, ejecuta:
```bash
npm run fix-schemas
```

### 3️⃣ Ejecutar el script de sincronización

```bash
npm run sync-neon
```

### 4️⃣ Iniciar el servidor
```bash
npm start
```

### 5️⃣ Qué hace el script

El script automáticamente:
1. ✅ Reconstruye la tabla `registros` en Supabase con la estructura **CORRECTA**
2. ✅ Migra todos los registros desde Neon → Supabase
3. ✅ Sincroniza también `ausencias` y `configuracion`
4. ✅ Verifica que los datos se migraron correctamente

### 6️⃣ Salida esperada

```
🔄 Iniciando sincronización Neon → Supabase...
✅ Conexiones establecidas
📋 Estructura en Neon: 21 columnas
📥 Obtenidas 115 filas de Neon
⚠️  Reconstruyendo tabla registros en Supabase...
  ✓ Tabla antigua eliminada
  ✓ Tabla registros creada con estructura correcta

📤 Migrando datos a Supabase...
✅ Migración de REGISTROS completada: 115 registros, 0 errores

🔄 Sincronizando tabla AUSENCIAS...
  📥 13 ausencias en Neon
  ✅ Ausencias: 13 migraron, 0 errores

🔄 Sincronizando tabla CONFIGURACION...
  ✅ Configuración sincronizada

📊 Resultados finales en Supabase:
  • Registros: 115
  • Ausencias: 13

✅ Sincronización EXITOSA - Todas las tablas están sincronizadas
```

---

## ⚠️ IMPORTANTE - Antes de sincronizar

**El script ELIMINA la tabla registros actual y la recrea.** Todos los cambios hechos manualmente se perderán. 

Si necesitas salvar algo específico:
1. Exporta los datos de Supabase antes
2. Ejecuta el script
3. Verifica que el API funciona

---

## ✅ Después de sincronizar

1. **Reinicia el backend:**
   ```bash
   npm start
   ```

2. **Verifica en el navegador:**
   - Abre la aplicación web
   - Los registros deben cargar correctamente
   - No debe haber errores 500

3. **Si aún hay errores:**
   - Revisa los logs del servidor
   - Ejecuta `npm run check-db` para diagnosticar

---

## 🆘 Troubleshooting

### Error: "Falta NEON_DATABASE_URL o DATABASE_URL en .env"
→ Agrega `NEON_DATABASE_URL` a tu `.env`

### Error: "connect ENOTFOUND" (no se conecta a Neon)
→ Verifica que:
- La conexión string de Neon sea correcta
- Neon está activo (no suspendido)
- Hay conexión a internet

### Error: "Cantidad de registros no coincide"
→ Puede haber errores en algunos registros. Revisa el log para ver cuáles fallaron.

### El API sigue dando 500
→ El problema podría no ser de la base de datos. Revisa:
- `npm run check-db` para ver el estado
- Los logs del servidor
- La variable `API_SECRET_KEY` en el `.env`

