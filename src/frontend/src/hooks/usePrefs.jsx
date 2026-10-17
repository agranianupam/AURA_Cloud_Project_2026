import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

const PrefsContext = createContext(null);

export const LIVE_INTERVAL_MS = 30000;
export const REFRESH_EVENT = 'aura:refresh';

export const readPref = (key, fallback) => {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
};
export const writePref = (key, value) => {
  try { localStorage.setItem(key, value); } catch {  }
};

export function PrefsProvider({ children }) {
  const [theme, setTheme] = useState(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'));
  const [live, setLive] = useState(() => readPref('aura-live', 'on') === 'on');

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    writePref('aura-theme', theme);
  }, [theme]);

  useEffect(() => { writePref('aura-live', live ? 'on' : 'off'); }, [live]);

  const toggleTheme = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);
  const toggleLive = useCallback(() => setLive((l) => !l), []);
  const refreshAll = useCallback(() => window.dispatchEvent(new Event(REFRESH_EVENT)), []);

  return (
    <PrefsContext.Provider value={{ theme, toggleTheme, live, toggleLive, refreshAll }}>
      {children}
    </PrefsContext.Provider>
  );
}

export const usePrefs = () => useContext(PrefsContext);

export const useLiveInterval = () => (usePrefs()?.live ? LIVE_INTERVAL_MS : 0);

