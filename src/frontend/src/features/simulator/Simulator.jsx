import React, { useState } from 'react';
import InputForm, { validate, toPayload } from './InputForm';
import Results from './Results';
import { DEFAULTS, simulate, toMessage } from './simulatorApi';

export default function Simulator() {
  const [values, setValues] = useState({ ...DEFAULTS });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState(null);
  const [result, setResult] = useState(null);

  const run = async () => {
    const e = validate(values);
    setErrors(e);
    if (Object.keys(e).length) return;
    setLoading(true);
    setApiError(null);
    try {
      setResult(await simulate(toPayload(values)));
    } catch (x) {
      const m = toMessage(x);
      setApiError(m.message);
      if (m.field) setErrors({ [m.field]: m.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Simulator</h1>
        <p className="text-gray-600 text-sm">
          Describe your servers and a time period. AURA forecasts demand with the trained model and shows what
          carbon-aware scheduling would save.
        </p>
      </div>
      <InputForm values={values} onChange={setValues} onRun={run} loading={loading} errors={errors} />
      {apiError && (
        <div role="alert" className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
          {apiError}
        </div>
      )}
      {result && <Results result={result} />}
    </div>
  );
}
