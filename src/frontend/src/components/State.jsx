import React from 'react';
import { AlertTriangle, Inbox } from 'lucide-react';

export function Skeleton({ className = 'h-64' }) {
  return <div role="status" aria-label="Loading" className={`${className} w-full animate-pulse bg-gray-200 rounded-xl`} />;
}

export function ErrorBox({ error, onRetry }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 p-4 rounded-xl border border-red-200 bg-red-50 text-red-700 text-sm">
      <AlertTriangle className="w-5 h-5 shrink-0" />
      <span className="min-w-0 break-words">Could not load data: {error}</span>
      {onRetry && <button onClick={onRetry} className="ml-auto px-3 py-1 rounded-md bg-red-600 text-white text-xs font-medium hover:bg-red-700">Retry</button>}
    </div>
  );
}

export function Empty({ message = 'No data available yet.' }) {
  return (
    <div className="flex flex-col items-center gap-2 p-8 rounded-xl border border-dashed border-gray-300 bg-white text-gray-500 text-sm">
      <Inbox className="w-6 h-6" /> {message}
    </div>
  );
}
