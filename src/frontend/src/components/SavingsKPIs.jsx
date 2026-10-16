import React from 'react';
import useApi from '../hooks/useApi';
import { Skeleton, ErrorBox, Empty } from './State';
import { getSavings } from '../services/api';
import { Zap, Leaf, DollarSign, Activity } from 'lucide-react';

export default function SavingsKPIs() {
  const { data, loading, error, reload } = useApi(getSavings);

  if (loading) return <Skeleton className="h-28" />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Empty message="No savings data available yet." />;

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
            <div className={`p-3 rounded-full ${kpi.bg}`}>
              <Icon className={`w-6 h-6 ${kpi.color}`} />
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
