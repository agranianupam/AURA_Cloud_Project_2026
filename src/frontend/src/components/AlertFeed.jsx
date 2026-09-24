import React, { useEffect, useState } from 'react';
import { getAlerts } from '../services/api';
import { ServerCrash, CloudLightning } from 'lucide-react';

export default function AlertFeed() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => { fetchData(); }, []);
  const fetchData = async () => {
    setLoading(true);
    const res = await getAlerts();
    if (res.error) setError(res.error); else setData(res.data);
    setLoading(false);
  };

  if (loading) return <div className="h-64 animate-pulse bg-gray-200 rounded-lg"></div>;
  if (error) return <div className="text-red-500">Error: {error}</div>;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 h-full">
      <h3 className="font-semibold text-gray-800 mb-4">System Alerts</h3>
      <div className="space-y-4 overflow-y-auto pr-2" style={{ maxHeight: '300px' }}>
        {data.map((alert, idx) => {
          const isCarbon = alert.type === 'carbon';
          const Icon = isCarbon ? CloudLightning : ServerCrash;
          let bc;
          if (alert.severity === 'critical') bc = 'bg-red-100 text-red-700';
          else if (alert.severity === 'warning') bc = 'bg-yellow-100 text-yellow-700';
          else bc = 'bg-blue-100 text-blue-700';

          return (
            <div key={idx} className="flex gap-4 p-3 rounded-lg border border-gray-50 bg-gray-50">
              <div className={\mt-0.5 p-2 rounded-full \\}><Icon className="w-5 h-5" /></div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className={\	ext-[10px] uppercase font-bold px-2 py-0.5 rounded-full \\}>{alert.severity}</span>
                  <span className="text-xs text-gray-400">{new Date(alert.timestamp).toLocaleString()}</span>
                </div>
                <p className="text-sm text-gray-700">{alert.message}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
