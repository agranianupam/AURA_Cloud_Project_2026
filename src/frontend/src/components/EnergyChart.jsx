import React from 'react';
import useApi from '../hooks/useApi';
import { Skeleton, ErrorBox, Empty } from './State';
import { getEnergyMetrics } from '../services/api';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function EnergyChart() {
  const { data, loading, error, reload } = useApi(getEnergyMetrics);

  if (loading) return <Skeleton className="h-72" />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data?.length) return <Empty message="No energy metrics available yet." />;

  const formattedData = data.map(d => ({ ...d, time: new Date(d.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }));

  return (
    <div className="bg-white p-4 items-stretch rounded-xl shadow-sm h-full w-full">
      <h3 className="text-lg font-semibold mb-4 text-gray-800">Energy Consumption Over Time</h3>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={formattedData}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
            <XAxis dataKey="time" tick={{ fontSize: 12, fill: '#6B7280' }} minTickGap={30} />
            <YAxis tick={{ fontSize: 12, fill: '#6B7280' }} width={48} />
            <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
            <Line type="monotone" dataKey="energyKwh" name="AURA Energy" stroke="#10B981" strokeWidth={3} dot={false} activeDot={{ r: 6 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
