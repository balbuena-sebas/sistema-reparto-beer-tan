import React from 'react';
import { ac, ini } from '../constants';

export const Av = ({ name, size = "md" }) => (
  <div className={`av av-${size}`} style={{ background: ac(name) }}>
    {ini(name)}
  </div>
);