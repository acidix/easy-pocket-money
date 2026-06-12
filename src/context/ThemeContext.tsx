/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { pocketMoneyService } from '../services/pocketMoneyService';

export type NeonTheme = 'cyberpunk' | 'synthwave' | 'matrix' | 'yellow' | 'red' | 'rainbow' | 'orange';

interface ThemeContextType {
  theme: NeonTheme;
  setTheme: (theme: NeonTheme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();

  const [theme, setThemeState] = useState<NeonTheme>(() => {
    const saved = localStorage.getItem('pocket-money-theme') as NeonTheme;
    if (saved && ['cyberpunk', 'synthwave', 'matrix', 'yellow', 'red', 'rainbow', 'orange'].includes(saved)) {
      return saved;
    }
    return 'cyberpunk';
  });

  const setTheme = (newTheme: NeonTheme) => {
    setThemeState(newTheme);
    localStorage.setItem('pocket-money-theme', newTheme);
    if (user) {
      pocketMoneyService.updateUserProfile(user.uid, { theme: newTheme }).catch(err => {
        console.error('Error saving user theme:', err);
      });
    }
  };

  // Sync with user profile on login or updates
  useEffect(() => {
    if (user) {
      if (user.theme && ['cyberpunk', 'synthwave', 'matrix', 'yellow', 'red', 'rainbow', 'orange'].includes(user.theme) && user.theme !== theme) {
        const targetTheme = user.theme as NeonTheme;
        // Defer updating theme state to prevent synchronous cascading renders during effect execution
        setTimeout(() => {
          setThemeState(targetTheme);
        }, 0);
      } else if (!user.theme) {
        // Auto-save the current active theme to user profile if none exists
        pocketMoneyService.updateUserProfile(user.uid, { theme }).catch(err => {
          console.error('Error auto-setting user theme:', err);
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Update HTML classes & colorScheme meta
  useEffect(() => {
    // Remove all existing theme classes
    const classes = ['theme-cyberpunk', 'theme-synthwave', 'theme-matrix', 'theme-yellow', 'theme-red', 'theme-rainbow', 'theme-orange', 'theme-frost', 'theme-light'];
    classes.forEach(cls => document.documentElement.classList.remove(cls));

    // Add current theme class
    document.documentElement.classList.add(`theme-${theme}`);
    
    // All neon themes are dark mode themes
    document.documentElement.style.colorScheme = 'dark';
    
    // Dispatch custom event to let components know the theme changed
    window.dispatchEvent(new Event('themechange'));
  }, [theme]);

  // System-level dark/light mode sync fallback (for non-authenticated pages)
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemChange = (e: MediaQueryListEvent) => {
      const hasSaved = localStorage.getItem('pocket-money-theme');
      if (!hasSaved && !user) {
        setTheme(e.matches ? 'cyberpunk' : 'yellow');
      }
    };
    mediaQuery.addEventListener('change', handleSystemChange);
    return () => mediaQuery.removeEventListener('change', handleSystemChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
