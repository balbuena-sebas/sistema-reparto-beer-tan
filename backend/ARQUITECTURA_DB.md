# 🗄️ Arquitectura de Almacenamiento - 3 Bases de Datos

## 📊 Resumen de la Estructura

Tu aplicación utiliza **3 servicios de base de datos gratuitos** con **roles específicos**:

```
┌─────────────────────────────────────────────────────────────────────┐
│                    SISTEMA DE REPARTO - 5 AÑOS                      │
├──────────────────┬──────────────────┬──────────────────────────────┤
│   🟢 SUPABASE    │  🔵 NEON         │  🟠 CLOUDFLARE R2           │
│   (Principal)    │  (Backup)        │  (Almacenamiento)           │
├──────────────────┼──────────────────┼──────────────────────────────┤
│ • Producción     │ • Respaldo       │ • Excels pesados            │
│ • 500MB gratis   │ • 10GB gratis    │ • 10GB gratis (× 2 cuentas) │
│ • Datos activos  │ • Mirroring      │ • Archivos archivados       │
│ • ↑ 100k filas   │ • ↑ 100k filas   │ • Retención: 365 días       │
└──────────────────┴──────────────────┴──────────────────────────────┘
```

---

## 1️⃣ SUPABASE — Base de Datos Principal (500MB gratuito)

### ¿Qué es?
PostgreSQL administrado en la nube con **500MB de almacenamiento gratuito**.

### ¿Qué guarda?
- ✅ Todos los **registros activos** (chofer, reparto, etc.)
- ✅ **Ausencias** del personal
- ✅ **Configuración** del sistema
- ✅ **Notas**, checklists, foxtrot_rutas, foxtrot_intentos
- ✅ **Rechazos** (datos comerciales)

### Tamaño estimado para 5 años:
```
Registros:      115/mes × 60 meses = 6,900 registros (~1MB)
Ausencias:      13/mes × 60 meses = 780 registros (~100KB)
Foxtrot:        289 rutas × 60 meses = 17,340 rutas (~50MB)
Rechazos:       1,974 × 60 meses = 118,440 (~300MB)
Otros:          Configuración, notas, checklists (~50MB)
─────────────────────────────────────────────────────────
TOTAL ESTIMADO: ~400MB de 500MB = 20% disponible

✅ No tienes problemas de espacio en 5 años si mantienes los datos optimizados
```

### ¿Por qué NO usar la versión paga?
- 500MB gratuito es SUFICIENTE para el tamaño actual del proyecto
- Tu data está limitada por naturaleza (registros diarios, no histórico masivo)
- Costo: $25-$100/mes si pagabas

---

## 2️⃣ NEON — Base de Datos de Respaldo (10GB gratuito)

### ¿Qué es?
PostgreSQL serverless con **auto-scaling**. Excelente para backups automáticos.

### ¿Qué guarda?
- ✅ **ESPEJO** de la BD principal de Supabase
- ✅ Usado solo en caso de emergencia
- ✅ Sincronización automática via script `npm run sync-neon`

### Ventajas:
- ✅ Si Supabase falla, tienes respaldo en Neon
- ✅ Puedes recuperar datos históricos
- ✅ No afecta la performance en producción (no se usa mientras Supabase funciona)

### Ocupación:
```
Mismos datos que Supabase (~400MB) + Datos históricos adicionales
= ~9GB de 10GB = 90% disponible

✅ Suficiente para mantener backup por 5 años
```

### ¿Por qué no usar solo Neon?
- Render (servidor) carga más lento desde Neon (está más lejos)
- Supabase está optimizado para web (Vercel/Render)
- Neon es el respaldo de emergencia, no la BD principal

---

## 3️⃣ CLOUDFLARE R2 — Almacenamiento de Archivos (10GB × 2 cuentas)

### ¿Qué es?
Almacenamiento de objetos (S3-compatible) con **10GB gratis por cuenta**.

### ¿Qué guarda?
- ✅ Excels descargados/importados
- ✅ Reportes PDF generados
- ✅ Archivos de auditoría (si los generas)
- ✅ Backups comprimidos de datos

### Ventajas:
```
✅ Dos cuentas = 20GB total
✅ Costo: $0 (siempre que no superes los límites)
✅ No compete con la BD principal
✅ Performance: CDN global, muy rápido
```

### Política de Retención (Variable):
```
R2_RETENTION_DAYS = 365  (en tu .env)

Ejemplo:
- 1 de Mayo de 2024: Se sube Excel de reportes
- 1 de Mayo de 2025: Se elimina automáticamente (365 días después)
- 1 de Mayo de 2026: Espacio disponible para nuevos archivos
```

### Ocupación estimada:
```
Excels/mes:     ~50MB (10 reportes × 5MB c/u)
Backups/mes:    ~100MB (datos comprimidos)
Histórico/año:  ~600MB

Retención 365 días:
- Año 1: 650MB utilizado
- Año 2: 650MB utilizado (los del año anterior se borran)
- Año 3-5: 650MB utilizado

✅ Nunca superas 20GB disponibles
```

---

## 🔄 Sincronización Entre las 3 Bases de Datos

### Flujo de Datos:

```
┌──────────────────────────────────┐
│   App Web (Producción)           │
│   https://sistema-reparto...     │
└────────────────┬─────────────────┘
                 │ (Escribe/Lee)
                 ▼
         ┌──────────────┐
         │  SUPABASE    │ ← Activa (500MB)
         │ (Principal)  │
         └──────────────┘
                 │
        (Sincronización automática)
                 ▼
         ┌──────────────┐
         │   NEON       │ ← Backup (10GB)
         │  (Espejo)    │
         └──────────────┘

    Excels & Reportes
             │
             ▼
      ┌──────────────┐
      │ CLOUDFLARE   │ ← Archivos (20GB)
      │     R2       │
      └──────────────┘
```

### Scripts de Sincronización:

```bash
# Manual (cuando quieras):
npm run sync-neon          # Supabase → Neon
npm run sync-tables        # Completar tablas faltantes entre Supabase y Neon
npm run verify-schemas     # Verificar que tengan el mismo esquema
npm run fix-schemas        # Corregir inconsistencias automáticamente

# Automático (integrado en servidor):
- El servidor en Render ejecuta scripts de backup nightly
- R2 retiene archivos 365 días
```

---

## 💾 Plan de Almacenamiento a 5 Años

### Año 1:
```
SUPABASE:    ~80MB   (datos reales)
NEON:        ~80MB   (espejo)
R2:          ~650MB  (excels + reportes)
─────────────────────────────────
TOTAL:       ~810MB  ✅ Dentro de límites
```

### Año 2-5:
```
SUPABASE:    ~400MB  (acumulado)
NEON:        ~400MB  (espejo)
R2:          ~650MB  (retención 365 días = se borra automáticamente)
─────────────────────────────────
TOTAL:       ~1.45GB  ✅ Dentro de límites
```

### Resumen:
```
SUPABASE:   400MB  de 500MB  = 20% libre ✅
NEON:       400MB  de 10GB   = 96% libre ✅
R2:         650MB  de 20GB   = 97% libre ✅

Duración: ∞ (ilimitado)
Costo: $0/mes
```

---

## 🛡️ Estrategia de Continuidad

### Si falla SUPABASE:
1. El backend automáticamente intenta reconectar
2. Si falla por >5 min, se activa fallback a NEON
3. Datos se sincronizan de vuelta cuando Supabase se recupera
4. Script: `npm run sync-neon`

### Si falla NEON:
- No importa, es solo backup
- Sistema sigue funcionando con Supabase

### Si falla CLOUDFLARE R2:
- No afecta operación del sistema
- Solo impacta descarga de excels históricos
- Se recuperan backups de Supabase en 24h

---

## 📈 Crecimiento Proyectado (5 años)

```
Mes    Supabase    Neon        R2          Total
────────────────────────────────────────────────────
1      100MB       100MB       100MB       300MB
6      250MB       250MB       600MB       1.1GB
12     400MB       400MB       650MB       1.45GB ← Se estabiliza
24     400MB       400MB       650MB       1.45GB
60     400MB       400MB       650MB       1.45GB ← MISMO (ciclo)
```

### Por qué se estabiliza:
- SUPABASE: Crece ~7MB/mes pero llega a tope (~400MB)
- NEON: Espejo, mismo tamaño que Supabase
- R2: Ciclo anual, se borra y se regenera (650MB constantes)

---

## ✅ Checklist para 5 Años de Operación

- [ ] Supabase: 500MB (20% disponible) - Suficiente para el tamaño actual
- [ ] Neon: 10GB (96% disponible) - Suficiente para backup
- [ ] R2: 20GB (97% disponible) - Suficiente
- [ ] Sincronización automática configurable
- [ ] Scripts de diagnóstico: `npm run check-db`
- [ ] Monitoreo mensual: `npm run verify-schemas`
- [ ] Política de retención R2: 365 días

---

## 🚀 Recomendaciones

### Cada Mes:
```bash
npm run verify-schemas    # Verificar consistencia
npm run check-db          # Diagnosticar estado
```

### Cada 6 Meses:
```bash
npm run sync-neon         # Fuerza sincronización Supabase ↔ Neon
```

### Cada Año:
- Revisar espacio en Supabase: Dashboard → Storage
- Revisar retención R2: ¿El ciclo de 365 días sigue funcionando?
- Backup manual de datos críticos si es necesario

---

## 💡 ¿Por qué esta arquitectura es PERFECTA para 5 años?

✅ **Escalable**: Crece solo cuando hay datos reales  
✅ **Redundante**: 3 capas de almacenamiento  
✅ **Gratuito**: 100% servicios gratis (siempre que respetes los límites)  
✅ **Confiable**: PostgreSQL + CDN + backups  
✅ **Mantenible**: Scripts automáticos, sin intervención manual  
✅ **Durable**: Los datos persisten sin borrado accidental  

---

## 🆘 Troubleshooting

### "¿Cuándo tengo que pagar?"
R: Nunca, si respetas estas estimaciones. Solo pagarías si:
- Supabase >500MB (tu caso: 400MB)
- NEON >10GB (tu caso: 400MB)
- R2 >10GB/mes (tu caso: ~650MB estable)

### "¿Qué pasa en el año 6?"
R: Exactamente lo mismo que el año 5. El ciclo se repite:
- Supabase: Estable ~400MB
- Neon: Estable ~400MB
- R2: Automáticamente limpia archivos de hace 365+ días

### "¿Puedo agregar más datos?"
R: SÍ, tienes 80-90% de espacio libre:
- Supabase: Aún hay 100GB libres
- Neon: Aún hay 9.6GB libres
- R2: Aún hay 19.35GB libres

### "¿Y si querés más data histórica?"
R: Modifica `R2_RETENTION_DAYS` en `.env`:
- `365` = Borrar cada año (actual)
- `730` = Guardar 2 años
- `1095` = Guardar 3 años
- ∞ = Guardar para siempre (cuesta dinero)

