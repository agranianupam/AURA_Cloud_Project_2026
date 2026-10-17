import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { EngineError, PythonEngine, findPython } from '../src/engine.js';

const listen = async (engine) => {
  const server = createApp({ store: { get: async () => [] }, engine }).listen(0);
  await new Promise((r) => server.once('listening', r));
  return { server, base: `http://localhost:${server.address().port}` };
};
const post = async (base, p, body) => {
  const res = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const csvOf = (text) => {
  const form = new FormData();
  form.append('file', new Blob([text], { type: 'text/csv' }), 'load.csv');
  return form;
};

describe('endpoints with a stub engine', () => {
  const calls = [];
  const engine = {
    simulate: async (p) => {
      calls.push(['simulate', p]);
      if (p.servers === 0) throw new EngineError('validation', 'servers must be between 1 and 1000', 'servers');
      return { hourly: [], summary: {}, recommendations: [] };
    },
    preview: async (d) => {
      if (d === 'bad') throw new EngineError('validation', 'date must be a date', 'date');
      return { date: d, hourly: [] };
    },
    upload: async (csv, name, p) => {
      calls.push(['upload', csv, name, p]);
      if (csv.startsWith('nope')) throw new EngineError('csv', "the CSV needs the header 'timestamp,kw'", 'csv');
      if (csv.startsWith('long')) throw new EngineError('too_large', 'the series covers 40 days', 'csv');
      return { hourly: [], summary: {}, warnings: ['w'] };
    },
  };
  let ctx;
  before(async () => { ctx = await listen(engine); });
  after(() => ctx.server.close());

  test('POST /api/simulate passes the body to the engine', async () => {
    const r = await post(ctx.base, '/api/simulate', { servers: 10, events: ['exam'] });
    assert.equal(r.status, 200);
    assert.deepEqual(calls.at(-1), ['simulate', { servers: 10, events: ['exam'] }]);
  });

  test('validation errors become 400 with code, message and field', async () => {
    const r = await post(ctx.base, '/api/simulate', { servers: 0 });
    assert.equal(r.status, 400);
    assert.deepEqual(r.body, { error: { code: 'VALIDATION_ERROR', message: 'servers must be between 1 and 1000', field: 'servers' } });
  });

  test('non-object and malformed JSON bodies are 400', async () => {
    assert.equal((await post(ctx.base, '/api/simulate', [1])).status, 400);
    const res = await fetch(`${ctx.base}/api/simulate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, 'VALIDATION_ERROR');
  });

  test('GET /api/forecast/preview needs a valid date', async () => {
    assert.equal((await fetch(`${ctx.base}/api/forecast/preview`)).status, 400);
    assert.equal((await fetch(`${ctx.base}/api/forecast/preview?date=bad`)).status, 400);
    const ok = await fetch(`${ctx.base}/api/forecast/preview?date=2019-09-10`);
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).date, '2019-09-10');
  });

  test('POST /api/upload reads the multipart file and coerces form fields', async () => {
    const form = csvOf('timestamp,kw\n');
    form.append('servers', '20');
    form.append('events', 'exam,break');
    form.append('carbonShift', 'false');
    const res = await fetch(`${ctx.base}/api/upload`, { method: 'POST', body: form });
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).warnings, ['w']);
    const [, csv, name, params] = calls.at(-1);
    assert.equal(csv, 'timestamp,kw\n');
    assert.equal(name, 'load.csv');
    assert.deepEqual(params, { servers: 20, events: ['exam', 'break'], carbonShift: false });
  });

  test('upload errors map to 400 / 413 / 422', async () => {
    const noFile = await fetch(`${ctx.base}/api/upload`, { method: 'POST', body: new FormData() });
    assert.equal(noFile.status, 400);
    const bad = await fetch(`${ctx.base}/api/upload`, { method: 'POST', body: csvOf('nope') });
    assert.equal(bad.status, 422);
    assert.equal((await bad.json()).error.code, 'CSV_INVALID');
    const long = await fetch(`${ctx.base}/api/upload`, { method: 'POST', body: csvOf('long') });
    assert.equal(long.status, 413);
    assert.equal((await long.json()).error.code, 'TOO_LARGE');
  });

  test('files over 5 MB are rejected with 413', async () => {
    const res = await fetch(`${ctx.base}/api/upload`, { method: 'POST', body: csvOf('x'.repeat(5 * 1024 * 1024 + 10)) });
    assert.equal(res.status, 413);
  });

  test('engine failures are 503 in the contract shape', async () => {
    const c = await listen({ simulate: async () => { throw new EngineError('unavailable', 'engine down'); } });
    const r = await post(c.base, '/api/simulate', {});
    c.server.close();
    assert.equal(r.status, 503);
    assert.equal(r.body.error.code, 'INTERNAL');
  });
});

const python = findPython();
const hasPython = python.includes('.venv') && existsSync(python);
describe('endpoints with the real LSTM', { skip: !hasPython && 'no .venv python (see src/ml_model/README.md)' }, () => {
  let ctx;
  let engine;
  before(async () => {
    engine = new PythonEngine();
    ctx = await listen(engine);
  });
  after(() => { ctx.server.close(); engine.close(); });

  test('simulate returns contract-shaped, input-sensitive results', async () => {
    const a = await post(ctx.base, '/api/simulate', { startDate: '2019-09-02', endDate: '2019-09-04' });
    assert.equal(a.status, 200);
    assert.equal(a.body.hourly.length, 72);
    assert.equal(a.body.hourly[0].ts, '2019-09-02T00:00:00Z');
    for (const k of ['demandKw', 'serversOn', 'energyKwh', 'baselineKwh', 'co2G', 'baselineCo2G', 'carbonIntensity']) {
      assert.equal(typeof a.body.hourly[0][k], 'number', k);
    }
    assert.ok(a.body.summary.energySavedKwh > 0);
    assert.ok(a.body.summary.slaPct > 0 && a.body.summary.slaPct <= 100);
    assert.ok(a.body.recommendations.length <= 8);
    const b = await post(ctx.base, '/api/simulate', {
      startDate: '2019-09-02', endDate: '2019-09-04', servers: 200, carbonGrid: 'india', deferrableShare: 0.8, events: ['exam'],
    });
    assert.notEqual(b.body.summary.energySavedKwh, a.body.summary.energySavedKwh);
    assert.notEqual(b.body.hourly[10].carbonIntensity, a.body.hourly[10].carbonIntensity);
  });

  test('simulate rejects bad input with a clear 400', async () => {
    for (const [body, field] of [
      [{ servers: 0 }, 'servers'], [{ servers: 5.5 }, 'servers'], [{ idleWatts: 300, peakWatts: 200 }, 'peakWatts'],
      [{ deferrableShare: 2 }, 'deferrableShare'], [{ carbonGrid: 'mars' }, 'carbonGrid'], [{ events: ['party'] }, 'events'],
      [{ startDate: '2019-13-01' }, 'startDate'], [{ startDate: '2019-09-05', endDate: '2019-09-01' }, 'endDate'],
      [{ startDate: '2019-08-01', endDate: '2019-10-01' }, 'endDate'], [{ startDate: '2030-01-01', endDate: '2030-01-02' }, 'endDate'],
    ]) {
      const r = await post(ctx.base, '/api/simulate', body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal(r.body.error.code, 'VALIDATION_ERROR');
      assert.equal(r.body.error.field, field, JSON.stringify(body));
    }
  });

  test('forecast preview includes the real CU-BEMS reading', async () => {
    const res = await fetch(`${ctx.base}/api/forecast/preview?date=2019-09-10`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.hourly.length, 24);
    assert.ok(body.hourly.every((h) => typeof h.forecastKw === 'number' && typeof h.actualKw === 'number'));
    assert.equal((await fetch(`${ctx.base}/api/forecast/preview?date=2030-01-01`)).status, 400);
  });

  test('upload rescales a CSV and simulates it', async () => {
    const rows = ['timestamp,kw'];
    for (let h = 0; h < 24 * 20; h++) {
      const t = new Date(Date.UTC(2024, 2, 1) + h * 3600e3);
      const hour = t.getUTCHours();
      const weekend = [0, 6].includes(t.getUTCDay());
      rows.push(`${t.toISOString().slice(0, 19)},${(weekend ? 3 : 5) + (hour >= 8 && hour < 18 ? 10 : 0) + (h % 7) * 0.1}`);
    }
    const res = await fetch(`${ctx.base}/api/upload`, { method: 'POST', body: csvOf(rows.join('\n')) });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.ok(body.hourly.length >= 24);
    assert.ok(body.warnings.some((w) => /Rescaled/.test(w)));
    const bad = await fetch(`${ctx.base}/api/upload`, { method: 'POST', body: csvOf('time,power\n1,2\n') });
    assert.equal(bad.status, 422);
  });
});

