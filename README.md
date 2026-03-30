# 🚛 Sistema de Reparto - Beer Tan Sa

Plataforma integral de gestión operativa para distribución y logística de **Beer Tan Sa**. Diseñada para optimizar rutas, monitorear entregas, gestionar personal y generar reportes analíticos en tiempo real.

## 📋 Características

✅ **Dashboard Operativo** — KPIs, entregas, rechazos, costos en tiempo real  
✅ **Gestión de Rutas** — Asignación de drivers, mapeo de entregas  
✅ **Seguimiento de Personal** — Ausencias, disponibilidad, permisos  
✅ **Análisis Financiero** — Costos por chofer, comisiones, margen  
✅ **Reportes Avanzados** — Exportación a Excel, filtrado por período  
✅ **Control de Rechazos** — Motivos, estadísticas, historial  
✅ **Seguridad Enterprise** — Permisos por rol, auditoría de sesiones, acceso DNI-based

---

## 🔧 Requisitos

- **Node.js** ≥ 16.0.0
- **npm** ≥ 8.0.0
- **Backend API** ejecutándose en `http://localhost:3001` (o configurable vía `.env`)
- **Base de datos Neon PostgreSQL** (almacenamiento en nube, retención 5 años)

---

## 📥 Instalación Local

### 1. Clonar y acceder al proyecto

```bash
cd frontend
npm install
```

### 2. Configurar variables de entorno

Crear archivo `.env` en la raíz del proyecto:

```env
REACT_APP_API_URL=http://localhost:3001
REACT_APP_API_KEY=tu-api-key-aqui
```

> ⚠️ **Importante:** Nunca commitear `.env` con valores reales. Archivo protegido en `.gitignore`.

### 3. Iniciar desarrollo

```bash
npm start
```

Abre [http://localhost:3000](http://localhost:3000) en tu navegador.

---

## 📊 Datos de Acceso

### Usuario Administrador

- **Nombre:** Administrador
- **DNI:** `admin`
- **Rol:** Admin (acceso completo a usuarios, mapeo driver, configuración)

> 🔐 Cambiar credenciales en **Configuración** después del primer login.

### Usuarios Por Defecto

Los usuarios se cargan desde la base de datos. Para agregar más usuarios:

1. Ir a **Configuración** → **Gestión de Usuarios**
2. Completar nombre y DNI
3. Asignar permisos según rol

---

## 🚀 Deployment

### Build de Producción

```bash
npm run build
```

Genera carpeta `build/` lista para deploy.

---

## 🔐 Seguridad

✅ **Detección de login múltiple**  
✅ **Protección de credenciales (Admin-only)**  
✅ **API Key protegida (.env in .gitignore)**  
✅ **Sesiones basadas en tokens**  
✅ **Permisos granulares por rol**

---

## 📁 Estructura del Proyecto

```
frontend/
├── public/           # Activos estáticos
├── src/
│   ├── components/   # Páginas y vistas
│   ├── constants/    # Datos iniciales
│   ├── api/          # Cliente HTTP
│   ├── utils/        # Funciones auxiliares
│   └── styles/       # Estilos globales
└── package.json
```

---

**Versión:** 3.0 | **Estado:** Production-Ready
