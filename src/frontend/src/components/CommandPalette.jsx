import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, CornerDownLeft } from 'lucide-react';

// Ctrl/Cmd+K quick switcher. `commands`: [{ id, label, group, icon, hint, keywords, run }]
export default function CommandPalette({ open, onClose, commands }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands
      .map((c) => ({ c, score: `${c.label} ${c.group} ${c.keywords || ''}`.toLowerCase().indexOf(q) }))
      .filter((r) => r.score >= 0)
      .sort((a, b) => a.score - b.score)
      .map((r) => r.c);
  }, [query, commands]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    const id = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [open]);

  useEffect(() => { setActive(0); }, [query]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const run = (c) => { onClose(); c.run(); };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && results[active]) { e.preventDefault(); run(results[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  let lastGroup = null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" onClick={onClose} />
      <div className="aura-toast relative w-full max-w-lg bg-white border border-gray-200 rounded-2xl shadow-2xl overflow-hidden" onKeyDown={onKeyDown}>
        <div className="flex items-center gap-3 px-4 border-b border-gray-200">
          <Search className="w-4 h-4 text-gray-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages and actions…"
            className="flex-1 py-3.5 bg-transparent text-sm text-gray-900 placeholder:text-gray-400 outline-none"
            aria-label="Search commands"
          />
          <kbd className="text-[10px] font-medium text-gray-500 border border-gray-200 rounded px-1.5 py-0.5">Esc</kbd>
        </div>
        <ul ref={listRef} className="max-h-80 overflow-y-auto p-2" role="listbox">
          {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-gray-500">No matches for “{query}”</li>}
          {results.map((c, i) => {
            const header = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            const Icon = c.icon;
            return (
              <React.Fragment key={c.id}>
                {header && <li className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{header}</li>}
                <li
                  data-idx={i}
                  role="option"
                  aria-selected={i === active}
                  onMouseMove={() => setActive(i)}
                  onClick={() => run(c)}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm cursor-pointer ${i === active ? 'bg-indigo-50 text-indigo-700' : 'text-gray-700'}`}
                >
                  {Icon && <Icon className="w-4 h-4 shrink-0" />}
                  <span className="flex-1">{c.label}</span>
                  {c.hint && <span className="text-xs text-gray-400">{c.hint}</span>}
                  {i === active && <CornerDownLeft className="w-3.5 h-3.5 opacity-60" />}
                </li>
              </React.Fragment>
            );
          })}
        </ul>
        <div className="flex gap-4 px-4 py-2 border-t border-gray-200 text-[11px] text-gray-400">
          <span>↑↓ navigate</span><span>↵ select</span><span>Ctrl K toggle</span>
        </div>
      </div>
    </div>
  );
}
