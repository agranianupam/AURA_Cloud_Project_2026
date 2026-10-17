import React, { useState } from 'react';
import { Clock, Loader2, Wifi, WifiOff } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceArea, ReferenceLine } from 'recharts';
import { askAdvisor, adviceSentence, fmtLocal } from './advisorApi';
import { toMessage } from '../simulator/simulatorApi';

const INITIAL = { durationHours: '3', powerMode: 'servers', powerKw: '10', servers: '20', serverWatts: '250', windowHours: '24', deadline: '' };

function toBody(v) {
  const body = { durationHours: Number(v.durationHours), windowHours: Number(v.windowHours) };
  if (v.powerMode === 'kw') body.powerKw = Number(v.powerKw);
  else {
    body.servers = Number(v.servers);
    body.serverWatts = Number(v.serverWatts);
  }
  if (v.deadline) body.deadline = new Date(v.deadline).toISOString();
  return body;
}

function check(v) {
  const e = {};
  const range = (k, lo, hi, msg) => {
    if (v[k] === '' || isNaN(v[k]) || Number(v[k]) < lo || Number(v[k]) > hi) e[k] = msg || `Enter a number from ${lo} to ${hi}.`;
  };
  range('durationHours', 0.5, 24, 'Job length must be between 0.5 and 24 hours.');
  range('windowHours', 1, 48, 'Look-ahead must be between 1 and 48 hours.');
  if (v.powerMode === 'kw') range('powerKw', 0.001, 10000, 'Power must be a positive number of kW.');
  else {
    range('servers', 1, 100000, 'Enter at least 1 server.');
    range('serverWatts', 1, 5000, 'Watts per server must be between 1 and 5000.');
  }
  if (v.deadline && new Date(v.deadline) <= new Date()) e.deadline = 'The deadline must be in the future.';
  return e;
}

export default function Advisor() {
  const [v, setV] = useState(INITIAL);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState(null);
  const [res, setRes] = useState(null);
  const set = (k, val) => setV((p) => ({ ...p, [k]: val }));
  const cls = (k) => `w-full rounded-lg border px-3 py-2 text-sm ${errors[k] ? 'border-red-400' : 'border-gray-300'}`;

  const run = async (e) => {
    e.preventDefault();
    const errs = check(v);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setLoading(true);
    setApiError(null);
    try {
      setRes(await askAdvisor(toBody(v)));
    } catch (x) {
      const m = toMessage(x);
      setApiError(m.message);
      if (m.field && m.field in v) setErrors({ [m.field]: m.message });
    } finally {
      setLoading(false);
    }
  };

  const field = (k, label, help, props = {}) => (
    <label className="block">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <input className={cls(k)} value={v[k]} onChange={(e) => set(k, e.target.value)} aria-label={label} {...props} />
      {help && <span className="block text-xs text-gray-500 mt-1">{help}</span>}
      {errors[k] && <span role="alert" className="block text-xs text-red-600 mt-1">{errors[k]}</span>}
    </label>
  );

  return (
    <section className="space-y-4" aria-labelledby="advisor-h">
      <div>
        <h2 id="advisor-h" className="text-xl font-bold flex items-center gap-2"><Clock className="w-5 h-5 text-green-600" /> Run now or later?</h2>
        <p className="text-sm text-gray-600">
          Describe a job (a batch run, a backup, a training job). AURA looks at the carbon-intensity forecast and suggests the cleanest time to run it.
          Forecasts are for the <b>UK grid</b>, used as a real-world example of how carbon changes through the day. They do not describe your local grid.
        </p>
      </div>
      <form onSubmit={run} className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {field('durationHours', 'Job length (hours)', 'How long the job runs once started (0.5-24 h).', { type: 'number', min: 0.5, max: 24, step: 0.5 })}
          <div>
            <span className="text-sm font-medium text-gray-700">Power</span>
            <select className={cls('powerMode')} value={v.powerMode} onChange={(e) => set('powerMode', e.target.value)} aria-label="Power input type">
              <option value="servers">Number of servers × watts</option>
              <option value="kw">Total power in kW</option>
            </select>
            <span className="block text-xs text-gray-500 mt-1">How you want to describe the job&apos;s electricity use.</span>
          </div>
          {v.powerMode === 'kw'
            ? field('powerKw', 'Power draw (kW)', 'Average power the job uses while running.', { type: 'number', min: 0.001, step: 0.5 })
            : <>
                {field('servers', 'Servers', 'How many servers the job occupies.', { type: 'number', min: 1, step: 1 })}
                {field('serverWatts', 'Watts per server', 'Average draw of one busy server (default 250 W).', { type: 'number', min: 1, step: 10 })}
              </>}
          {field('windowHours', 'Look ahead (hours)', 'How far ahead the job may start (1-48 h).', { type: 'number', min: 1, max: 48, step: 1 })}
          {field('deadline', 'Deadline (optional)', 'Job must finish by this time (your local time). Leave empty if flexible.', { type: 'datetime-local' })}
        </div>
        <button type="submit" disabled={loading} className="inline-flex items-center gap-2 bg-green-600 text-white px-5 py-2 rounded-lg hover:bg-green-700 disabled:opacity-60">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />}
          {loading ? 'Checking the grid…' : 'Find best time'}
        </button>
      </form>
      {apiError && <div role="alert" className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">{apiError}</div>}
      {res && <AdvisorResult r={res} />}
    </section>
  );
}

export function SourceBadge({ r }) {
  const live = r.source === 'live';
  return (
    <span className="inline-flex items-center gap-2 text-xs">
      <span className={`inline-flex items-center gap-1 font-semibold px-2 py-0.5 rounded ${live ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
        {live ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />} {live ? 'LIVE' : 'OFFLINE'}
      </span>
      <span className="text-gray-500">
        {live ? 'UK grid forecast' : 'offline - using typical profile'} · data fetched {new Date(r.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{r.cached ? ' (cached)' : ''}
      </span>
    </span>
  );
}

export function AdvisorResult({ r }) {
  const now = new Date();
  const data = r.series.map((p) => ({ t: Date.parse(p.start), intensity: p.intensity }));
  const t0 = data[0].t;
  const bStart = Date.parse(r.best.start);
  const bEnd = Date.parse(r.best.end);
  const hm = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const better = r.savingKg > 0.0005;
  return (
    <div className="space-y-4">
      <div className={`rounded-xl p-5 border ${better ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`} data-testid="advisor-card">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h3 className="font-semibold">Recommendation</h3>
          <SourceBadge r={r} />
        </div>
        <p className="text-lg font-semibold text-gray-900">{adviceSentence(r, now)}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 text-sm">
          <div className="bg-white rounded-lg p-3 border border-gray-100">
            <p className="text-xs text-gray-500">Best window</p>
            <p className="font-bold">{fmtLocal(r.best.start, now)} to {hm(bEnd)}</p>
            <p className="text-xs text-gray-500">{r.best.avgIntensity} gCO₂/kWh average · {r.best.co2Kg} kg CO₂</p>
          </div>
          <div className="bg-white rounded-lg p-3 border border-gray-100">
            <p className="text-xs text-gray-500">If you start now</p>
            <p className="font-bold">{fmtLocal(r.now.start, now)} to {hm(Date.parse(r.now.end))}</p>
            <p className="text-xs text-gray-500">{r.now.avgIntensity} gCO₂/kWh average · {r.now.co2Kg} kg CO₂</p>
          </div>
        </div>
        {r.notice && <p className="text-xs text-yellow-800 mt-2">The live carbon service could not be reached ({r.notice}). Times are in your local clock but the shape is a typical day, not a forecast.</p>}
      </div>
      <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100">
        <h3 className="font-semibold mb-1">Carbon intensity forecast (gCO₂/kWh)</h3>
        <p className="text-xs text-gray-500 mb-2">Lower is cleaner. The shaded band is the best window; the dashed line is now. Times are your local time.</p>
        <div className="h-64">
          <ResponsiveContainer>
            <AreaChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={hm} tick={{ fontSize: 11 }} minTickGap={30} />
              <YAxis tick={{ fontSize: 11 }} width={44} />
              <Tooltip labelFormatter={(t) => fmtLocal(t, now)} formatter={(val) => [`${val} gCO₂/kWh`, 'Intensity']} />
              <ReferenceArea x1={bStart} x2={bEnd} fill="#16a34a" fillOpacity={0.2} stroke="#16a34a" label={{ value: 'best', fontSize: 11, fill: '#166534' }} />
              <ReferenceLine x={t0} stroke="#374151" strokeDasharray="4 3" label={{ value: 'now', fontSize: 11, position: 'insideTopLeft' }} />
              <Area type="stepAfter" dataKey="intensity" stroke="#2563eb" fill="#dbeafe" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

