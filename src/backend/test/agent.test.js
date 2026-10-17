import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { parseRequest, ruleBasedParse, sanitize } from '../src/agent.js';

const p = (text) => ruleBasedParse(text).params;

describe('rule-based parser', () => {
  test('exam week, servers, dirty grid', () => {
    const r = p('Simulate exam week with 30 servers on a dirty grid');
    assert.equal(r.servers, 30);
    assert.equal(r.carbonGrid, 'high');
    assert.deepEqual(r.events, ['exam']);
    assert.equal(r.startDate, '2019-08-12');
    assert.equal(r.endDate, '2019-08-18');
  });
  test('date range with month names', () => {
    const r = p('Run 100 servers from 5 Aug to 12 Aug 2019');
    assert.equal(r.servers, 100);
    assert.equal(r.startDate, '2019-08-05');
    assert.equal(r.endDate, '2019-08-12');
  });
  test('month first range', () => {
    const r = p('What about September 2 - September 8 with a clean grid?');
    assert.equal(r.startDate, '2019-09-02');
    assert.equal(r.endDate, '2019-09-08');
    assert.equal(r.carbonGrid, 'low');
  });
  test('ISO dates', () => {
    const r = p('simulate 2019-03-04 to 2019-03-10');
    assert.equal(r.startDate, '2019-03-04');
    assert.equal(r.endDate, '2019-03-10');
  });
  test('whole month', () => {
    const r = p('Show me March 2019 with 20 servers');
    assert.equal(r.startDate, '2019-03-01');
    assert.equal(r.endDate, '2019-03-31');
    assert.equal(r.servers, 20);
  });
  test('month without year picks a year that has data', () => {
    assert.equal(p('November with 10 servers').startDate, '2018-11-01');
    assert.equal(p('in September with 10 servers').startDate, '2019-09-01');
  });
  test('India grid and deferrable percent', () => {
    const r = p('50 servers on the India grid, 60% of the work is deferrable');
    assert.equal(r.carbonGrid, 'india');
    assert.equal(r.deferrableShare, 0.6);
  });
  test('UK grid maps to low carbon with an assumption', () => {
    const out = ruleBasedParse('a week on the UK grid');
    assert.equal(out.params.carbonGrid, 'low');
    assert.ok(out.assumptions.some((a) => /UK/.test(a)));
  });
  test('break and holiday together', () => {
    const r = p('Semester break and a public holiday, 15 servers');
    assert.deepEqual(r.events, ['break', 'holiday']);
  });
  test('unplanned surge', () => {
    assert.deepEqual(p('what if an unexpected conference spike hits, 40 servers').events, ['event']);
  });
  test('watts', () => {
    const r = p('servers idle at 80 W and peak 300 watts, 25 servers');
    assert.equal(r.idleWatts, 80);
    assert.equal(r.peakWatts, 300);
  });
  test('duration in days from default start', () => {
    const r = p('simulate 10 days with 12 servers');
    assert.equal(r.startDate, '2019-08-12');
    assert.equal(r.endDate, '2019-08-21');
  });
  test('out-of-range values are clamped and reported', () => {
    const out = ruleBasedParse('5000 servers in January 2025');
    assert.equal(out.params.servers, 1000);
    assert.ok(out.params.startDate >= '2018-07-15' && out.params.endDate <= '2019-10-21');
    assert.ok(out.assumptions.length >= 2);
  });
  test('gibberish is not understood', () => {
    const out = ruleBasedParse('hello how are you');
    assert.deepEqual(out.params, {});
    assert.equal(out.confidence, 'low');
  });
});

describe('sanitize', () => {
  test('clamps ranges and filters bad enums', () => {
    const { params } = sanitize({ servers: 0, idleWatts: 9999, peakWatts: 5, deferrableShare: 45, carbonGrid: 'purple', events: ['exam', 'x', 'exam'] });
    assert.equal(params.servers, 1);
    assert.equal(params.idleWatts, 500);
    assert.equal(params.peakWatts, 501);
    assert.equal(params.deferrableShare, 0.45);
    assert.equal(params.carbonGrid, undefined);
    assert.deepEqual(params.events, ['exam']);
  });
  test('limits span to 31 days and swaps reversed dates', () => {
    const { params } = sanitize({ startDate: '2019-09-30', endDate: '2019-01-01' });
    assert.equal(params.startDate, '2019-01-01');
    assert.equal(params.endDate, '2019-01-31');
  });
});

describe('POST /api/agent/parse (no API key)', () => {
  for (const k of ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY']) delete process.env[k];
  const post = async (body) => {
    const server = createApp({ store: { get: async () => [] } }).listen(0);
    await new Promise((r) => server.once('listening', r));
    try {
      const res = await fetch(`http://localhost:${server.address().port}/api/agent/parse`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      return { status: res.status, body: await res.json() };
    } finally { server.close(); }
  };
  test('works without an API key', async () => {
    const r = await post({ text: 'exam week with 30 servers on a dirty grid' });
    assert.equal(r.status, 200);
    assert.equal(r.body.source, 'rules');
    assert.equal(r.body.params.servers, 30);
    assert.ok(r.body.understood.length >= 3);
  });
  test('400 for empty text, 422 for gibberish', async () => {
    assert.equal((await post({ text: '  ' })).status, 400);
    const r = await post({ text: 'blah blah' });
    assert.equal(r.status, 422);
    assert.equal(r.body.error.field, 'text');
  });
  test('parseRequest falls back to rules', async () => {
    assert.equal((await parseRequest('20 servers')).source, 'rules');
  });
});

