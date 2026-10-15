import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, Loader2, Send } from 'lucide-react';
import { explainResult, toMessage } from './simulatorApi';

const SUGGESTIONS = ['Is this result good?', 'What does SLA mean?', 'Why did carbon drop?', 'How accurate is the forecast?', 'How can I improve this?'];

// Render **bold**, and lines wrapped in _underscores_ as italic, without a markdown library.
function Rich({ text }) {
  return text.split('\n').map((line, i) => {
    const italic = line.length > 2 && line.startsWith('_') && line.endsWith('_');
    const body = italic ? line.slice(1, -1) : line;
    const parts = body.split(/(\*\*[^*]+\*\*)/g).map((part, j) => (part.startsWith('**') ? <strong key={j}>{part.slice(2, -2)}</strong> : part));
    return <p key={i} className={`mb-2 last:mb-0 ${italic ? 'italic text-gray-500' : ''}`}>{parts}</p>;
  });
}

export default function Explainer({ result }) {
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [source, setSource] = useState(null);
  const endRef = useRef(null);

  // A new run means a new conversation.
  useEffect(() => {
    setMessages([]);
    setError(null);
    setSource(null);
  }, [result]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages, loading]);

  const ask = async (q) => {
    const text = q?.trim() || '';
    setLoading(true);
    setError(null);
    const history = messages;
    if (text) setMessages((m) => [...m, { role: 'user', content: text }]);
    try {
      const res = await explainResult(result, text || undefined, history);
      setSource(res.source);
      setMessages((m) => [...m, { role: 'assistant', content: res.answer }]);
    } catch (e) {
      setError(toMessage(e).message);
    } finally {
      setLoading(false);
      setQuestion('');
    }
  };

  return (
    <div className="bg-white p-5 rounded-xl shadow-sm border border-indigo-100 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="w-5 h-5 text-indigo-600" />
        <h2 className="text-lg font-semibold">AURA Explainer</h2>
        {source && (
          <span className="text-xs font-semibold uppercase bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded">
            {source === 'claude' ? 'AI' : 'Built-in'}
          </span>
        )}
      </div>
      <p className="text-sm text-gray-500">Not sure what these numbers mean? Get a plain-language explanation of this run, or ask a question about it.</p>

      {messages.length > 0 && (
        <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
          {messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
              <div className={`inline-block max-w-full text-left text-sm rounded-lg px-3 py-2 ${m.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-gray-50 border border-gray-100 text-gray-800'}`}>
                <Rich text={m.content} />
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Thinking…
        </div>
      )}
      {error && <div role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{error}</div>}

      {messages.length === 0 && !loading && (
        <button onClick={() => ask('')} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm hover:bg-indigo-700">
          <Sparkles className="w-4 h-4" /> Explain this result
        </button>
      )}

      <div className="flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button key={s} disabled={loading} onClick={() => ask(s)} className="text-xs px-3 py-1 rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-60">
            {s}
          </button>
        ))}
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (question.trim() && !loading) ask(question);
        }}
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={500}
          placeholder="Ask about this result…"
          aria-label="Ask the explainer"
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
        />
        <button type="submit" disabled={loading || !question.trim()} aria-label="Send" className="px-3 py-2 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-60">
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}
