import { useCallback, useEffect, useState } from 'react';

// Runs an api.js call on mount and exposes loading/error/reload.
export default function useApi(fn) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fn().then((res) => {
      if (!cancelled) setState({ data: res.data, loading: false, error: res.error });
    });
    return () => { cancelled = true; };
  }, [fn, tick]);

  const reload = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    setTick((t) => t + 1);
  }, []);

  return { ...state, reload };
}
