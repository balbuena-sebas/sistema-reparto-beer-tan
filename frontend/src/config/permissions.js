// config/permissions.js — Constantes y lógica de permisos centralizada

export const PERMISOS_DEFAULTS = {
  admin: {
    dashboard: true,
    registros: true,
    ausencias: true,
    personal: true,
    costos: true,
    reportes: true,
    rechazos: true,
    foxtrot: true,
    importar: true,
    config: true,
    notas: true,
    biolinks: true,
    editar_contenido: false, // Admin debe aprobar explícitamente para crear/subir contenido
  },
  chofer: {
    dashboard: true,
    registros: true,
    ausencias: true,
    personal: false,
    costos: false,
    reportes: false,
    rechazos: false,
    foxtrot: false,
    importar: false,
    config: false,
    notas: true,
    biolinks: true,
    editar_contenido: false,
  },
  ayudante: {
    dashboard: true,
    registros: true,
    ausencias: true,
    personal: false,
    costos: false,
    reportes: false,
    rechazos: false,
    foxtrot: false,
    importar: false,
    config: false,
    notas: true,
    biolinks: true,
    editar_contenido: false,
  },
};

// Normalizar nombre de usuario: sin acentos, alfanuméricos, trim, uppercase
export const normalizarUsuario = (s) => {
  if (!s) return '';
  return String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
};
