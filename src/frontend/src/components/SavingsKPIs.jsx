import React, { useEffect, useState } from 'react';
import { getSavings } from '../services/api';
import { Zap, Leaf, DollarSign, Activity } from 'lucide-react';

export default function SavingsKPIs() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => { fetchData(); }, []);
  const fetchData = async () => {
    setLoading(true);
    const res = await getSavings();
    if (res.error) setError(res.error); else setData(res.data);
    setLoading(false);
  };

  if (loading) return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {[1,2,3,4].map(i => <div key={i} className="h-28 bg-gray-200 animate-pulse rounded-xl"></div>)}
    </div>
  );
  if (error) return <div className="text-red-500">Error loading KPIs <button onClick={fetchData}>Retry</button></div>;

  const kpis = [
    { title: 'Energy Saved', value: data.energySavedKwh.toLocaleString() + ' kWh', icon: Zap, color: 'text-yellow-500', bg: 'bg-yellow-50' },
    { title: 'Carbon Offset', value: data.carbonSavedKg.toLocaleString() + ' kg', icon: Leaf, color: 'text-green-500', bg: 'bg-green-50' },
    { title: 'Cost Savings', value: '$' + data.costSaved.toLocaleString(), icon: DollarSign, color: 'text-blue-500', bg: 'bg-blue-50' },
    { title: 'SLA Compliance', value: data.slaCompliancePct.toFixed(2) + '%', icon: Activity, color: 'text-purple-500', bg: 'bg-purple-50' },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {kpis.map((kpi, idx) => {
        const Icon = kpi.icon;
        return (
          <div key={idx} className="bg-white p-5 rounded-xl shadow-sm flex items-center space-x-4 border border-gray-100">
            <div className={p-3 rounded-full \}>
              <Icon className={w-6 h-6 \} />
            </div>
            <div>
              <p className="text-sm text-gray-500 font-medium">{kpi.title}</p>
              <p className="text-2xl font-bold text-gray-900">{kpi.value}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
