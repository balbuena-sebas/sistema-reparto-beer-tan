import React from 'react';

export const RB = ({ r }) => {
  if (r === "Sin recarga") return <span className="bdg bg">✓ Sin Recarga</span>;
  if (r === "1 recarga") return <span className="bdg ba">⚡ 1 Recarga</span>;
  if (r === "3 recargas") return <span className="bdg br">⚡⚡ 3 Recargas</span>;
  if (r === "Falta Ayudante") return <span className="bdg bv">⚠ Falta Ay.</span>;
  return <span className="bdg bgr">{r || "—"}</span>;
};