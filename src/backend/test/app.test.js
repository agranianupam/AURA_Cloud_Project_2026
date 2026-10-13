import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';

const energy = Array.from({ length: 200 }, (_, i) => ({ timestamp: `t${i}`, energyKwh: i }));
const data = {
  energy,
  savings: { energySavedKwh: 10, carbonSavedKg: 4, costSaved: 1.2, percentReduction: 30, slaCompliancePct: 99.9, assumptions: { pue: 1.5 } },
  allocations: [
    { resourceId: 'a', status: 'Running' },
    { resourceId: 'b', status: 'Stopped' },
  ],
  alerts: [
    { timestamp: '2', severity: 'critical' },
    { timestamp: '1', severity: 'info' },
  ],
};
const store = {
  async get(name) {
    if (!(name in data)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    return data[name];
  },
};
const denyAll = (req, res) => res.status(401).json({ error: 'nope' });

let server;
let base;
before(async () => {
  server = createApp({ store }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

const get = async (p) => {
  const res = await fetch(base + p);
  return { status: res.status, body: await res.json() };
};

test('energy defaults to the last 168 hours and honours ?hours', async () => {
  let { status, body } = await get('/api/metrics/energy');
  assert.equal(status, 200);
  assert.equal(body.length, 168);
  assert.equal(body.at(-1).timestamp, 't199');
  ({ body } = await get('/api/metrics/energy?hours=24'));
  assert.equal(body.length, 24);
  ({ body } = await get('/api/metrics/energy?hours=abc'));
  assert.equal(body.length, 168);
});

test('savings hides assumptions unless details=true', async () => {
  let { body } = await get('/api/metrics/savings');
  assert.equal(body.percentReduction, 30);
  assert.equal(body.assumptions, undefined);
  ({ body } = await get('/api/metrics/savings?details=true'));
  assert.equal(body.assumptions.pue, 1.5);
});

test('allocations and alerts filter', async () => {
  assert.equal((await get('/api/allocations')).body.length, 2);
  assert.deepEqual((await get('/api/allocations?status=Running')).body.map((a) => a.resourceId), ['a']);
  assert.equal((await get('/api/alerts?severity=info')).body.length, 1);
  assert.equal((await get('/api/alerts?limit=1')).body.length, 1);
});

test('missing dataset returns 503, unknown route 404, health is open', async () => {
  assert.equal((await get('/api/forecast')).status, 503);
  assert.equal((await get('/api/nope')).status, 404);
  assert.equal((await get('/api/health')).status, 200);
});

test('auth middleware guards /api routes but not health', async () => {
  const guarded = createApp({ store, auth: denyAll }).listen(0);
  await new Promise((r) => guarded.once('listening', r));
  const url = `http://localhost:${guarded.address().port}`;
  try {
    assert.equal((await fetch(`${url}/api/metrics/savings`)).status, 401);
    assert.equal((await fetch(`${url}/api/health`)).status, 200);
  } finally {
    guarded.close();
  }
});
