import React from 'react';
import { Trash2 } from 'lucide-react';

const KEY = 'aura.scenarios.v1';
export const MAX_SCENARIOS = 3;

export function loadScenarios() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
export function storeScenarios(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable: scenarios stay in memory only */
  }
}

const ROWS = [
  ['Period', (s) => (s.inputs.startDate === s.inputs.endDate ? s.inputs.startDate : `${s.inputs.startDate} → ${s.inputs.endDate}`)],
  ['Servers', (s) => s.inputs.servers],
  ['Idle / peak watts', (s) => `${s.inputs.idleWatts} / ${s.inputs.peakWatts}`],
  ['Flexible workload', (s) => `${Math.round(s.inputs.deferrableShare * 100)}%`],
  ['Grid', (s) => s.inputs.carbonGrid],
  ['Events', (s) => (s.inputs.events.length ? s.inputs.events.join(', ') : 'none')],
  ['Energy saved', (s) => `${s.summary.energySavedKwh} kWh`, 'energySavedKwh'],
  ['CO₂ avoided', (s) => `${s.summary.co2SavedKg} kg`, 'co2SavedKg'],
  ['Cost saved', (s) => `$${s.summary.costSaved}`, 'costSaved'],
  ['Service level', (s) => `${s.summary.slaPct}%`, 'slaPct'],
];

export default function ScenarioCompare({ scenarios, onRemove, onClear }) {
  if (!scenarios.length) {
    return (
      <div className="bg-white p-5 rounded-xl border border-dashed border-gray-300 text-sm text-gray-500">
        <h2 className="text-lg font-semibold text-gray-800 mb-1">Compare scenarios</h2>
        Run a simulation and press &quot;Save to compare&quot; (up to {MAX_SCENARIOS}) to see runs side by side.
      </div>
    );
  }
  const best = (k) => Math.max(...scenarios.map((s) => s.summary[k]));
  return (
    <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 overflow-x-auto">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">Compare scenarios</h2>
        <button onClick={onClear} className="text-sm text-gray-600 hover:text-red-600">
          Clear all
        </button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b border-gray-200">
            <th className="py-2 pr-4 font-medium text-gray-500"></th>
            {scenarios.map((s, i) => (
              <th key={s.id} className="py-2 pr-4 font-semibold">
                Scenario {i + 1}
                <button onClick={() => onRemove(s.id)} aria-label={`Remove scenario ${i + 1}`} className="ml-2 text-gray-400 hover:text-red-600 align-middle">
                  <Trash2 className="w-4 h-4 inline" />
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map(([label, get, key]) => (
            <tr key={label} className="border-b border-gray-100">
              <td className="py-2 pr-4 text-gray-500">{label}</td>
              {scenarios.map((s) => (
                <td key={s.id} className={`py-2 pr-4 ${key && scenarios.length > 1 && s.summary[key] === best(key) ? 'font-bold text-green-700' : ''}`}>
                  {get(s)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {scenarios.length > 1 && <p className="text-xs text-gray-500 mt-2">Best value in each result row is shown in green.</p>}
    </div>
  );
}
