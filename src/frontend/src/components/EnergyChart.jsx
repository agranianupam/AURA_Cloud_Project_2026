import React, { useEffect, useState } from 'react';
import { getEnergyMetrics } from '../services/api';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function EnergyChart() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => { fetchData(); }, []);
  const fetchData = async () => {
    setLoading(true);
    const res = await getEnergyMetrics();
    if (res.error) setError(res.error); else setData(res.data);
    setLoading(false);
  };

  if (loading) return <div className="h-72 animate-pulse bg-gray-200 rounded-lg w-full"></div>;
  if (error) return <div className="text-red-500 p-4">Error: {error} <button onClick={fetchData} className="underline text-sm ml-2">Retry</button></div>;

  const formattedData = data.map(d => ({ ...d, time: new Date(d.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }));

  return (
    <div className="bg-white p-4 items-stretch rounded-xl shadow-sm h-full w-full">
      <h3 className="text-lg font-semibold mb-4 text-gray-800">Energy Consumption Over Time</h3>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={formattedData}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
            <XAxis dataKey="time" tick={{ fontSize: 12, fill: '#6B7280' }} minTickGap={30} />
            <YAxis tick={{ fontSize: 12, fill: '#6B7280' }} label={{ value: 'Energy (kWh)', angle: -90, position: 'insideLeft', fill: '#6B7280' }} />
            <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
            <Line type="monotone" dataKey="energyKwh" name="AURA Energy" stroke="#10B981" strokeWidth={3} dot={false} activeDot={{ r: 6 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
