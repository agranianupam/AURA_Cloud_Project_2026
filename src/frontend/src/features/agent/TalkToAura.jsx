import React, { useState } from 'react';
import { MessageSquareText, Loader2, Send } from 'lucide-react';
import { parseAgentRequest } from './agentApi';
import { toMessage } from '../simulator/simulatorApi';

const EXAMPLES = [
  'Simulate exam week with 30 servers on a dirty grid',
  'A quiet semester break in December with 20 servers',
  '100 servers from 5 Aug to 12 Aug 2019, 60% of the work is deferrable',
  'One month in September on the India grid',
  'What if an unplanned surge hits 40 servers on a clean grid?',
];

// Plain-English box: parses the request, shows what was understood/assumed, then hands the inputs to onRun.
export default function TalkToAura({ values, onRun, busy }) {
  const [text, setText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState(null);
  const [strip, setStrip] = useState(null);

  const submit = async (request = text) => {
    const q = request.trim();
    if (!q || parsing || busy) return;
    setText(q);
    setParsing(true);
    setError(null);
    setStrip(null);
    try {
      const parsed = await parseAgentRequest(q);
      setStrip(parsed);
      const next = { ...values, ...parsed.params };
      if (!parsed.params.events) next.events = values.events;
      onRun(next);
    } catch (e) {
      setError(toMessage(e).message);
    } finally {
      setParsing(false);
    }
  };

  return (
    <div className="bg-white p-5 rounded-xl shadow-sm border border-green-100 space-y-3">
      <div className="flex items-center gap-2">
        <MessageSquareText className="w-5 h-5 text-green-600" />
        <h2 className="text-lg font-semibold">Talk to AURA</h2>
      </div>
      <p className="text-sm text-gray-500">
        Describe what you want in plain English. AURA fills in the inputs below, runs the simulation and explains the result.
      </p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
          placeholder="e.g. Simulate exam week with 30 servers on a dirty grid"
          aria-label="Describe your scenario"
          className="flex-1 min-w-0 border border-gray-300 rounded-lg px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={parsing || busy || !text.trim()}
          className="inline-flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700 disabled:opacity-60"
        >
          {parsing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          <span className="hidden sm:inline">{parsing ? 'Reading…' : 'Ask AURA'}</span>
        </button>
      </form>
      <div className="flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            disabled={parsing || busy}
            onClick={() => submit(ex)}
            className="text-xs text-left px-3 py-1 rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-60"
          >
            {ex}
          </button>
        ))}
      </div>

      {error && (
        <div role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
          {error}
        </div>
      )}
      {strip && (
        <div className="text-sm bg-green-50 border border-green-200 rounded-lg p-3 space-y-1" aria-live="polite">
          <p>
            <span className="font-semibold">I understood:</span> {strip.understood.join('; ') || 'nothing specific'}
            <span className="ml-2 text-xs uppercase bg-white border border-green-200 text-green-700 px-1.5 py-0.5 rounded">
              {strip.source === 'rules' ? 'built-in' : 'AI'}
            </span>
          </p>
          {strip.assumptions.length > 0 && (
            <p>
              <span className="font-semibold">I assumed:</span> {strip.assumptions.join(' ')}
            </p>
          )}
          {strip.note && <p className="text-xs text-yellow-800">{strip.note}</p>}
        </div>
      )}
    </div>
  );
}
