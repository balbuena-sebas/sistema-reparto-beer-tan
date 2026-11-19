import React from 'react';
import '../styles/custom.css';

const TBiolinks = () => {
  const links = [
    {
      id: 1,
      icon: '🚚',
      title: 'CHECKLIST Diario',
      description: 'Checklist diario de actividades',
      url: 'https://forms.gle/FJmEb7dEcvTrDrga9'
    },
    {
      id: 2,
      icon: '⚠️',
      title: 'PRE-RUTA',
      description: 'Verificar carga completa antes de salir. Comentá si faltó algo y consigná con quién viajas',
      url: 'https://forms.gle/qEmBv4baZ6Va2CRu6'
    },
    {
      id: 3,
      icon: 'ℹ️',
      title: 'PROBLEMAS EN EL PUNTO DE VENTA',
      description: 'Reportar problemas en puntos de venta',
      url: 'https://docs.google.com/forms/d/e/1FAIpQLSeiwLstS12e2ujYY58sR4aF2cMYgGsFeW-wof06dQpljKdaCg/viewform'
    },
    {
      id: 4,
      icon: '📞',
      title: 'LINEA ETICA DE BEER TAN',
      description: 'Acceso a la línea ética de la empresa',
      url: 'https://beertanlineaetica.netlify.app/'
    }
  ];

  return (
    <div className="biolinks-container">
      <div className="biolinks-header">
        <h1>BeerTan SA - Enlaces Útiles</h1>
        <p>Acceso rápido a formularios y herramientas importantes</p>
      </div>
      
      <div className="biolinks-grid">
        {links.map((link) => (
          <a
            key={link.id}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="biolink-card"
          >
            <div className="biolink-icon">{link.icon}</div>
            <div className="biolink-content">
              <h3>{link.title}</h3>
              <p>{link.description}</p>
            </div>
            <div className="biolink-arrow">→</div>
          </a>
        ))}
      </div>
    </div>
  );
};

export { TBiolinks };
