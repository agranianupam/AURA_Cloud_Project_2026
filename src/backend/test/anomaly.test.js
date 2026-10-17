import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { analyze, detect, injectFault, validateRequest } from '../src/anomaly.js';

function series(days = 7, noise = 0.08) {
  const pts = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let d = 0; d < days; d++) {
    for (let h = 0; h < 24; h++) {
      const f = 150 + (h >= 8 && h <= 18 ? 300 : 0);
      const ts = new Date(Date.UTC(2019, 7, 12 + d, h)).toISOString();
      pts.push({ ts, forecastKw: f, actualKw: Math.round((f * (1 + noise * rnd())) * 100) / 100 });
    }
  }
  return pts;
}
const at = (pts, day, hour) => pts.findIndex((p) => p.ts.startsWith(`2019-08-${12 + day}T${String(hour).padStart(2, '0')}`));

describe('detect', () => {
  test('a clean series has no incidents', () => {
    const r = detect(series());
    assert.equal(r.incidents.length, 0);
    assert.equal(r.summary.flaggedHours, 0);
  });
  test('an injected spike is detected as one spike incident', () => {
    const pts = series();
    const i = at(pts, 3, 13);
    for (let j = 0; j < 3; j++) pts[i + j] = { ...pts[i + j], actualKw: pts[i + j].forecastKw * 1.9 };
    const r = detect(pts);
    assert.equal(r.incidents.length, 1);
    const inc = r.incidents[0];
    assert.equal(inc.direction, 'spike');
    assert.equal(inc.hours, 3);
    assert.equal(inc.start, pts[i].ts);
    assert.ok(['warning', 'critical'].includes(inc.severity));
  });
  test('a dropout is detected as a drop', () => {
    const pts = series();
    const i = at(pts, 2, 10);
    pts[i] = { ...pts[i], actualKw: 5 };
    const r = detect(pts);
    assert.equal(r.incidents.length, 1);
    assert.equal(r.incidents[0].direction, 'drop');
  });
  test('separated flagged hours become separate incidents', () => {
    const pts = series();
    for (const [d, h] of [[1, 10], [4, 14]]) {
      const i = at(pts, d, h);
      pts[i] = { ...pts[i], actualKw: pts[i].forecastKw * 2 };
    }
    assert.equal(detect(pts).incidents.length, 2);
  });
  test('hours with no measurement are never flagged', () => {
    const pts = series().map((p, i) => (i % 5 === 0 ? { ...p, actualKw: null } : p));
    const r = detect(pts);
    assert.ok(r.points.filter((p) => p.actualKw == null).every((p) => !p.flagged));
  });
  test('higher sensitivity flags at least as many hours', () => {
    const pts = series(7, 0.2);
    assert.ok(detect(pts, { sensitivity: 'high' }).summary.flaggedHours >= detect(pts, { sensitivity: 'low' }).summary.flaggedHours);
  });
  test('points carry the threshold band', () => {
    const p = detect(series()).points[10];
    assert.ok(p.lowerKw < p.forecastKw && p.upperKw > p.forecastKw);
  });
});

describe('injectFault', () => {
  test('marks only the affected actual values as synthetic and leaves the forecast alone', () => {
    const pts = series();
    const out = injectFault(pts, { type: 'spike', hours: 3 });
    const changed = out.filter((p) => p.synthetic);
    assert.equal(changed.length, 3);
    assert.ok(changed.every((p) => p.actualKw > p.originalKw));
    assert.deepEqual(out.map((p) => p.forecastKw), pts.map((p) => p.forecastKw));
    assert.equal(detect(out).incidents.filter((i) => i.synthetic).length, 1);
  });
  test('dropout is detected as synthetic drop', () => {
    const r = detect(injectFault(series(), { type: 'dropout', hours: 2 }));
    const inc = r.incidents.find((i) => i.synthetic);
    assert.ok(inc);
    assert.equal(inc.direction, 'drop');
  });
});

describe('validateRequest', () => {
  const bad = (body, field) => assert.throws(() => validateRequest(body), (e) => e.field === field);
  test('names the offending field', () => {
    bad({}, 'startDate');
    bad({ startDate: '2019-08-12', endDate: 'nope' }, 'endDate');
    bad({ startDate: '2019-08-12', endDate: '2019-08-01' }, 'endDate');
    bad({ startDate: '2019-08-01', endDate: '2019-09-30' }, 'endDate');
    bad({ startDate: '2019-08-12', sensitivity: 'extreme' }, 'sensitivity');
    bad({ startDate: '2019-08-12', inject: { type: 'meteor' } }, 'inject');
    bad({ startDate: '2019-08-12', inject: { type: 'spike', hours: 99 } }, 'inject');
    bad({ startDate: '2019-08-12', uploadId: '../etc' }, 'uploadId');
  });
  test('defaults endDate to startDate', () => {
    assert.equal(validateRequest({ startDate: '2019-08-12' }).days, 1);
  });
});

describe('analyze / POST /api/anomalies with a stub engine', () => {
  const engine = {
    preview: async (date) => ({
      hourly: series(1).map((p, h) => ({ ts: `${date}T${String(h).padStart(2, '0')}:00:00Z`, forecastKw: p.forecastKw, actualKw: date === '2019-08-20' ? null : p.actualKw })),
      warnings: [],
    }),
  };
  test('collects days and applies an injected fault', async () => {
    const r = await analyze(engine, { startDate: '2019-08-12', endDate: '2019-08-18', inject: { type: 'spike' } });
    assert.equal(r.points.length, 7 * 24);
    assert.equal(r.summary.injected.hoursAffected, 3);
    assert.ok(r.incidents.some((i) => i.synthetic));
  });
  test('rejects ranges with no measurements', async () => {
    await assert.rejects(analyze(engine, { startDate: '2019-08-20' }), (e) => e.field === 'startDate');
  });
  test('HTTP: 200 with data, 400 naming the field', async () => {
    const server = createApp({ store: { get: async () => [] }, engine }).listen(0);
    await new Promise((r) => server.once('listening', r));
    const post = async (body) => {
      const res = await fetch(`http://localhost:${server.address().port}/api/anomalies`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      return { status: res.status, body: await res.json() };
    };
    try {
      const ok = await post({ startDate: '2019-08-12', endDate: '2019-08-14' });
      assert.equal(ok.status, 200);
      assert.ok(Array.isArray(ok.body.incidents) && ok.body.points.length === 72 && ok.body.threshold && ok.body.summary);
      const err = await post({ startDate: 'x' });
      assert.equal(err.status, 400);
      assert.equal(err.body.error.field, 'startDate');
    } finally { server.close(); }
  });
});

