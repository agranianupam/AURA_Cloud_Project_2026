import React, { useState } from 'react';
import { Download, FileText, Table2 } from 'lucide-react';
import { exportCsv } from './exportCsv';
import { openReport } from './reportHtml';

export default function ExportMenu({ result, inputs }) {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState(null);

  const doCsv = () => {
    setOpen(false);
    exportCsv(result, inputs);
    setMsg(null);
  };
  const doReport = () => {
    setOpen(false);
    setMsg(openReport(result, inputs) ? null : 'Your browser blocked the report window. Allow pop-ups for this site and try again.');
  };

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50"
      >
        <Download className="w-4 h-4" /> Export
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1 text-sm">
          <button role="menuitem" onClick={doCsv} className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center gap-2">
            <Table2 className="w-4 h-4" /> Data (CSV)
          </button>
          <button role="menuitem" onClick={doReport} className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center gap-2">
            <FileText className="w-4 h-4" /> Report (print / PDF)
          </button>
        </div>
      )}
      {msg && (
        <p role="alert" className="absolute right-0 mt-1 w-64 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2 z-20">
          {msg}
        </p>
      )}
    </div>
  );
}

