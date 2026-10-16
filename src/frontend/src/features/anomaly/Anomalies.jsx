import React, { useState } from 'react';
import { ResponsiveContainer, ComposedChart, Line, Area, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ReferenceArea } from 'recharts';
import { Activity, Loader2, Play, Sparkles, FlaskConical } from 'lucide-react';
import { detectAnomalies } from './anomalyApi';
import { explainResult, toMessage } from '../simulator/simulatorApi';

const SEVERITY = {
  critical: 'bg-red-100 text-red-700 border-red-200',
  warning: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  info: 'bg-blue-100 text-blue-700 border-blue-200',
};
const DEFAULT_START = '2019-08-12';
const DEFAULT_END = '2019-08-18';

// ts is the building's local wall-clock time with a Z suffix: show it as written.
const label = (ts) => `${ts.slice(5, 10)} ${ts.slice(11, 16)}`;

function Rich({ text }) {
  return text.split('\n').filter(Boolean).map((line, i) => {
    const italic = line.length > 2 && line.startsWith('_') && line.endsWith('_');
    const parts = (italic ? line.slice(1, -1) : line).split(/(\*\*[^*]+\*\*)/g).map((p, j) => (p.startsWith('**') ? <strong key={j}>{p.slice(2, -2)}</strong> : p));
    return <p key={i} className={`mb-2 last:mb-0 ${italic ? 'italic text-gray-500' : ''}`}>{parts}</p>;
  });
}

export default function Anomalies({ upload }) {
  const [useUpload, setUseUpload] = useState(false);
  const [startDate, setStartDate] = useState(DEFAULT_START);
  const [endDate, setEndDate] = useState(DEFAULT_END);
  const [sensitivity, setSensitivity] = useState('medium');
  const [inject, setInject] = useState(false);
  const [faultType, setFaultType] = useState('spike');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [answer, setAnswer] = useState(null); // { id, text, source, note } | { id, loading } | { id, error }

  const uploadActive = !!upload?.uploadId && useUpload;

  const run = async () => {
    setLoading(true);
    setError(null);
    setAnswer(null);
    try {
      const body = { startDate, endDate, sensitivity };
      if (uploadActive) body.uploadId = upload.uploadId;
      if (inject) body.inject = { type: faultType, hours: 3 };
      setData(await detectAnomalies(body));
    } catch (e) {
      setError(toMessage(e).message);
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const ask = async (incident) => {
    const id = incident?.id ?? 0;
    setAnswer({ id, loading: true });
    const question = incident
      ? `Explain this ${incident.severity} ${incident.direction} incident (${incident.start.slice(0, 16)}): what could have caused it and what should I check?`
      : 'Summarise the anomalies found and what they could mean.';
    try {
      const res = await explainResult(
        { anomalies: { incident, incidents: data.incidents, summary: data.summary, threshold: data.threshold, params: data.params } },
        question,
      );
      setAnswer({ id, text: res.answer, source: res.source, note: res.note });
    } catch (e) {
      setAnswer({ id, error: toMessage(e).message });
    }
  };

  const toggleUpload = (checked) => {
    setUseUpload(checked);
    if (checked && upload?.simulateFrom) {
      setStartDate(upload.simulateFrom.slice(0, 10));
      setEndDate(new Date(Math.min(Date.parse(upload.simulateTo ?? upload.simulateFrom), Date.parse(upload.simulateFrom) + 6 * 86400000)).toISOString().slice(0, 10));
    } else if (!checked) {
      setStartDate(DEFAULT_START);
      setEndDate(DEFAULT_END);
    }
  };

  const rows = (data?.points ?? []).map((p) => ({
    ts: p.ts,
    t: label(p.ts),
    forecastKw: p.forecastKw,
    actualKw: p.actualKw,
    band: [p.lowerKw, p.upperKw],
    flagged: p.flagged && !p.synthetic ? p.actualKw : null,
    fault: p.flagged && p.synthetic ? p.actualKw : null,
  }));
  const tick = Math.max(0, Math.floor(rows.length / 8) - 1);
  const input = 'rounded-lg border border-gray-300 px-3 py-2 text-sm';

  return (
    <div className="bg-white p-5 rounded-xl shadow-sm border border-red-100 space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-red-600" />
          <h2 className="text-lg font-semibold">Anomalies</h2>
        </div>
        <p className="text-sm text-gray-500 mt-1">
          Finds hours where the real load differs strongly from the model&apos;s forecast, such as a cooling fault or an unplanned event.
          The shaded band is the normal range; red dots fall outside it.
        </p>
      </div>

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <label className="text-sm">
          <span className="block text-gray-700 font-medium">From</span>
          <input type="date" className={input} value={startDate} min="2018-07-15" max="2019-10-21" onChange={(e) => setStartDate(e.target.value)} aria-label="Anomaly start date" />
        </label>
        <label className="text-sm">
          <span className="block text-gray-700 font-medium">To</span>
          <input type="date" className={input} value={endDate} min="2018-07-15" max="2019-10-21" onChange={(e) => setEndDate(e.target.value)} aria-label="Anomaly end date" />
        </label>
        <label className="text-sm">
          <span className="block text-gray-700 font-medium">Sensitivity</span>
          <select className={input} value={sensitivity} onChange={(e) => setSensitivity(e.target.value)} aria-label="Sensitivity">
            <option value="low">Low (fewer alerts)</option>
            <option value="medium">Medium</option>
            <option value="high">High (more alerts)</option>
          </select>
        </label>
        <button type="submit" disabled={loading} className="inline-flex items-center gap-2 bg-red-600 text-white px-5 py-2 rounded-lg text-sm hover:bg-red-700 disabled:opacity-60">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          {loading ? 'Scanning…' : 'Scan for anomalies'}
        </button>
      </form>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={inject} onChange={(e) => setInject(e.target.checked)} />
          <FlaskConical className="w-4 h-4 text-orange-600" /> Inject a test fault
        </label>
        {inject && (
          <select className={input} value={faultType} onChange={(e) => setFaultType(e.target.value)} aria-label="Fault type">
            <option value="spike">Spike (load jumps up for 3 h)</option>
            <option value="dropout">Dropout (load falls to near zero for 3 h)</option>
          </select>
        )}
        {upload?.uploadId && (
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={useUpload} onChange={(e) => toggleUpload(e.target.checked)} /> Use my uploaded CSV
          </label>
        )}
      </div>
      {inject && <p className="text-xs text-orange-800 bg-orange-50 border border-orange-200 rounded-lg p-2">Synthetic fault: the measured series is altered on purpose for this scan. It is not real data.</p>}

      {error && <div role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{error}</div>}
      {loading && <div className="h-64 bg-gray-100 animate-pulse rounded-lg" />}

      {!loading && data && (
        <>
          <div className="flex flex-wrap gap-4 text-sm text-gray-700">
            <span><strong>{data.summary.incidents}</strong> incident(s)</span>
            <span><strong>{data.summary.flaggedHours}</strong> of {data.summary.actualHours} hours flagged</span>
            <span>Typical forecast error <strong>{data.summary.maeKw} kW</strong></span>
            <span>Normal band ±<strong>{Math.round(data.threshold.sigmaKw * data.threshold.k)} kW</strong> (min {data.threshold.minRelPct}% of forecast)</span>
          </div>
          {data.warnings?.length > 0 && <p className="text-xs text-yellow-800">{data.warnings.join(' ')}</p>}

          <div className="h-72">
            <ResponsiveContainer>
              <ComposedChart data={rows}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="t" tick={{ fontSize: 11 }} interval={tick} />
                <YAxis tick={{ fontSize: 11 }} unit=" kW" width={64} />
                <Tooltip />
                <Legend />
                {data.incidents.map((i) => (
                  <ReferenceArea key={i.id} x1={label(i.start)} x2={label(i.end)} fill={i.synthetic ? '#f97316' : '#ef4444'} fillOpacity={0.12} />
                ))}
                <Area type="monotone" dataKey="band" name="Normal range" stroke="none" fill="#93c5fd" fillOpacity={0.3} isAnimationActive={false} />
                <Line type="monotone" dataKey="forecastKw" name="Forecast" stroke="#2563eb" dot={false} strokeWidth={1.5} isAnimationActive={false} />
                <Line type="monotone" dataKey="actualKw" name="Actual" stroke="#f59e0b" dot={false} strokeWidth={1.5} connectNulls={false} isAnimationActive={false} />
                <Line dataKey="flagged" name="Flagged hour" stroke="none" dot={{ r: 4, fill: '#dc2626', stroke: '#dc2626' }} activeDot={{ r: 5 }} legendType="circle" isAnimationActive={false} />
                {data.summary.injected && (
                  <Line dataKey="fault" name="Flagged (synthetic fault)" stroke="none" dot={{ r: 4, fill: '#ea580c', stroke: '#ea580c' }} activeDot={{ r: 5 }} legendType="circle" isAnimationActive={false} />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {data.incidents.length === 0 ? (
            <p className="text-sm text-green-800 bg-green-50 border border-green-200 rounded-lg p-3">
              No anomalies: the measured load stayed inside the normal range for this period. Try &quot;Inject a test fault&quot; to see detection in action.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs uppercase text-gray-600 bg-gray-50">
                  <tr>
                    <th className="px-3 py-2">When</th>
                    <th className="px-3 py-2">Length</th>
                    <th className="px-3 py-2">Size</th>
                    <th className="px-3 py-2">Severity</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {data.incidents.map((i) => (
                    <tr key={i.id} className="border-b border-gray-100 align-top">
                      <td className="px-3 py-2 whitespace-nowrap">
                        {label(i.start)}
                        {i.synthetic && <span className="ml-2 text-[10px] uppercase font-bold text-orange-700 bg-orange-50 border border-orange-200 rounded px-1">synthetic</span>}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{i.hours} h</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {i.direction === 'spike' ? '▲' : '▼'} {Math.abs(Math.round(i.peakDeviationKw))} kW ({Math.abs(Math.round(i.peakDeviationPct ?? 0))}%)
                      </td>
                      <td className="px-3 py-2">
                        <span className={`text-xs uppercase font-bold px-2 py-0.5 rounded-full border ${SEVERITY[i.severity]}`}>{i.severity}</span>
                      </td>
                      <td className="px-3 py-2">
                        <button onClick={() => ask(i)} disabled={answer?.loading} className="inline-flex items-center gap-1 text-xs px-3 py-1 rounded-full bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-60">
                          <Sparkles className="w-3 h-3" /> Ask the Explainer about this incident
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {answer && (
            <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3 text-sm text-gray-800" aria-live="polite">
              {answer.loading && <span className="inline-flex items-center gap-2 text-gray-500"><Loader2 className="w-4 h-4 animate-spin" /> Thinking…</span>}
              {answer.error && <span role="alert" className="text-red-700">{answer.error}</span>}
              {answer.text && (
                <>
                  <Rich text={answer.text} />
                  {answer.note && <p className="text-xs text-yellow-800">{answer.note}</p>}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
