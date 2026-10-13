import React, { useEffect, useState } from 'react';
import { getForecast } from '../services/api';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export default function ForecastChart() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => { fetchData(); }, []);
  const fetchData = async () => {
    setLoading(true);
    const res = await getForecast();
    if (res.error) setError(res.error); else setData(res.data);
    setLoading(false);
  };

  if (loading) return <div className="h-72 animate-pulse bg-gray-200 rounded-lg w-full"></div>;
  if (error) return <div className="text-red-500 p-4">Error: {error} <button onClick={fetchData} className="underline text-sm ml-2">Retry</button></div>;

  const rows = data.forecast.map(r => ({
    ...r,
    time: new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }));
  const { peak_kw, peak_time, energy_kwh } = data.summary;

  return (
    <div className="bg-white p-4 rounded-xl shadow-sm h-full w-full">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-800">Next 24h Demand Forecast</h3>
          <p className="text-xs text-gray-500">LSTM forecast from {new Date(data.forecast_start).toLocaleString()}</p>
        </div>
        <div className="mt-2 sm:mt-0 text-right text-sm text-gray-600">
          <div>Peak <span className="font-semibold text-gray-900">{Math.round(peak_kw)} kW</span> at {new Date(peak_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
          <div>Total <span className="font-semibold text-gray-900">{Math.round(energy_kwh).toLocaleString()} kWh</span></div>
        </div>
      </div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
            <XAxis dataKey="time" tick={{ fontSize: 12, fill: '#6B7280' }} minTickGap={30} />
            <YAxis tick={{ fontSize: 12, fill: '#6B7280' }} label={{ value: 'Demand (kW)', angle: -90, position: 'insideLeft', fill: '#6B7280' }} />
            <Tooltip formatter={(v) => `${Math.round(v)} kW`} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
            <Legend verticalAlign="top" height={36} />
            <Line type="monotone" dataKey="same_hour_last_week_kw" name="Same hour last week" stroke="#9CA3AF" strokeWidth={2} strokeDasharray="5 5" dot={false} />
            <Line type="monotone" dataKey="total_kw" name="Forecast" stroke="#4F46E5" strokeWidth={3} dot={false} activeDot={{ r: 6 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
