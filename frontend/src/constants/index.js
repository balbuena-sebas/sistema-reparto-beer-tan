// src/constants/index.js

export const DC = {
  empresa: "Empresa de Transportes",
  choferes: [
    "Romero Diego", "Rodriguez Nicolas", "Rodriguez Martin",
    "Nuñez Gaston", "Quiroga Luciano", "Acosta Roberto",
    "Perez Fabian", "Dealviso Guillermo", "Suarez Jorge"
  ],
  ayudantes: [
    "Ferreyra Sergio", "Guillermo Martin", "Di Paolo Ezequiel",
    "Rodriguez Alejandro", "Frutos Miguel", "Salinas Valentino",
    "Lucas", "Perez Fabian", "Dealviso Guillermo", "Suarez Jorge",
    "Rodriguez Nicolas", "Quiroga Luciano"
  ],
  patentes: [
    "AE 338 DR","JBQ 192","PAU 314","GIA 123","AF 577 SM",
    "NDS 242","PAU 320","AE 739 QQ","GJG 351","KXZ 706"
  ],
  localidades: [
    "VELA-BARKER (Tandil)","SAN MANUEL (Tandil)","GARDEY (Tandil)",
    "BENITO JUAREZ (Tandil)","TANDIL (Tandil)","AYACUCHO (Las Flores)",
    "LAS FLORES (Las Flores)","RAUCH (Las Flores)","CACHARI (Las Flores)",
    "JUAN N FERNANDEZ (Tandil)"
  ],
  destinos: [
    "INC DEL VALLE","VEA","PANAMA","COOPERATIVA JUAREZ","DIARCO S.A",
    "CAMION SERRANO","CAMION SAN MARTIN","COLON VIRTUAL","INC 9 DE JULIO",
    "COOPERATIVA TANDIL","COLON","SERRANO","SAN MARTIN","PERON"
  ],
  motivosAusencia: [
    "Sin Reparto","Vacaciones","Licencia","Día Libre",
    "Enfermedad","Accidente","Permiso"
  ],
  usuarios:         [
    { 
      nombre: 'Administrador', 
      dni: 'admin', 
      role: 'admin',
      permisos: {
        dashboard: true, registros: true, ausencias: true, personal: true, costos: true,
        reportes: true, rechazos: true, foxtrot: true, importar: true, config: true, notas: true,
      }
    }
  ],
  costoChofer:      115130,
  costoAyudante:    96870,
  objTandil:        18000,
  objFlores:        8000,
  param1:           450,
  param2:           700,
  param3:           900,
  alertaRecargas:   5,
  // ── Campos nuevos — vacíos aquí, el backend los pisa con los datos reales ──
  driverMap:        [],
  diasNoTrabajados: [],
  personasNotas:    [],  // lista separada para el tablero de notas
  paramXMes:        {},  // { 'YYYY-MM': { objTandil, objFlores, costoChofer, costoAyudante, alertaRecargas } }
};

export const MESES = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"
];

export const AVC = [
  "#e8b84b","#00d4ff","#7fff47","#ff4757","#a78bfa","#38bdf8",
  "#f97316","#ec4899","#14b8a6","#fbbf24","#6366f1","#ef4444","#22c55e"
];

export const ac = (n) => {
  let h = 0;
  for (const c of n || "X") h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return AVC[h % AVC.length];
};

export const ini = (n) =>
  (n || "?").split(" ").map(w => w[0]).slice(0,2).join("").toUpperCase();