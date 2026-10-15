import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, Loader2, Check } from 'lucide-react';
import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip, CartesianGrid, ReferenceLine, Legend } from 'recharts';
import { validate, toPayload } from '../simulator/InputForm';
import { toMessage } from '../simulator/simulatorApi';
import { GOALS, defaultRanges, runOptimizer } from './optimizerApi';

const pct = (v) => `${Math.round(v * 100)}%`;
const RANGE_FIELDS = [
  { key: 'servers', label: 'Servers', min: 1, max: 1000, step: 1, fmt: (v) => v, help: 'How many servers to try keeping.' },
  { key: 'headroom', label: 'Safety headroom', min: 0, max: 1, step: 0.05, fmt: pct, help: 'Spare capacity kept above the forecast.' },
  { key: 'deferrableShare', label: 'Flexible workload', min: 0, max: 1, step: 0.05, fmt: pct, help: 'Share of work that could be made to wait for greener hours.' },
];

function RangeRow({ f, value, onChange, error }) {
  const set = (i, v) => onChange(i === 0 ? [v, value[1]] : [value[0], v]);
  return (
    <div>
      <span className="text-sm font-medium text-gray-700">{f.label}</span>
      <div className="flex items-center gap-2 mt-1">
        {[0, 1].map((i) => (
          <input
            key={i}
            type="number"
            min={f.min}
            max={f.max}
            step={f.step}
            value={value[i]}
            onChange={(e) => set(i, e.target.value === '' ? '' : Number(e.target.value))}
            aria-label={`${f.label} ${i === 0 ? 'minimum' : 'maximum'}`}
            className={`w-24 rounded-lg border px-2 py-1.5 text-sm ${error ? 'border-red-400' : 'border-gray-300'}`}
          />
        )).reduce((a, b) => [a, <span key="to" className="text-gray-400 text-sm">to</span>, b])}
      </div>
      <span className="block text-xs text-gray-500 mt-1">{f.help}</span>
      {error && <span role="alert" className="block text-xs text-red-600 mt-1">{error}</span>}
    </div>
  );
}

function TradeoffChart({ data, floor }) {
  const mk = (c) => ({ x: c.slaPct, y: c.energySavedKwh, ...c });
  const infeasible = data.candidates.filter((c) => !c.feasible).map(mk);
  const feasible = data.candidates.filter((c) => c.feasible && c !== data.bestCand).map(mk);
  const best = data.bestCand ? [mk(data.bestCand)] : [];
  const front = data.pareto.map(mk);
  const tip = ({ active, payload }) => {
    const c = active && payload?.[0]?.payload;
    if (!c) return null;
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-2 text-xs shadow">
        <div className="font-semibold">{c.params.servers} servers · {pct(c.params.headroom)} headroom · {pct(c.params.deferrableShare)} flexible</div>
        <div>Energy saved: {c.energySavedKwh.toLocaleString()} kWh</div>
        <div>CO₂ avoided: {c.co2SavedKg.toLocaleString()} kg</div>
        <div>Service level: {c.slaPct}% {c.feasible ? '' : '(below your floor)'}</div>
      </div>
    );
  };
  return (
    <div className="h-80" role="img" aria-label="Scatter chart of energy saved against service level for every combination tried">
      <ResponsiveContainer>
        <ScatterChart margin={{ top: 10, right: 20, bottom: 25, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis type="number" dataKey="x" name="Service level" unit="%" domain={['dataMin - 1', 100]} tick={{ fontSize: 11 }}
            label={{ value: 'Service level met (%)', position: 'insideBottom', offset: -12, fontSize: 12 }} />
          <YAxis type="number" dataKey="y" name="Energy saved" unit=" kWh" tick={{ fontSize: 11 }}
            label={{ value: 'Energy saved (kWh)', angle: -90, position: 'insideLeft', fontSize: 12 }} />
          <ZAxis range={[40, 40]} />
          <Tooltip content={tip} cursor={{ strokeDasharray: '3 3' }} />
          <Legend verticalAlign="top" height={28} />
          <ReferenceLine x={floor} stroke="#dc2626" strokeDasharray="4 4" label={{ value: `floor ${floor}%`, fontSize: 11, fill: '#dc2626', position: 'insideTopLeft' }} />
          <Scatter name="Below your SLA floor" data={infeasible} fill="#d1d5db" />
          <Scatter name="Meets the floor" data={feasible} fill="#16a34a" fillOpacity={0.6} />
          <Scatter name="Trade-off frontier" data={front} fill="#2563eb" line={{ stroke: '#2563eb' }} shape="diamond" />
          <Scatter name="Best" data={best} fill="#f59e0b" stroke="#92400e" strokeWidth={2} shape="star" legendType="star" />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function Optimizer({ values, onApply }) {
  const [goal, setGoal] = useState('energy');
  const [floor, setFloor] = useState(99);
  const [ranges, setRanges] = useState(() => defaultRanges(values.servers));
  const [fieldErrors, setFieldErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [applied, setApplied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearInterval(timer.current), []);

  const run = async () => {
    const e = {};
    const baseErr = validate(values);
    if (Object.keys(baseErr).length) {
      setError('Fix the scenario inputs above first (' + Object.values(baseErr)[0] + ')');
      return;
    }
    for (const f of RANGE_FIELDS) {
      const [lo, hi] = ranges[f.key];
      if (lo === '' || hi === '' || lo < f.min || hi > f.max) e[f.key] = `Enter numbers from ${f.min} to ${f.max}.`;
      else if (lo > hi) e[f.key] = 'The first number must not exceed the second.';
      else if (f.key === 'servers' && (!Number.isInteger(lo) || !Number.isInteger(hi))) e[f.key] = 'Use whole numbers.';
    }
    setFieldErrors(e);
    if (Object.keys(e).length) return;
    setLoading(true);
    setError(null);
    setApplied(false);
    setElapsed(0);
    const t0 = Date.now();
    timer.current = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 500);
    try {
      const res = await runOptimizer({ objective: goal, slaFloor: floor, base: toPayload(values), ranges });
      const bestCand = res.best && res.candidates.find((c) => JSON.stringify(c.params) === JSON.stringify(res.best.params));
      setData({ ...res, bestCand });
    } catch (x) {
      const m = toMessage(x);
      setError(m.message);
      if (m.field?.startsWith('ranges.')) setFieldErrors({ [m.field.slice(7)]: m.message });
    } finally {
      clearInterval(timer.current);
      setLoading(false);
    }
  };

  const apply = () => {
    const { servers, headroom, deferrableShare } = data.best.params;
    onApply({ servers, headroom, deferrableShare });
    setApplied(true);
  };

  const g = GOALS.find((x) => x.value === goal);
  return (
    <section className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 space-y-4" aria-labelledby="optimizer-title">
      <div>
        <h2 id="optimizer-title" className="text-lg font-semibold flex items-center gap-2"><Sparkles className="w-5 h-5 text-amber-500" /> Auto-Optimizer</h2>
        <p className="text-sm text-gray-600">
          Tell AURA your goal and how much service you must keep. It tries many server, headroom and flexible-workload combinations
          with the real forecast model for the period and settings above, and finds the best one.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="block">
          <span className="text-sm font-medium text-gray-700">My goal</span>
          <select value={goal} onChange={(e) => setGoal(e.target.value)} aria-label="Optimizer goal" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
            {GOALS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <span className="block text-xs text-gray-500 mt-1">…while the service level stays at or above the floor.</span>
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Service level floor: <b>{floor}%</b></span>
          <input type="range" min={90} max={100} step={0.5} value={floor} onChange={(e) => setFloor(Number(e.target.value))}
            aria-label="Service level floor" className="w-full" />
          <span className="block text-xs text-gray-500">Share of hours demand must be fully served. Higher is safer but saves less.</span>
        </label>
      </div>
      <fieldset>
        <legend className="text-sm font-medium text-gray-700 mb-2">Ranges to try</legend>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {RANGE_FIELDS.map((f) => (
            <RangeRow key={f.key} f={f} value={ranges[f.key]} error={fieldErrors[f.key]} onChange={(v) => setRanges({ ...ranges, [f.key]: v })} />
          ))}
        </div>
      </fieldset>
      <div className="flex items-center gap-3">
        <button type="button" onClick={run} disabled={loading}
          className="inline-flex items-center gap-2 bg-amber-500 text-white px-5 py-2 rounded-lg hover:bg-amber-600 disabled:opacity-60">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {loading ? `Trying combinations… ${elapsed}s` : 'Find the best settings'}
        </button>
        {loading && <span className="text-xs text-gray-500" role="status">Running the forecast model on about 100 combinations; this usually takes under a minute.</span>}
      </div>
      {error && <div role="alert" className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">{error}</div>}

      {data && (
        <div className="space-y-4">
          {data.best ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4" data-testid="optimizer-best">
              <h3 className="font-semibold">Best settings found</h3>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-2 text-sm">
                <Stat t="Servers" v={data.best.params.servers} />
                <Stat t="Headroom" v={pct(data.best.params.headroom)} />
                <Stat t="Flexible workload" v={pct(data.best.params.deferrableShare)} />
                <Stat t={`${g.unit === '$' ? 'Money' : g.unit === 'kWh' ? 'Energy' : 'Carbon'} saved`}
                  v={`${g.unit === '$' ? '$' : ''}${data.best[g.saved].toLocaleString()}${g.unit === '$' ? '' : ' ' + g.unit}`} />
                <Stat t="Service level" v={`${data.best.slaPct}%`} />
              </div>
              <p className="text-xs text-gray-600 mt-2">Savings are compared with keeping {data.reference.servers} servers always on.</p>
              <button type="button" onClick={apply}
                className="mt-3 inline-flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700">
                {applied ? <Check className="w-4 h-4" /> : null}
                {applied ? 'Applied — press “Run simulation” above' : 'Apply these settings to the simulator'}
              </button>
            </div>
          ) : (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{data.explanation}</div>
          )}
          <TradeoffChart data={data} floor={data.slaFloor} />
          {data.best && <p className="text-sm text-gray-700">{data.explanation}</p>}
          <p className="text-xs text-gray-500">
            Each dot is one combination tried ({data.runs} model runs in {(data.elapsedMs / 1000).toFixed(1)} s). Grey dots fall below your service floor,
            green dots meet it, blue diamonds mark the best trade-offs, and the star is the winner.
          </p>
        </div>
      )}
    </section>
  );
}

const Stat = ({ t, v }) => (
  <div>
    <div className="text-xs text-gray-500">{t}</div>
    <div className="text-lg font-bold">{v}</div>
  </div>
);
