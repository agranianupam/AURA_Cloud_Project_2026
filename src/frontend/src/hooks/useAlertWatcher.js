import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAlerts } from '../services/api';
import useApi from './useApi';
import { readPref, writePref, useLiveInterval } from './usePrefs';
import { useToast } from '../components/Toast';

const SEEN_KEY = 'aura-alerts-seen';
const keyOf = (a) => `${a.timestamp}|${a.message}`;

// Polls alerts while live mode is on, toasts ones that appear after the first load,
// and counts those newer than the last visit to the Alerts page.
export default function useAlertWatcher(onAlertsPage) {
  const { data, error } = useApi(getAlerts, { refreshMs: useLiveInterval() });
  const toast = useToast();
  const navigate = useNavigate();
  const known = useRef(null);
  const [lastSync, setLastSync] = useState(null);
  const [seenAt, setSeenAt] = useState(() => readPref(SEEN_KEY, ''));

  useEffect(() => {
    if (!data) return;
    setLastSync(new Date());
    const view = { label: 'View alerts', onClick: () => navigate('/alerts') };
    if (known.current === null) {
      const critical = data.filter((a) => a.severity === 'critical' && a.timestamp > seenAt).length;
      if (critical && !onAlertsPage) {
        toast({
          severity: 'critical',
          title: `${critical} unread critical alert${critical > 1 ? 's' : ''}`,
          message: 'AURA flagged demand or carbon issues in the latest run.',
          action: view,
        });
      }
    } else {
      data.filter((a) => !known.current.has(keyOf(a))).slice(0, 3).forEach((a) => toast({
        severity: a.severity,
        title: a.severity === 'critical' ? 'Critical alert' : 'New alert',
        message: a.message,
        action: view,
      }));
    }
    known.current = new Set(data.map(keyOf));
  }, [data]); // only react to fresh data

  useEffect(() => {
    if (!onAlertsPage || !data?.length) return;
    const newest = data.reduce((m, a) => (a.timestamp > m ? a.timestamp : m), '');
    if (newest > seenAt) { writePref(SEEN_KEY, newest); setSeenAt(newest); }
  }, [onAlertsPage, data, seenAt]);

  const unread = data ? data.filter((a) => a.timestamp > seenAt).length : 0;
  return { unread, lastSync, error };
}
