import React from 'react';
import { Zap, Leaf, DollarSign, Activity } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts';
import Recommendations from './Recommendations';

const fmt = (ts) => {
  const d = new Date(ts);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, '0')}h`;
};

export function Kpis({ summary }) {
  const items = [
    { t: 'Energy saved', v: `${summary.energySavedKwh.toLocaleString()} kWh`, I: Zap, c: 'text-yellow-500', bg: 'bg-yellow-50' },
    { t: 'CO₂ avoided', v: `${summary.co2SavedKg.toLocaleString()} kg`, I: Leaf, c: 'text-green-500', bg: 'bg-green-50' },
    { t: 'Cost saved', v: `$${summary.costSaved.toLocaleString()}`, I: DollarSign, c: 'text-blue-500', bg: 'bg-blue-50' },
    { t: 'Service level met', v: `${summary.slaPct}%`, I: Activity, c: 'text-purple-500', bg: 'bg-purple-50' },
  ];
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {items.map(({ t, v, I, c, bg }) => (
        <div key={t} className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4">
          <div className={`p-3 rounded-full ${bg}`}>
            <I className={`w-6 h-6 ${c}`} />
          </div>
          <div>
            <p className="text-sm text-gray-500">{t}</p>
            <p className="text-2xl font-bold">{v}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

const Card = ({ title, children }) => (
  <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100">
    <h3 className="font-semibold mb-3">{title}</h3>
    <div className="h-64">{children}</div>
  </div>
);

export default function Results({ result, onSave, canSave }) {
  const data = result.hourly.map((r) => ({ ...r, label: fmt(r.ts) }));
  const axis = { dataKey: 'label', minTickGap: 40, tick: { fontSize: 11 } };
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Results</h2>
        {onSave && (
          <button
            onClick={onSave}
            disabled={!canSave}
            className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
          >
            Save to compare
          </button>
        )}
      </div>
      <Kpis summary={result.summary} />
      <Recommendations items={result.recommendations} />
      {result.warnings?.length > 0 && (
        <ul className="bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-lg p-3 text-sm list-disc pl-6">
          {result.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Energy per hour: AURA vs always-on (kWh)">
          <ResponsiveContainer>
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis {...axis} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="baselineKwh" name="Always-on" stroke="#9ca3af" dot={false} />
              <Line type="monotone" dataKey="energyKwh" name="AURA" stroke="#16a34a" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
        <Card title="CO₂ per hour: AURA vs always-on (g)">
          <ResponsiveContainer>
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis {...axis} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="baselineCo2G" name="Always-on" stroke="#9ca3af" dot={false} />
              <Line type="monotone" dataKey="co2G" name="AURA" stroke="#2563eb" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      </div>
      <Card title="Servers switched on per hour">
        <ResponsiveContainer>
          <AreaChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis {...axis} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip />
            <Area type="stepAfter" dataKey="serversOn" name="Servers on" stroke="#7c3aed" fill="#ede9fe" />
          </AreaChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}
