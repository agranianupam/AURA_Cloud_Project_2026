import { useCallback, useEffect, useState } from 'react';
import { REFRESH_EVENT } from './usePrefs';

export default function useApi(fn, { refreshMs = 0 } = {}) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fn().then((res) => {
      if (cancelled) return;

      setState((s) => (res.error && s.data ? { ...s, loading: false } : { data: res.data, loading: false, error: res.error }));
    });
    return () => { cancelled = true; };
  }, [fn, tick]);

  useEffect(() => {
    const silent = () => setTick((t) => t + 1);
    window.addEventListener(REFRESH_EVENT, silent);
    const id = refreshMs > 0 ? setInterval(silent, refreshMs) : null;
    return () => {
      window.removeEventListener(REFRESH_EVENT, silent);
      if (id) clearInterval(id);
    };
  }, [refreshMs]);

  const reload = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    setTick((t) => t + 1);
  }, []);

  return { ...state, reload };
}

