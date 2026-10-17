import React from 'react';
import { Lightbulb } from 'lucide-react';

export default function Recommendations({ items }) {
  if (!items?.length) return null;
  return (
    <div className="bg-green-50 border border-green-200 rounded-xl p-5">
      <h3 className="font-semibold flex items-center gap-2 mb-2">
        <Lightbulb className="w-5 h-5 text-green-600" /> What AURA recommends
      </h3>
      <ul className="space-y-1.5 text-sm text-gray-800 list-disc pl-5">
        {items.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
    </div>
  );
}

