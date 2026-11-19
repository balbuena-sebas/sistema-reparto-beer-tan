import React from 'react';
import { MESES } from '../constants';

export const MS = ({ v, onChange }) => {
  const opts = [];
  const now = new Date();
  for (let i = 0; i < 8; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    opts.push({ val, label: `${MESES[d.getMonth()]} ${d.getFullYear()}` });
  }
  return (
    <select className="fc" style={{ width: "auto", minWidth: 150 }} value={v} onChange={(e) => onChange(e.target.value)}>
      {opts.map((o) => (
        <option key={o.val} value={o.val}>{o.label}</option>
      ))}
    </select>
  );
};