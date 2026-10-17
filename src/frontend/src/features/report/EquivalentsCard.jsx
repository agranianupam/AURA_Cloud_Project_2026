import React from 'react';
import { Globe2 } from 'lucide-react';
import { equivalentsFor, uncertaintyHint, SOURCES } from './equivalents';

export default function EquivalentsCard({ result }) {
  if (!result?.summary) return null;
  const items = equivalentsFor(result.summary);
  const hint = uncertaintyHint(result);
  return (
    <div className="bg-sky-50 border border-sky-200 rounded-xl p-5" data-testid="equivalents-card">
      <h3 className="font-semibold flex items-center gap-2 mb-1">
        <Globe2 className="w-5 h-5 text-sky-600" /> What that means in everyday terms
        <span className="text-xs font-semibold uppercase bg-sky-100 text-sky-800 px-2 py-0.5 rounded">Rough</span>
      </h3>
      <p className="text-xs text-gray-600 mb-3">
        Savings over this run ({result.summary.energySavedKwh?.toLocaleString()} kWh, {result.summary.co2SavedKg?.toLocaleString()} kg CO₂), translated with rule-of-thumb factors.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {items.map((e) => (
          <div key={e.key} className="bg-white rounded-lg p-3 border border-sky-100">
            <p className="text-xs text-gray-500">{e.label}</p>
            <p className="text-lg font-bold">{e.value}</p>
            <p className="text-xs text-gray-400">{e.detail}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-700 mt-3">{hint.text}</p>
      <details className="mt-2 text-xs text-gray-600">
        <summary className="cursor-pointer">Assumptions and sources</summary>
        <ul className="list-disc pl-5 mt-1 space-y-0.5">
          {SOURCES.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

