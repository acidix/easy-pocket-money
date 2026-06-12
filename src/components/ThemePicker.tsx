import React from 'react';
import { useTheme } from '../context/ThemeContext';
import type { NeonTheme } from '../context/ThemeContext';

export const ThemePicker: React.FC = () => {
  const { theme, setTheme } = useTheme();

  const themes: { id: NeonTheme; name: string }[] = [
    { id: 'cyberpunk', name: 'Cyber' },
    { id: 'synthwave', name: 'Synth' },
    { id: 'matrix', name: 'Matrix' },
    { id: 'yellow', name: 'Volt' },
    { id: 'orange', name: 'Amber' },
    { id: 'red', name: 'Crimson' },
    { id: 'rainbow', name: 'Rainbow' }
  ];

  return (
    <div className="theme-picker" style={{ alignSelf: 'center' }}>
      {themes.map(t => (
        <button
          key={t.id}
          type="button"
          className={`theme-picker-btn ${theme === t.id ? 'active' : ''}`}
          onClick={() => setTheme(t.id)}
          title={`Farbschema: ${t.name}`}
        >
          <span className={`theme-dot ${t.id}`}></span>
          <span>{t.name}</span>
        </button>
      ))}
    </div>
  );
};
