import React, { useEffect, useMemo, useState } from 'react';
import { Play, Pause, SkipBack } from 'lucide-react';
import { ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid } from 'recharts';

const SPEEDS = [
  { label: '1x', ms: 700 },
  { label: '2x', ms: 350 },
  { label: '5x', ms: 140 },
  { label: '10x', ms: 70 },
];

const fmtHour = (ts) => (ts ? ts.slice(0, 16).replace('T', ' ') : '');
const n = (x, d = 0) => Number(x).toLocaleString('en-US', { maximumFractionDigits: d });

// Replays a simulation hour by hour: which servers are on, what AURA decided, and the savings so far.
export default function FleetReplay({ result, servers: serversProp }) {
  const hourly = useMemo(() => result?.hourly ?? [], [result]);
  const servers = serversProp ?? result?.params?.servers ?? Math.max(1, ...hourly.map((h) => h.serversOn));
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const last = hourly.length - 1;

  // A new run starts a fresh replay.
  const [seen, setSeen] = useState(result);
  if (seen !== result) {
    setSeen(result);
    setIdx(0);
    setPlaying(false);
  }

  useEffect(() => {
    if (!playing) return undefined;
    const t = setInterval(() => {
      setIdx((i) => {
        if (i >= last) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, SPEEDS[speed].ms);
    return () => clearInterval(t);
  }, [playing, speed, last]);

  // Scaling decisions, derived from changes in servers on between consecutive hours.
  const events = useMemo(
    () =>
      hourly.flatMap((h, i) => {
        if (i === 0 || h.serversOn === hourly[i - 1].serversOn) return [];
        const from = hourly[i - 1].serversOn;
        return [{ i, ts: h.ts, up: h.serversOn > from, from, to: h.serversOn, demandKw: h.demandKw }];
      }),
    [hourly],
  );

  // Running totals up to and including the current hour.
  const totals = useMemo(() => {
    const out = [];
    hourly.forEach((h, i) => {
      const prev = out[i - 1] ?? { kwh: 0, co2: 0, missed: 0 };
      out.push({
        kwh: prev.kwh + h.baselineKwh - h.energyKwh,
        co2: prev.co2 + (h.baselineCo2G - h.co2G) / 1000,
        missed: prev.missed + (h.slaMet === false ? 1 : 0),
      });
    });
    return out;
  }, [hourly]);

  if (!hourly.length) return null;
  const cur = hourly[idx];
  const tot = totals[idx];
  const tile = servers > 150 ? 'w-2 h-2' : servers > 60 ? 'w-3.5 h-3.5' : 'w-5 h-5';
  const shown = events.filter((e) => e.i <= idx).slice(-6).reverse();
  const chartData = hourly.map((h) => ({ ts: h.ts, label: h.ts.slice(5, 13).replace('T', ' '), serversOn: h.serversOn, demandKw: h.demandKw }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => {
            if (idx >= last) setIdx(0);
            setPlaying((p) => !p);
          }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm hover:bg-indigo-700"
        >
          {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          {playing ? 'Pause' : idx >= last ? 'Replay' : 'Play'}
        </button>
        <button
          onClick={() => {
            setPlaying(false);
            setIdx(0);
          }}
          aria-label="Back to start"
          className="p-2 rounded-lg border border-gray-300 hover:bg-gray-50"
        >
          <SkipBack className="w-4 h-4" />
        </button>
        <div className="flex gap-1" role="group" aria-label="Playback speed">
          {SPEEDS.map((s, i) => (
            <button
              key={s.label}
              onClick={() => setSpeed(i)}
              className={`px-2.5 py-1 text-xs rounded-full ${i === speed ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <span className="text-sm font-medium text-gray-700 ml-auto">{fmtHour(cur.ts)} (hour {idx + 1} of {hourly.length})</span>
      </div>

      <input
        type="range"
        min={0}
        max={last}
        value={idx}
        onChange={(e) => {
          setPlaying(false);
          setIdx(Number(e.target.value));
        }}
        aria-label="Timeline"
        className="w-full accent-indigo-600"
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <Stat label="Servers on" value={`${cur.serversOn} / ${servers}`} />
        <Stat label="Demand" value={`${n(cur.demandKw, 1)} kW`} sub={`${n(cur.utilizationPct ?? 0)}% utilisation`} />
        <Stat label="Energy saved so far" value={`${n(tot.kwh, 1)} kWh`} />
        <Stat label="CO₂ saved so far" value={`${n(tot.co2, 1)} kg`} />
      </div>

      {cur.slaMet === false && (
        <div role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">
          Not enough servers on this hour: demand was higher than the capacity AURA had running (SLA miss).
        </div>
      )}

      <div>
        <div className="flex flex-wrap gap-1" role="img" aria-label={`${cur.serversOn} of ${servers} servers on`}>
          {Array.from({ length: servers }, (_, i) => (
            <span
              key={i}
              title={`Server ${i + 1}: ${i < cur.serversOn ? 'on' : 'off'}`}
              className={`${tile} rounded-sm transition-colors ${i < cur.serversOn ? 'bg-green-500' : 'bg-gray-200'}`}
            />
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-2">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-green-500 align-middle mr-1" /> on
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-gray-200 align-middle mx-1 ml-3" /> off. Each square is one server.
        </p>
      </div>

      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6B7280' }} minTickGap={40} />
            <YAxis yAxisId="s" tick={{ fontSize: 11, fill: '#6B7280' }} label={{ value: 'Servers on', angle: -90, position: 'insideLeft', fill: '#6B7280', fontSize: 11 }} />
            <YAxis yAxisId="d" orientation="right" tick={{ fontSize: 11, fill: '#6B7280' }} label={{ value: 'Demand (kW)', angle: 90, position: 'insideRight', fill: '#6B7280', fontSize: 11 }} />
            <Tooltip />
            <Area yAxisId="s" type="stepAfter" dataKey="serversOn" name="Servers on" stroke="#10B981" fill="#D1FAE5" fillOpacity={0.6} isAnimationActive={false} />
            <Line yAxisId="d" type="monotone" dataKey="demandKw" name="Demand (kW)" stroke="#4F46E5" strokeWidth={2} dot={false} isAnimationActive={false} />
            <ReferenceLine yAxisId="s" x={chartData[idx].label} stroke="#EF4444" strokeWidth={2} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-800 mb-2">What AURA did (scaling decisions so far)</h3>
        {shown.length === 0 ? (
          <p className="text-sm text-gray-500">No scaling changes yet. Press Play or drag the timeline.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {shown.map((e) => (
              <li key={e.i} className="flex gap-2 items-baseline">
                <span className={`text-xs font-semibold uppercase px-2 py-0.5 rounded ${e.up ? 'bg-yellow-100 text-yellow-800' : 'bg-blue-100 text-blue-800'}`}>{e.up ? 'scale up' : 'scale down'}</span>
                <span className="text-gray-500">{fmtHour(e.ts)}</span>
                <span className="text-gray-700">
                  {e.from} to {e.to} servers (demand {n(e.demandKw, 1)} kW)
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {tot.missed > 0 && <p className="text-xs text-red-700">{tot.missed} hour(s) so far had less capacity than demand.</p>}
    </div>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-lg font-semibold text-gray-900">{value}</div>
      {sub && <div className="text-xs text-gray-500">{sub}</div>}
    </div>
  );
}
