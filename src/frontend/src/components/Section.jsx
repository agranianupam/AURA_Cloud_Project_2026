import React from 'react';

// Wraps a chart/KPI block with a short plain-language "what is this?" line.
export default function Section({ about, children, className = '' }) {
  return (
    <div className={className}>
      {children}
      {about && <p className="mt-2 text-xs text-gray-500 italic">What is this? {about}</p>}
    </div>
  );
}

export function PageHeader({ title, subtitle }) {
  return (
    <div className="pb-4 border-b border-gray-200">
      <h2 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight">{title}</h2>
      {subtitle && <p className="text-gray-500 mt-1 text-sm">{subtitle}</p>}
    </div>
  );
}
