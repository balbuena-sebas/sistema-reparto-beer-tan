import React from 'react';

export const MB = ({ m }) => {
  const mp = {
    "Sin Reparto": "ba",
    Vacaciones: "bb",
    Licencia: "br",
    "Día Libre": "bgd",
    Enfermedad: "bv",
    Accidente: "br",
    Permiso: "bc"
  };
  return <span className={`bdg ${mp[m] || "bgr"}`}>{m}</span>;
};