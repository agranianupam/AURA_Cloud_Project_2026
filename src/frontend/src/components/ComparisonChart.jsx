import React, { useEffect, useState } from 'react';
import { getEnergyMetrics } from '../services/api';
import { ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export default function ComparisonChart() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [viewMode, setViewMode] = useState('energy');

  useEffect(() => { fetchData(); }, []);
  const fetchData = async () => {
    setLoading(true);
    const res = await getEnergyMetrics();
    if (res.error) setError(res.error); else setData(res.data);
    setLoading(false);
  };

  if (loading) return <div className="h-96 animate-pulse bg-gray-200 rounded-lg"></div>;
  if (error) return <div className="text-red-500 p-4">Error: {error}</div>;

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
          <button onClick={() => setViewMode('energy')} className={\px-3 py-1 text-sm rounded-full \\}>Energy (kWh)</button>
          <button onClick={() => setViewMode('carbon')} className={\px-3 py-1 text-sm rounded-full \\}>Carbon (gCO2)</button>
        </div>
      </div>
      
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={formattedData}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
            <XAxis dataKey="time" tick={{ fontSize: 12, fill: '#6B7280' }} minTickGap={30} />
            <YAxis yAxisId="left" tick={{ fontSize: 12, fill: '#6B7280' }} label={{ value: isEnergy ? 'Energy (kWh)' : 'Emissions (gCO2)', angle: -90, position: 'insideLeft', fill: '#6B7280', dy: 40 }} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12, fill: '#10B981' }} label={{ value: 'Grid Carbon Intensity', angle: 90, position: 'insideRight', fill: '#10B981', dy: -40 }} />
            <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
            <Legend verticalAlign="top" height={36}/>
            <Area yAxisId="right" type="step" dataKey="carbonIntensity" fill="#D1FAE5" stroke="#10B981" fillOpacity={0.2} name="Grid CI (gCO2/kWh)" />
            <Line yAxisId="left" type="monotone" dataKey={isEnergy ? 'baselineEnergyKwh' : 'baselineCarbonGco2'} name="Baseline" stroke="#9CA3AF" strokeWidth={2} strokeDasharray="5 5" dot={false} />
            <Line yAxisId="left" type="monotone" dataKey={isEnergy ? 'energyKwh' : 'carbonGco2'} name="AURA Optimization" stroke="#4F46E5" strokeWidth={3} dot={false} activeDot={{ r: 6 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
