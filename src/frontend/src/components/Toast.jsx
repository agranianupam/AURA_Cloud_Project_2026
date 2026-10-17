import React, { createContext, useCallback, useContext, useState } from 'react';
import { AlertTriangle, Info, OctagonAlert, X } from 'lucide-react';

const ToastContext = createContext(() => {});

const STYLES = {
  critical: { icon: OctagonAlert, bar: 'bg-red-500', tint: 'text-red-600' },
  warning: { icon: AlertTriangle, bar: 'bg-amber-500', tint: 'text-amber-700' },
  info: { icon: Info, bar: 'bg-indigo-500', tint: 'text-indigo-600' },
};

let nextId = 1;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const toast = useCallback((t) => {
    const id = nextId++;
    setToasts((list) => [...list.slice(-3), { id, severity: 'info', ...t }]);
    setTimeout(() => dismiss(id), t.duration ?? 6000);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div aria-live="polite" className="fixed z-50 bottom-4 right-4 left-4 sm:left-auto sm:w-96 flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => {
          const s = STYLES[t.severity] || STYLES.info;
          const Icon = s.icon;
          return (
            <div key={t.id} role="status" className="aura-toast pointer-events-auto relative overflow-hidden flex gap-3 p-4 pl-5 bg-white border border-gray-200 rounded-xl shadow-lg">
              <span className={`absolute left-0 inset-y-0 w-1 ${s.bar}`} />
              <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${s.tint}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-gray-900">{t.title}</p>
                {t.message && <p className="text-sm text-gray-600 mt-0.5 break-words">{t.message}</p>}
                {t.action && (
                  <button onClick={() => { t.action.onClick(); dismiss(t.id); }} className="mt-2 text-xs font-semibold text-indigo-600 hover:underline">
                    {t.action.label}
                  </button>
                )}
              </div>
              <button aria-label="Dismiss" onClick={() => dismiss(t.id)} className="self-start p-1 -m-1 text-gray-400 hover:text-gray-700">
                <X className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

