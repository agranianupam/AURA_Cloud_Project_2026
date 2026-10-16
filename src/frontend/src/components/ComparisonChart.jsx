import React, { useState } from 'react';
import useApi from '../hooks/useApi';
import { Skeleton, ErrorBox, Empty } from './State';
import { getEnergyMetrics } from '../services/api';
import { ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export default function ComparisonChart() {
  const { data, loading, error, reload } = useApi(getEnergyMetrics);
  const [viewMode, setViewMode] = useState('energy');

  if (loading) return <Skeleton className="h-96" />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data?.length) return <Empty message="No energy metrics available yet." />;

  const formattedData = data.map(d => ({ ...d, time: new Date(d.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }));
  const isEnergy = viewMode === 'energy';

  return (
    <div className="bg-white p-4 rounded-xl shadow-sm h-full w-full col-span-1 lg:col-span-2">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-800">AURA Optimization vs Baseline</h3>
          <p className="text-xs text-gray-500">Estimates based on machine learning forecasting (Not measured values).</p>
        </div>
        <div className="mt-2 sm:mt-0 flex gap-2">
          <button onClick={() => setViewMode('energy')} className={`px-3 py-1 text-sm rounded-full ${isEnergy ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}>Energy (kWh)</button>
          <button onClick={() => setViewMode('carbon')} className={`px-3 py-1 text-sm rounded-full ${!isEnergy ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}>Carbon (gCO2)</button>
        </div>
      </div>
      
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={formattedData}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
            <XAxis dataKey="time" tick={{ fontSize: 12, fill: '#6B7280' }} minTickGap={30} />
            <YAxis yAxisId="left" tick={{ fontSize: 12, fill: '#6B7280' }} width={48} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12, fill: '#10B981' }} width={40} />
            <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
            <Legend verticalAlign="top" height={36}/>
            <Area yAxisId="right" type="step" dataKey="carbonIntensity" fill="#D1FAE5" stroke="#10B981" fillOpacity={0.2} name="Grid CI (gCO2/kWh)" />
            <Line yAxisId="left" type="monotone" dataKey={isEnergy ? 'baselineEnergyKwh' : 'baselineCarbonGco2'} name={isEnergy ? "Baseline (kWh)" : "Baseline (gCO2)"} stroke="#9CA3AF" strokeWidth={2} strokeDasharray="5 5" dot={false} />
            <Line yAxisId="left" type="monotone" dataKey={isEnergy ? 'energyKwh' : 'carbonGco2'} name={isEnergy ? "AURA (kWh)" : "AURA (gCO2)"} stroke="#4F46E5" strokeWidth={3} dot={false} activeDot={{ r: 6 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
