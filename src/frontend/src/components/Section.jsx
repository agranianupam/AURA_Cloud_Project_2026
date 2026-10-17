import React from 'react';
import { Info } from 'lucide-react';

export default function Section({ about, children, className = '' }) {
  return (
    <div className={className}>
      {children}
      {about && (
        <p className="mt-2 flex gap-1.5 text-xs text-gray-500 leading-relaxed">
          <Info className="w-3.5 h-3.5 shrink-0 mt-px text-gray-400" />
          <span>{about}</span>
        </p>
      )}
    </div>
  );
}

export function PageHeader({ title, subtitle }) {
  return (
    <div className="pb-2">
      <h2 className="text-2xl md:text-3xl font-extrabold text-gray-900 tracking-tight">{title}</h2>
      {subtitle && <p className="text-gray-500 mt-1.5 text-sm md:text-base">{subtitle}</p>}
    </div>
  );
}

