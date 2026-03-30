# 🚛 Guía completa de deploy — Sistema de Reparto
## Neon (DB) + Render (Backend) + Vercel (Frontend)

---

## PASO 0 — Instalar el backend localmente

Antes de subir nada a internet, instalá y probá el backend en tu computadora.

### 0.1 — Copiar los archivos del backend

Abrí el Explorador de Windows y creá esta estructura dentro de tu proyecto:

```
mi-app-reparto/
├── frontend/        ← ya existe
└── backend/         ← CARPETA NUEVA — copiá acá todos los archivos del backend
    ├── routes/
    │   ├── registros.js
    │   ├── ausencias.js
    │   └── config.js
    ├── server.js
    ├── db.js
    ├── compress.js
    ├── package.json
    ├── .gitignore
    └── .env.example
```

### 0.2 — Instalar las dependencias

Abrí la terminal de VS Code (`Ctrl + J`) y ejecutá:

```bash
cd backend
npm install
```

Vas a ver que se descarga un montón de cosas. Cuando termine, aparece el prompt de nuevo. Eso es normal.

### 0.3 — Crear el archivo de variables de entorno

En la carpeta `backend/`, copiá el archivo `.env.example` y renombralo a `.env`:

```bash
# En Windows (desde la terminal de VS Code):
copy .env.example .env
```

**Importante**: el archivo `.env` tiene las contraseñas — nunca lo subas a GitHub. Ya está en el `.gitignore` así que no pasa nada, pero tené cuidado.

---

## PASO 1 — Crear la base de datos en Neon

### 1.1 — Registrarse en Neon

1. Abrí https://neon.tech en el browser
2. Hacé click en **"Sign up"**
3. Elegí **"Continue with GitHub"** (lo más rápido)
4. Autorizá la conexión con tu cuenta de GitHub

### 1.2 — Crear el proyecto

1. Una vez dentro del dashboard, hacé click en **"New Project"**
2. Completá así:
   - **Project name**: `reparto-db`
   - **Postgres version**: dejá la que viene por defecto (16)
   - **Region**: `US East (Ohio)` — es la más estable para Argentina
   - **Compute size**: dejá el default (0.25 vCPU)
3. Hacé click en **"Create Project"**
4. Neon crea la base de datos en ~10 segundos

### 1.3 — Obtener la Connection String

1. Apenas se crea el proyecto, aparece un popup con las credenciales
2. Buscá la sección **"Connection string"**
3. Asegurate que esté seleccionado **"Pooled connection"** (más eficiente para apps)
4. Hacé click en el botón de copiar 📋
5. La string tiene este formato:
   ```
   postgresql://usuario:password@ep-quiet-leaf-123456.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
6. **Guardala en un lugar seguro** — la necesitás en el paso siguiente

> Si cerrás el popup sin copiarla: en el dashboard de Neon → tu proyecto → **"Connection Details"** → **"Connection string"**

### 1.4 — Configurar el .env local

Abrí el archivo `backend/.env` que creaste antes y completalo:

```env
DATABASE_URL=postgresql://usuario:password@ep-xxxxx.us-east-2.aws.neon.tech/neondb?sslmode=require
API_SECRET_KEY=MiClaveSecreta2025RepArto!
PORT=3001
FRONTEND_URL=http://localhost:3000
```

- Reemplazá `DATABASE_URL` con la string que copiaste de Neon
- Inventá una clave para `API_SECRET_KEY` (usá letras, números y símbolos, mínimo 20 caracteres)
- **Guardá el archivo**

### 1.5 — Probar la conexión a Neon

Con el .env completo, probá que todo funciona:

```bash
# Asegurate de estar en la carpeta backend/
cd backend
npm start
```

Deberías ver en la terminal:
```
✅ Base de datos inicializada correctamente
🚛 API corriendo en http://localhost:3001
```

Si aparece ese mensaje, Neon está conectado y las tablas se crearon automáticamente. ✅

Para verificarlo, abrí en el browser: http://localhost:3001/health
Deberías ver: `{"ok":true,"status":"online"}`

Detené el servidor con `Ctrl + C`.

---

## PASO 2 — Subir el backend a GitHub

1. Abrí una terminal **dentro de la carpeta `backend/`**:

```bash
cd backend
git init
git add .
git commit -m "Backend inicial sistema de reparto"
```

2. Entrá a https://github.com/new
3. Configurá el repositorio:
   - **Repository name**: `reparto-backend`
   - **Visibility**: **Private** ← importante, tiene código con rutas sensibles
   - NO marques ninguna casilla de "Initialize this repository"
4. Hacé click en **"Create repository"**

5. GitHub te va a mostrar unos comandos. Copiá y pegá estos en la terminal:

```bash
git remote add origin https://github.com/TU_USUARIO/reparto-backend.git
git branch -M main
git push -u origin main
```

(Reemplazá `TU_USUARIO` con tu usuario de GitHub)

---

## PASO 3 — Crear el servicio en Render

1. Entrá a https://render.com
2. Hacé click en **"Get Started for Free"**
3. Registrate con tu cuenta de GitHub
4. En el dashboard, hacé click en **"New +"** → **"Web Service"**
5. Hacé click en **"Connect account"** para conectar GitHub → autorizá Render
6. Buscá y seleccioná el repositorio `reparto-backend`
7. Hacé click en **"Connect"**

### Configurar el servicio:

| Campo | Valor |
|---|---|
| **Name** | `reparto-api` |
| **Region** | Oregon (US West) |
| **Branch** | `main` |
| **Runtime** | `Node` |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |
| **Instance Type** | `Free` |

### Agregar variables de entorno:

Bajá hasta la sección **"Environment Variables"** y hacé click en **"Add Environment Variable"** para cada una:

| Key | Value |
|---|---|
| `DATABASE_URL` | La connection string de Neon (Paso 1.3) |
| `API_SECRET_KEY` | La misma clave que pusiste en el `.env` local |
| `FRONTEND_URL` | `http://localhost:3000` (lo actualizás después) |
| `NODE_ENV` | `production` |

Hacé click en **"Create Web Service"** y esperá 3-5 minutos.

### ✅ Verificar que funciona:

Copiá la URL que te da Render (algo como `https://reparto-api.onrender.com`) y abrila en el browser agregando `/health`:

```
https://reparto-api.onrender.com/health
```

Deberías ver: `{"ok":true,"status":"online"}` ✅

---

## PASO 4 — Configurar el frontend para el backend

### 4.1 — Copiar los archivos nuevos del frontend

1. En tu proyecto, creá la carpeta `frontend/src/api/`
2. Copiá el archivo `frontend-client/client.js` adentro → queda en `frontend/src/api/client.js`
3. Reemplazá `frontend/src/App.js` con el archivo `frontend-client/App.js`

### 4.2 — Crear el .env del frontend

En la carpeta `frontend/`, creá un archivo llamado `.env`:

```bash
# Desde la terminal, estando en la raíz del proyecto:
cd frontend
```

Creá el archivo `.env` con este contenido (usá el Bloc de notas o VS Code):

```env
REACT_APP_API_URL=https://reparto-api.onrender.com
REACT_APP_API_KEY=MiClaveSecreta2025RepArto!
```

⚠️ Reemplazá la URL con la de tu servicio en Render, y la clave con la misma que usaste antes.

### 4.3 — Probar localmente con el backend en Render

```bash
cd frontend
npm start
```

La app debería abrirse en el browser, conectarse a Render, y mostrar el dashboard vacío (normal, todavía no hay datos).

---

## PASO 5 — Subir el frontend a Vercel

### 5.1 — Subir a GitHub

```bash
cd frontend

# Si ya tenés git inicializado, solo hacé:
git add .
git commit -m "Conectar frontend al backend"
git push

# Si no tenés git en el frontend:
git init
git add .
git commit -m "Frontend sistema de reparto con backend"
```

En GitHub creá un nuevo repo llamado `reparto-frontend` (puede ser público o privado) y seguí los comandos que te muestra.

### 5.2 — Deploy en Vercel

1. Entrá a https://vercel.com → **"Sign Up"** con GitHub
2. Hacé click en **"Add New..."** → **"Project"**
3. Importá el repositorio `reparto-frontend`
4. Vercel detecta automáticamente que es React
5. Antes de hacer deploy, bajá hasta **"Environment Variables"** y agregá:

| Name | Value |
|---|---|
| `REACT_APP_API_URL` | `https://reparto-api.onrender.com` |
| `REACT_APP_API_KEY` | Tu clave secreta |

6. Hacé click en **"Deploy"** y esperá 2-3 minutos
7. Vercel te da una URL como `https://reparto-frontend.vercel.app` — **copiala**

---

## PASO 6 — Conectar todo (CORS final)

1. Volvé a https://render.com → Dashboard → `reparto-api`
2. Hacé click en **"Environment"** (menú izquierdo)
3. Buscá la variable `FRONTEND_URL` y editala con la URL de Vercel:
   ```
   https://reparto-frontend.vercel.app
   ```
4. Hacé click en **"Save Changes"**
5. Render reinicia el servicio automáticamente (1-2 minutos)

---

## ✅ Verificación final

Abrí tu app en la URL de Vercel y verificá:

- [ ] Se carga el dashboard sin error de conexión
- [ ] Podés crear un registro de reparto (Registros → + Nuevo)
- [ ] Podés crear una ausencia
- [ ] Podés guardar la configuración (Config → Guardar Cambios)
- [ ] Los datos persisten si recargás la página

---

## 🔧 Problemas comunes

**"No se pudo conectar al servidor"**
→ Verificá que `REACT_APP_API_URL` no tenga barra al final
→ Verificá que `REACT_APP_API_KEY` sea exactamente igual en frontend y Render
→ Esperá 30 segundos y volvé a intentar (Render duerme en el plan free)

**"✅ Base de datos inicializada" no aparece al iniciar**
→ Verificá que `DATABASE_URL` en el `.env` sea la string completa de Neon con `?sslmode=require`
→ Abrí el dashboard de Neon y verificá que el proyecto esté activo (no suspendido)

**El servidor en Render tarda 30-60 segundos en responder la primera vez**
→ Normal en el plan gratuito. El servidor "duerme" si no recibe requests por 15 minutos.
→ La primera request del día despierta el servidor. Las siguientes son instantáneas.

**"CORS: origen no permitido"**
→ Verificá que `FRONTEND_URL` en Render sea exactamente la URL de Vercel (sin barra final)
→ Ejemplo correcto: `https://reparto-frontend.vercel.app`
→ Ejemplo incorrecto: `https://reparto-frontend.vercel.app/`

**npm install falla con errores**
→ Verificá que tenés Node.js 18 o mayor: `node --version`
→ Si tenés una versión vieja, descargá Node desde https://nodejs.org (botón LTS)

---

## 📁 Estructura final del proyecto

```
mi-app-reparto/
│
├── frontend/                    ← React app (ya existía)
│   ├── src/
│   │   ├── api/
│   │   │   └── client.js        ← NUEVO
│   │   ├── App.js               ← REEMPLAZADO
│   │   └── components/          ← Sin cambios
│   ├── .env                     ← NUEVO (no subir a GitHub)
│   └── public/
│       └── index.html           ← Sin cambios
│
└── backend/                     ← NUEVO — API Node.js
    ├── routes/
    │   ├── registros.js
    │   ├── ausencias.js
    │   └── config.js
    ├── server.js
    ├── db.js
    ├── compress.js
    ├── package.json
    ├── .gitignore
    └── .env                     ← NUNCA subir a GitHub
```
