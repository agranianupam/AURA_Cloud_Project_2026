import React, { useEffect, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts';
import { forecastPreview, toMessage } from './simulatorApi';

export default function ForecastPreview({ initialDate }) {
  const [date, setDate] = useState(initialDate);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!date) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    forecastPreview(date)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && (setError(toMessage(e).message), setData(null)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [date]);

  const rows = (data?.hourly || []).map((r) => ({
    h: `${String(new Date(r.ts).getUTCHours()).padStart(2, '0')}:00`,
    forecastKw: r.forecastKw,
    actualKw: r.actualKw ?? null,
  }));
  const hasActual = rows.some((r) => r.actualKw != null);

  return (
    <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div>
          <h2 className="text-lg font-semibold">Forecast preview</h2>
          <p className="text-xs text-gray-500">Pick a day to see the model&apos;s hourly demand forecast{hasActual ? ' next to what really happened' : ''}.</p>
        </div>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Forecast date" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
      </div>
      {loading && <div className="h-64 bg-gray-100 animate-pulse rounded-lg" />}
      {error && (
        <div role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
          {error}
        </div>
      )}
      {!loading && !error && data && (
        <div className="h-64">
          <ResponsiveContainer>
            <LineChart data={rows}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="h" tick={{ fontSize: 11 }} interval={2} />
              <YAxis tick={{ fontSize: 11 }} unit=" kW" width={60} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="forecastKw" name="Forecast" stroke="#2563eb" dot={false} />
              {hasActual && <Line type="monotone" dataKey="actualKw" name="Actual" stroke="#f59e0b" dot={false} connectNulls={false} />}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
