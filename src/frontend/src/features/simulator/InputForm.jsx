import React from 'react';
import { Play, Loader2, RotateCcw } from 'lucide-react';
import { DEFAULTS } from './simulatorApi';

export const DATA_MIN = '2018-07-15';
export const DATA_MAX = '2019-10-21';

const FIELDS = [
  { key: 'startDate', label: 'Start date', type: 'date', min: DATA_MIN, max: DATA_MAX, help: 'First day to simulate. Data covers 15 Jul 2018 to 21 Oct 2019.' },
  { key: 'endDate', label: 'End date', type: 'date', min: DATA_MIN, max: DATA_MAX, help: 'Last day to simulate (up to 31 days).' },
  { key: 'servers', label: 'Servers', type: 'number', min: 1, max: 1000, step: 1, help: 'How many servers your lab or campus runs (1-1000).' },
  { key: 'idleWatts', label: 'Idle power (W)', type: 'number', min: 10, max: 500, step: 5, help: 'Watts one server draws when switched on but doing nothing.' },
  { key: 'peakWatts', label: 'Peak power (W)', type: 'number', min: 11, max: 1500, step: 5, help: 'Watts one server draws at full load. Must exceed idle power.' },
  { key: 'deferrableShare', label: 'Flexible workload', type: 'number', min: 0, max: 1, step: 0.05, help: 'Share of work that can wait (0-1), e.g. 0.3 = 30% can run later at greener hours.' },
];
export const GRIDS = [
  ['low', 'Low carbon (~200 g/kWh)'],
  ['medium', 'Medium (~400 g/kWh)'],
  ['high', 'High (~650 g/kWh)'],
  ['india', 'India average (~700 g/kWh)'],
];
const EVENTS = [
  ['exam', 'Exams (demand up)'],
  ['break', 'Semester break (demand down)'],
  ['holiday', 'Holiday (demand down)'],
  ['event', 'Unplanned surge (not forecast; may cause SLA misses)'],
];

export function validate(v, { dates = true } = {}) {
  const e = {};
  const num = (k, lo, hi) => {
    if (v[k] === '' || isNaN(v[k]) || Number(v[k]) < lo || Number(v[k]) > hi) e[k] = `Enter a number from ${lo} to ${hi}.`;
  };
  num('servers', 1, 1000);
  num('idleWatts', 10, 500);
  num('deferrableShare', 0, 1);
  num('peakWatts', Number(v.idleWatts) + 1 || 11, 1500);
  if (dates) {
    if (!v.startDate) e.startDate = 'Pick a start date.';
    else if (v.startDate < DATA_MIN || v.startDate > DATA_MAX) e.startDate = 'Choose a date between 15 Jul 2018 and 21 Oct 2019 (the building data we have).';
    if (!v.endDate) e.endDate = 'Pick an end date.';
    else if (v.endDate < DATA_MIN || v.endDate > DATA_MAX) e.endDate = 'Choose a date between 15 Jul 2018 and 21 Oct 2019 (the building data we have).';
    if (v.startDate && v.endDate) {
      const days = (new Date(v.endDate) - new Date(v.startDate)) / 86400000;
      if (days < 0) e.endDate = 'End date must be on or after the start date.';
      else if (days > 30) e.endDate = 'Please choose at most 31 days.';
    }
  }
  return e;
}

export const toPayload = (v) => ({
  ...v,
  servers: Number(v.servers),
  idleWatts: Number(v.idleWatts),
  peakWatts: Number(v.peakWatts),
  deferrableShare: Number(v.deferrableShare),
});

export default function InputForm({ values, onChange, onRun, loading, errors }) {
  const set = (k, val) => onChange({ ...values, [k]: val });
  const toggleEvent = (ev) =>
    set('events', values.events.includes(ev) ? values.events.filter((x) => x !== ev) : [...values.events, ev]);
  const cls = (k) => `w-full rounded-lg border px-3 py-2 text-sm ${errors[k] ? 'border-red-400' : 'border-gray-300'}`;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onRun();
      }}
      className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 space-y-4"
    >
      <h2 className="text-lg font-semibold">Scenario inputs</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {FIELDS.map((f) => (
          <label key={f.key} className="block">
            <span className="text-sm font-medium text-gray-700">{f.label}</span>
            <input
              className={cls(f.key)}
              type={f.type}
              min={f.min}
              max={f.max}
              step={f.step}
              value={values[f.key]}
              onChange={(e) => set(f.key, e.target.value)}
              aria-label={f.label}
            />
            <span className="block text-xs text-gray-500 mt-1">{f.help}</span>
            {errors[f.key] && (
              <span role="alert" className="block text-xs text-red-600 mt-1">
                {errors[f.key]}
              </span>
            )}
          </label>
        ))}
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Grid carbon profile</span>
          <select
            className={cls('carbonGrid')}
            value={values.carbonGrid}
            onChange={(e) => set('carbonGrid', e.target.value)}
            aria-label="Grid carbon profile"
          >
            {GRIDS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <span className="block text-xs text-gray-500 mt-1">How dirty your electricity is. Higher means each kWh saved avoids more CO2.</span>
        </label>
      </div>
      <fieldset>
        <legend className="text-sm font-medium text-gray-700">Calendar events</legend>
        <div className="flex flex-wrap gap-3 mt-1">
          {EVENTS.map(([v, l]) => (
            <label key={v} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={values.events.includes(v)} onChange={() => toggleEvent(v)} /> {l}
            </label>
          ))}
        </div>
        <span className="block text-xs text-gray-500 mt-1">Tick anything happening in this period; it changes expected demand.</span>
      </fieldset>
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={loading}
          className="inline-flex items-center gap-2 bg-green-600 text-white px-5 py-2 rounded-lg hover:bg-green-700 disabled:opacity-60"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          {loading ? 'Running model…' : 'Run simulation'}
        </button>
        <button
          type="button"
          onClick={() => onChange({ ...DEFAULTS })}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 text-sm hover:bg-gray-50"
        >
          <RotateCcw className="w-4 h-4" /> Reset
        </button>
      </div>
    </form>
  );
}
