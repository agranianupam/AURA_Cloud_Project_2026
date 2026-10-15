import React, { useState } from 'react';
import { Upload, Loader2, AlertTriangle } from 'lucide-react';
import { uploadCsv, toMessage } from './simulatorApi';
import { validate } from './InputForm';

const MAX_BYTES = 5 * 1024 * 1024;

// Returns an error string or null. Cheap client-side checks before sending anything.
export function checkCsvFile(file) {
  if (!file) return 'Choose a CSV file first.';
  if (!/\.csv$/i.test(file.name)) return 'That does not look like a CSV file. Please choose a .csv file.';
  if (file.size === 0) return 'The file is empty.';
  if (file.size > MAX_BYTES) return 'The file is larger than 5 MB. Please upload a smaller range.';
  return null;
}

export default function CsvUpload({ values, onResult }) {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const send = async () => {
    const fileErr = checkCsvFile(file);
    const formErr = validate(values, { dates: false });
    if (fileErr) return setError(fileErr);
    if (Object.keys(formErr).length) return setError('Fix the server inputs above first: ' + Object.values(formErr)[0]);
    setLoading(true);
    setError(null);
    try {
      onResult(await uploadCsv(file, values));
    } catch (e) {
      setError(toMessage(e).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">Use your own data</h2>
        <span className="text-xs font-semibold uppercase bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded">Experimental</span>
      </div>
      <div className="flex gap-2 bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        <span>
          The model was trained on one university building dataset. Results for your own data are indicative only. Upload a CSV with the
          header <code>timestamp,kw</code> (e.g. <code>2019-08-12T00:00:00Z,12.5</code>), covering 16 to 31 days (the model needs two weeks of history) and at most 5 MB. Server inputs above are used.
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          accept=".csv,text/csv"
          aria-label="CSV file"
          onChange={(e) => {
            setFile(e.target.files?.[0] || null);
            setError(null);
          }}
          className="text-sm"
        />
        <button onClick={send} disabled={loading} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 text-sm hover:bg-gray-50 disabled:opacity-60">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          {loading ? 'Analysing…' : 'Upload and run'}
        </button>
      </div>
      {error && (
        <div role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
          {error}
        </div>
      )}
    </div>
  );
}
