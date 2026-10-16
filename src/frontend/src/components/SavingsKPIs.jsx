import React from 'react';
import useApi from '../hooks/useApi';
import { useLiveInterval } from '../hooks/usePrefs';
import { Skeleton, ErrorBox, Empty } from './State';
import { getSavings } from '../services/api';
import { Zap, Leaf, DollarSign, Activity } from 'lucide-react';

export default function SavingsKPIs() {
  const { data, loading, error, reload } = useApi(getSavings, { refreshMs: useLiveInterval() });

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}
      </div>
    );
  }
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Empty message="No savings data available yet." />;

  const kpis = [
    { title: 'Energy Saved', value: data.energySavedKwh.toLocaleString(), unit: 'kWh', icon: Zap, color: 'text-amber-500', bg: 'bg-amber-50', accent: 'from-amber-400' },
    { title: 'Carbon Offset', value: data.carbonSavedKg.toLocaleString(), unit: 'kg CO₂', icon: Leaf, color: 'text-emerald-500', bg: 'bg-emerald-50', accent: 'from-emerald-400' },
    { title: 'Cost Savings', value: '$' + data.costSaved.toLocaleString(), unit: '', icon: DollarSign, color: 'text-blue-500', bg: 'bg-blue-50', accent: 'from-blue-400' },
    { title: 'SLA Compliance', value: data.slaCompliancePct.toFixed(2), unit: '%', icon: Activity, color: 'text-purple-500', bg: 'bg-purple-50', accent: 'from-purple-400' },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {kpis.map((kpi) => {
        const Icon = kpi.icon;
        return (
          <div key={kpi.title} className="relative overflow-hidden bg-white p-5 rounded-xl shadow-sm">
            <span className={`absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r ${kpi.accent} to-transparent`} />
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500 font-medium">{kpi.title}</p>
              <div className={`p-2 rounded-lg ${kpi.bg}`}>
                <Icon className={`w-4 h-4 ${kpi.color}`} />
              </div>
            </div>
            <p className="mt-3 text-2xl lg:text-[1.65rem] font-bold text-gray-900 tracking-tight tabular-nums">
              {kpi.value}
              {kpi.unit && <span className="ml-1 text-sm font-medium text-gray-500">{kpi.unit}</span>}
            </p>
          </div>
        );
      })}
    </div>
  );
}
