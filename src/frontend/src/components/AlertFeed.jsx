import React from 'react';
import useApi from '../hooks/useApi';
import { useLiveInterval } from '../hooks/usePrefs';
import { Skeleton, ErrorBox, Empty } from './State';
import { getAlerts } from '../services/api';
import { ServerCrash, CloudLightning, TrendingUp } from 'lucide-react';

const SEVERITY = {
  critical: 'bg-red-100 text-red-700',
  warning: 'bg-yellow-100 text-yellow-800',
  info: 'bg-blue-100 text-blue-700',
};
const TYPE_ICON = { carbon: CloudLightning, forecast: TrendingUp };

export default function AlertFeed() {
  const { data, loading, error, reload } = useApi(getAlerts, { refreshMs: useLiveInterval() });

  if (loading) return <Skeleton className="h-64" />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data?.length) return <Empty message="No alerts yet." />;

  const critical = data.filter((a) => a.severity === 'critical').length;

  return (
    <div className="bg-white rounded-xl shadow-sm p-4 h-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-800">System Alerts</h3>
        <span className="text-xs text-gray-500">
          {data.length} total{critical > 0 && <> · <span className="font-semibold text-red-600">{critical} critical</span></>}
        </span>
      </div>
      <div className="space-y-2 overflow-y-auto pr-1" style={{ maxHeight: '320px' }}>
        {data.map((alert, idx) => {
          const Icon = TYPE_ICON[alert.type] || ServerCrash;
          const bc = SEVERITY[alert.severity] || SEVERITY.info;
          return (
            <div key={`${alert.timestamp}-${idx}`} className="flex gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors">
              <div className={`h-fit p-2 rounded-lg ${bc}`}><Icon className="w-4 h-4" /></div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className={`text-[10px] uppercase tracking-wide font-bold px-2 py-0.5 rounded-full ${bc}`}>{alert.severity}</span>
                  <span className="text-xs text-gray-400">{new Date(alert.timestamp).toLocaleString()}</span>
                </div>
                <p className="text-sm text-gray-700 break-words">{alert.message}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

