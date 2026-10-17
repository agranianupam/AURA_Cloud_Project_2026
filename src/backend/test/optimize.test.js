import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { paretoFront, parseRequest } from '../src/optimize.js';

let calls = 0;
const engine = {
  async simulate(p) {
    calls += 1;
    const servers = p.servers ?? 50;
    const headroom = p.headroom ?? 0.25;
    const share = p.deferrableShare ?? 0.3;
    const capacity = servers * (1 + headroom);
    const slaPct = Math.max(0, Math.min(100, 100 - Math.max(0, 40 - capacity) * 3));
    const energyKwh = 100 + servers * 2 + headroom * 50;
    const baselineKwh = (p.workloadServers ?? servers) * 6;
    const co2Kg = energyKwh * (0.5 - share * 0.3);
    return {
      params: { servers, headroom, deferrableShare: share, pricePerKwh: 0.12 },
      summary: { energyKwh, baselineKwh, co2Kg, baselineCo2Kg: baselineKwh * 0.5, slaPct, slaMissHours: 0, energySavedKwh: baselineKwh - energyKwh },
    };
  },
};

describe('parseRequest', () => {
  test('defaults', () => {
    const r = parseRequest({});
    assert.equal(r.objective, 'energy');
    assert.equal(r.slaFloor, 99);
    assert.equal(r.baseServers, 50);
    assert.deepEqual(Object.keys(r.ranges), ['servers', 'headroom', 'deferrableShare']);
  });
  test('rejects bad input with a field', () => {
    for (const [body, field] of [
      [[], undefined], [{ objective: 'speed' }, 'objective'], [{ slaFloor: 120 }, 'slaFloor'], [{ slaFloor: '99' }, 'slaFloor'],
      [{ ranges: { servers: [10] } }, 'ranges.servers'], [{ ranges: { headroom: [0.5, 0.1] } }, 'ranges.headroom'],
      [{ ranges: { deferrableShare: [0, 2] } }, 'ranges.deferrableShare'], [{ ranges: { servers: [5.5, 20] } }, 'ranges.servers'],
      [{ ranges: { pue: [1, 2] } }, 'ranges.pue'], [{ maxRuns: 1000 }, 'maxRuns'], [{ base: { servers: 0 } }, 'base.servers'],
    ]) {
      assert.throws(() => parseRequest(body), (e) => e.type === 'validation' && e.field === field, JSON.stringify(body));
    }
  });
});

test('paretoFront keeps only non-dominated points', () => {
  const pts = [
    { slaPct: 100, energySavedKwh: 10 }, { slaPct: 99, energySavedKwh: 30 }, { slaPct: 99, energySavedKwh: 20 },
    { slaPct: 95, energySavedKwh: 25 }, { slaPct: 90, energySavedKwh: 40 },
  ];
  assert.deepEqual(paretoFront(pts).map((p) => [p.slaPct, p.energySavedKwh]), [[100, 10], [99, 30], [90, 40]]);
});

describe('POST /api/optimize', () => {
  let server; let base;
  before(async () => {
    server = createApp({ store: { get: async () => [] }, engine }).listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://localhost:${server.address().port}`;
  });
  after(() => server.close());
  const post = async (body) => {
    const res = await fetch(`${base}/api/optimize`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };

  test('returns the best feasible point, candidates and a pareto front within the run budget', async () => {
    calls = 0;
    const { status, body } = await post({});
    assert.equal(status, 200);
    assert.ok(calls <= 150 && body.runs === calls);
    assert.ok(body.best.slaPct >= 99);
    assert.ok(body.candidates.length > 20);
    const feasible = body.candidates.filter((c) => c.feasible);
    assert.ok(feasible.every((c) => c.energyKwh >= body.best.summary.energyKwh - 1e-9), 'best minimises energy among feasible');
    assert.ok(body.pareto.length >= 2);
    assert.ok(body.candidates.some((c) => !c.feasible));
    assert.equal(typeof body.explanation, 'string');
    assert.equal(body.best.applyParams.workloadServers, undefined);
  });

  test('objective and SLA floor change the answer', async () => {
    const energy = (await post({ objective: 'energy' })).body.best.params;
    const carbon = (await post({ objective: 'carbon' })).body.best.params;
    assert.notDeepEqual(energy, carbon);
    const strict = (await post({ slaFloor: 100 })).body.best.params;
    const loose = (await post({ slaFloor: 70 })).body.best.params;
    assert.ok(loose.servers * (1 + loose.headroom) < strict.servers * (1 + strict.headroom));
  });

  test('reports when no combination meets the floor', async () => {
    const { status, body } = await post({ ranges: { servers: [5, 10], headroom: [0, 0.1] }, slaFloor: 99 });
    assert.equal(status, 200);
    assert.equal(body.best, null);
    assert.match(body.explanation, /No combination/);
    assert.ok(body.closest);
  });

  test('400 for invalid input', async () => {
    const r = await post({ objective: 'speed' });
    assert.equal(r.status, 400);
    assert.deepEqual(r.body, { error: { code: 'VALIDATION_ERROR', message: 'objective must be one of energy, carbon, cost', field: 'objective' } });
  });
});

