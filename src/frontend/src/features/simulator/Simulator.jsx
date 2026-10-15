import React, { useState } from 'react';
import InputForm, { validate, toPayload } from './InputForm';
import Results from './Results';
import ForecastPreview from './ForecastPreview';
import ScenarioCompare, { loadScenarios, storeScenarios, MAX_SCENARIOS } from './ScenarioCompare';
import CsvUpload from './CsvUpload';
import Explainer from './Explainer';
import Optimizer from '../optimizer/Optimizer';
import TalkToAura from '../agent/TalkToAura';
import ExportMenu from '../report/ExportMenu';
import Advisor from '../advisor/Advisor';
import { DEFAULTS, simulate, toMessage } from './simulatorApi';

export default function Simulator() {
  const [values, setValues] = useState({ ...DEFAULTS });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState(null);
  const [run, setRun] = useState(null); // { result, inputs, source }
  const [scenarios, setScenarios] = useState(loadScenarios);

  const update = (list) => {
    setScenarios(list);
    storeScenarios(list);
  };

  // `fromAgent` = a values object from Talk to AURA: fill the form, run it, and auto-open the explanation.
  const runSim = async (fromAgent) => {
    const vals = fromAgent?.servers !== undefined ? fromAgent : values;
    const auto = vals === fromAgent;
    if (auto) setValues(vals);
    const e = validate(vals);
    setErrors(e);
    if (Object.keys(e).length) return;
    setLoading(true);
    setApiError(null);
    try {
      const inputs = toPayload(vals);
      setRun({ result: await simulate(inputs), inputs, source: 'model', auto });
    } catch (x) {
      const m = toMessage(x);
      setApiError(m.message);
      if (m.field) setErrors({ [m.field]: m.message });
    } finally {
      setLoading(false);
    }
  };

  const save = () => {
    if (!run || scenarios.length >= MAX_SCENARIOS) return;
    update([...scenarios, { id: Date.now(), inputs: run.inputs, summary: run.result.summary }]);
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
      <TalkToAura values={values} onRun={runSim} busy={loading} />
      <InputForm values={values} onChange={setValues} onRun={() => runSim()} loading={loading} errors={errors} />
      {apiError && (
        <div role="alert" className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
          {apiError}
        </div>
      )}
      {run && (
        <>
          {run.source === 'upload' && <p className="text-sm text-yellow-800">Showing results for your uploaded CSV (experimental).</p>}
          <Results
            result={run.result}
            onSave={save}
            canSave={scenarios.length < MAX_SCENARIOS}
            actions={<ExportMenu result={run.result} inputs={run.inputs} />}
          />
          <Explainer result={run.result} autoStart={!!run.auto} />
          {scenarios.length >= MAX_SCENARIOS && <p className="text-xs text-gray-500">You have {MAX_SCENARIOS} saved scenarios. Remove one to save another.</p>}
        </>
      )}
      <ScenarioCompare scenarios={scenarios} onRemove={(id) => update(scenarios.filter((s) => s.id !== id))} onClear={() => update([])} />
      <Optimizer values={values} onApply={(p) => setValues((v) => ({ ...v, ...p }))} />
      <Advisor />
      <ForecastPreview initialDate={values.startDate || DEFAULTS.startDate} />
      <CsvUpload
        values={values}
        onResult={(result) => {
          setApiError(null);
          setRun({ result, inputs: { ...toPayload(values), startDate: result.hourly[0]?.ts.slice(0, 10), endDate: result.hourly.at(-1)?.ts.slice(0, 10) }, source: 'upload' });
        }}
      />
    </div>
  );
}
