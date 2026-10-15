// Integration test for the interactive API. Run against a live server:
//   API_URL=http://localhost:3000 node --test tests/
// Without API_URL it starts the contract mock server on a free port.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

let base = process.env.API_URL;
let child;

before(async () => {
  if (base) return;
  const port = 3900 + Math.floor(Math.random() * 90);
  const server = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'mock-server', 'server.js');
  child = spawn(process.execPath, [server], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  base = `http://localhost:${port}`;
  for (let i = 0; i < 40; i++) {
    try {
      await fetch(base + '/api/forecast/preview?date=2025-03-10');
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('mock server did not start');
});
after(() => child?.kill());

const post = (body) =>
  fetch(base + '/api/simulate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const A = { startDate: '2025-03-10', endDate: '2025-03-12', servers: 50, idleWatts: 100, peakWatts: 250, deferrableShare: 0.3, carbonGrid: 'medium', events: [] };

test('simulate returns the contract shape', async () => {
  const res = await post(A);
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.hourly.length, 72);
  for (const k of ['ts', 'demandKw', 'serversOn', 'energyKwh', 'baselineKwh', 'co2G', 'baselineCo2G', 'carbonIntensity'])
    assert.equal(typeof j.hourly[0][k], k === 'ts' ? 'string' : 'number', k);
  for (const k of ['energySavedKwh', 'co2SavedKg', 'costSaved', 'slaPct']) assert.equal(typeof j.summary[k], 'number', k);
  assert.ok(Array.isArray(j.recommendations) && j.recommendations.every((r) => typeof r === 'string'));
});

test('different inputs produce different outputs', async () => {
  const a = await (await post(A)).json();
  const b = await (await post({ ...A, servers: 200, carbonGrid: 'high', deferrableShare: 0.8, events: ['exam'] })).json();
  assert.notDeepEqual(a.summary, b.summary);
  assert.notEqual(a.summary.co2SavedKg, b.summary.co2SavedKg);
  assert.notDeepEqual(a.hourly.map((h) => h.serversOn), b.hourly.map((h) => h.serversOn));
  const c = await (await post({ ...A, carbonGrid: 'low' })).json();
  assert.notEqual(a.hourly[0].carbonIntensity, c.hourly[0].carbonIntensity);
});

test('invalid input returns the contract error format', async () => {
  const res = await post({ ...A, servers: 0 });
  assert.equal(res.status, 400);
  const j = await res.json();
  assert.equal(j.error.code, 'VALIDATION_ERROR');
  assert.equal(typeof j.error.message, 'string');
});

test('forecast preview returns 24 hourly rows', async () => {
  const j = await (await fetch(base + '/api/forecast/preview?date=2025-03-10')).json();
  assert.equal(j.hourly.length, 24);
  assert.equal(typeof j.hourly[0].forecastKw, 'number');
});

test('upload accepts a CSV and rejects a bad one', async () => {
  const csv = 'timestamp,kw\n' + Array.from({ length: 24 }, (_, h) => `2025-03-10T${String(h).padStart(2, '0')}:00:00Z,${5 + h}`).join('\n');
  const form = new FormData();
  form.append('file', new Blob([csv], { type: 'text/csv' }), 'load.csv');
  const ok = await fetch(base + '/api/upload', { method: 'POST', body: form });
  assert.equal(ok.status, 200);
  const j = await ok.json();
  assert.equal(j.hourly.length, 24);
  assert.ok(Array.isArray(j.warnings));

  const bad = new FormData();
  bad.append('file', new Blob(['hello world'], { type: 'text/csv' }), 'bad.csv');
  const r = await fetch(base + '/api/upload', { method: 'POST', body: bad });
  assert.ok([400, 422].includes(r.status));
  assert.equal(typeof (await r.json()).error.message, 'string');
});
