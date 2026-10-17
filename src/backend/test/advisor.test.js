import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { createAdvisor, findWindow, normalise, parseRequest, AdvisorError, PROFILE } from '../src/advisor.js';

const T0 = Date.parse('2024-05-01T10:00:00Z');
const iso = (ms) => new Date(ms).toISOString().slice(0, 16) + 'Z';

function payload(from = T0, n = 96) {
  return {
    data: Array.from({ length: n }, (_, i) => {
      const start = from + i * 1800000;
      const hours = (start - T0) / 3600000;
      return { from: iso(start), to: iso(start + 1800000), intensity: { forecast: hours >= 6 && hours < 9 ? 100 : 400, actual: null, index: 'x' } };
    }),
  };
}
const okFetch = (calls = []) => async (url, opts) => {
  calls.push({ url, opts });
  return { ok: true, status: 200, json: async () => payload() };
};
const job = { durationHours: 2, powerKw: 10 };

describe('parseRequest', () => {
  test('accepts powerKw or servers x watts, with defaults', () => {
    assert.deepEqual(parseRequest(job), { durationHours: 2, powerKw: 10, windowHours: 24, deadline: null });
    assert.equal(parseRequest({ durationHours: 1, servers: 20, serverWatts: 500 }).powerKw, 10);
    assert.equal(parseRequest({ durationHours: 1, servers: 4 }).powerKw, 1);
  });
  test('names the offending field', () => {
    const f = (b) => { try { parseRequest(b); } catch (e) { assert.ok(e instanceof AdvisorError); return e.field; } };
    assert.equal(f({ powerKw: 1 }), 'durationHours');
    assert.equal(f({ durationHours: 0 }), 'durationHours');
    assert.equal(f({ durationHours: 1 }), 'powerKw');
    assert.equal(f({ durationHours: 1, powerKw: -1 }), 'powerKw');
    assert.equal(f({ durationHours: 1, powerKw: 1, windowHours: 49 }), 'windowHours');
    assert.equal(f({ durationHours: 1, powerKw: 1, deadline: 'soon' }), 'deadline');
    assert.equal(f({ durationHours: 1, servers: 0 }), 'servers');
    assert.equal(f(null), undefined);
  });
});

describe('findWindow', () => {
  const slots = normalise(payload());
  test('picks the clean dip and computes CO2 = kWh x g/kWh / 1000', () => {
    const r = findWindow(slots, parseRequest(job));
    assert.equal(r.best.start, iso(T0 + 6 * 3600000));
    assert.equal(r.best.end, iso(T0 + 8 * 3600000));
    assert.equal(r.best.avgIntensity, 100);
    assert.equal(r.best.co2Kg, 2);
    assert.equal(r.now.start, iso(T0));
    assert.equal(r.now.co2Kg, 8);
    assert.equal(r.savingKg, 6);
    assert.equal(r.savingPct, 75);
  });
  test('a window shorter than the dip start excludes it', () => {
    const r = findWindow(slots, parseRequest({ ...job, windowHours: 3 }));
    assert.equal(r.best.start, iso(T0));
    assert.equal(r.savingKg, 0);
  });
  test('deadline caps the end of the job', () => {
    const r = findWindow(slots, parseRequest({ ...job, deadline: iso(T0 + 7 * 3600000) }));
    assert.ok(Date.parse(r.best.end) <= T0 + 7 * 3600000);
    assert.equal(r.best.start, iso(T0 + 5 * 3600000));
    assert.equal(r.best.avgIntensity, 250);
  });
  test('impossible deadline is a deadline error', () => {
    assert.throws(() => findWindow(slots, parseRequest({ ...job, deadline: iso(T0 + 3600000) })), (e) => e.field === 'deadline');
  });
  test('fractional durations are time-weighted across slots', () => {
    const r = findWindow(slots, parseRequest({ durationHours: 1.5, powerKw: 1, windowHours: 1 }));
    assert.equal(r.best.avgIntensity, 400);
    assert.equal(r.best.end, iso(T0 + 5400000));
  });
  test('never starts a job that would run past the data', () => {
    const r = findWindow(slots, parseRequest({ durationHours: 24, powerKw: 1, windowHours: 48 }));
    assert.ok(Date.parse(r.best.end) <= T0 + 48 * 3600000);
  });
  test('series is half-hourly intensity points', () => {
    const r = findWindow(slots, parseRequest(job));
    assert.equal(r.series[0].start, iso(T0));
    assert.equal(r.series[1].start, iso(T0 + 1800000));
    assert.equal(typeof r.series[0].intensity, 'number');
  });
});

describe('createAdvisor (mocked fetch)', () => {
  test('live: requests fw48h from the half-hour, normalises, caches for 10 minutes', async () => {
    const calls = [];
    let t = T0 + 5 * 60000;
    const advise = createAdvisor({ fetchFn: okFetch(calls), now: () => t });
    const a = await advise(job);
    assert.equal(a.source, 'live');
    assert.equal(a.cached, false);
    assert.match(calls[0].url, /\/intensity\/2024-05-01T10:00Z\/fw48h$/);
    assert.ok(calls[0].opts.signal, 'a timeout signal is passed');
    assert.equal(a.best.start, iso(T0 + 6 * 3600000));
    t += 5 * 60000;
    const b = await advise({ ...job, durationHours: 3 });
    assert.equal(b.cached, true);
    assert.equal(calls.length, 1);
    t += 6 * 60000;
    await advise(job);
    assert.equal(calls.length, 2);
  });

  for (const [name, fetchFn] of [
    ['network error', async () => { throw new TypeError('fetch failed'); }],
    ['HTTP 500', async () => ({ ok: false, status: 500, json: async () => ({}) })],
    ['garbage payload', async () => ({ ok: true, status: 200, json: async () => ({ data: [{ nope: 1 }] }) })],
    ['timeout', async () => { throw Object.assign(new Error('aborted'), { name: 'TimeoutError' }); }],
  ]) {
    test(`offline fallback on ${name}`, async () => {
      const a = await createAdvisor({ fetchFn, now: () => T0 })(job);
      assert.equal(a.source, 'profile');
      assert.match(a.notice, /offline - using typical profile/);
      assert.equal(a.series[0].intensity, PROFILE[new Date(T0).getUTCHours()]);
      assert.ok(a.best.avgIntensity <= a.now.avgIntensity);
    });
  }

  test('validation errors are thrown before any fetch', async () => {
    const calls = [];
    await assert.rejects(createAdvisor({ fetchFn: okFetch(calls), now: () => T0 })({ durationHours: 'x' }), (e) => e.field === 'durationHours');
    assert.equal(calls.length, 0);
  });
});

describe('POST /api/advisor', () => {
  let server, base;
  before(async () => {
    const app = createApp({ store: { get: async () => [] }, engine: null, advisor: createAdvisor({ fetchFn: okFetch(), now: () => T0 }) });
    await new Promise((r) => { server = app.listen(0, r); });
    base = `http://localhost:${server.address().port}/api`;
  });
  after(() => server.close());
  const post = (body) => fetch(`${base}/advisor`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  test('200 with the contract shape', async () => {
    const res = await post({ durationHours: 2, servers: 20, serverWatts: 500 });
    assert.equal(res.status, 200);
    const j = await res.json();
    for (const k of ['best', 'now', 'savingKg', 'savingPct', 'series', 'source', 'fetchedAt']) assert.ok(k in j, k);
    assert.equal(j.source, 'live');
    assert.ok(j.best.avgIntensity < j.now.avgIntensity);
  });
  test('400 names the field', async () => {
    const res = await post({ durationHours: 2 });
    assert.equal(res.status, 400);
    const j = await res.json();
    assert.equal(j.error.code, 'VALIDATION_ERROR');
    assert.equal(j.error.field, 'powerKw');
  });
  test('400 for a deadline that is too soon', async () => {
    const res = await post({ durationHours: 5, powerKw: 1, deadline: iso(T0 + 3600000) });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.field, 'deadline');
  });
});

