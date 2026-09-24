const { test } = require('node:test');
const assert = require('node:assert');

process.env.AUTH_DISABLED = 'true';

const USAGE_ROWS = [
  {
    timestamp: '2026-08-01T00:00:00Z',
    utilization: 62.3,
    cost: 4.12,
    predicted: 65.0,
    energyKwh: 1.84,
    carbonIntensity: 640,
    carbonGco2: 1178,
    baselineEnergyKwh: 2.3,
    baselineCarbonGco2: 1472,
  },
  {
    timestamp: '2026-08-01T01:00:00Z',
    utilization: 40.1,
    cost: 2.5,
    predicted: 42.0,
    energyKwh: 1.2,
    carbonIntensity: 600,
    carbonGco2: 720,
    baselineEnergyKwh: 1.6,
    baselineCarbonGco2: 960,
  },
];

const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request.endsWith('services/dynamodb')) {
    return {
      scanAll: async (table) => (table === 'ResourceUsage' ? USAGE_ROWS : []),
    };
  }
  if (request.endsWith('services/mlClient')) {
    return { getPredictions: async () => null };
  }
  return originalLoad.apply(this, arguments);
};

const app = require('../server');

async function request(method, path) {
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://localhost:${port}${path}`, { method });
    const json = await res.json();
    return { status: res.status, json };
  } finally {
    server.close();
  }
}

test('GET /api/metrics/energy includes energy/carbon fields', async () => {
  const { status, json } = await request('GET', '/api/metrics/energy');
  assert.strictEqual(status, 200);
  assert.strictEqual(json.data.length, 2);
  assert.strictEqual(json.data[0].energyKwh, 1.84);
  assert.strictEqual(json.data[0].carbonGco2, 1178);
  assert.strictEqual(json.data[0].baselineEnergyKwh, 2.3);
});

test('GET /api/metrics/savings aggregates energy/carbon/cost correctly', async () => {
  const { status, json } = await request('GET', '/api/metrics/savings');
  assert.strictEqual(status, 200);

  // energySavedKwh = (2.3 + 1.6) - (1.84 + 1.2) = 3.9 - 3.04 = 0.86
  assert.strictEqual(json.data.energySavedKwh, 0.86);
  // carbonSavedKg = ((1472+960) - (1178+720)) / 1000 = (2432-1898)/1000 = 0.534
  assert.strictEqual(json.data.carbonSavedKg, 0.53);
  // percentReduction = 0.86 / 3.9 * 100 = 22.05...
  assert.strictEqual(json.data.percentReduction, 22.1);
  // slaCompliancePct: both rows have utilization <= 100 -> 100%
  assert.strictEqual(json.data.slaCompliancePct, 100);
});

test('GET /api/metrics/savings degrades to zeros with no data', async () => {
  delete require.cache[require.resolve('module')];
  const Module2 = require('module');
  const savedLoad = Module2._load;
  Module2._load = function (request, parent, isMain) {
    if (request.endsWith('services/dynamodb')) {
      return { scanAll: async () => [] };
    }
    if (request.endsWith('services/mlClient')) {
      return { getPredictions: async () => null };
    }
    return savedLoad.apply(this, arguments);
  };
  delete require.cache[require.resolve('../server')];
  delete require.cache[require.resolve('../routes/metrics')];
  const freshApp = require('../server');

  const server = freshApp.listen(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://localhost:${port}/api/metrics/savings`);
    const json = await res.json();
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(json.data, {
      energySavedKwh: 0,
      carbonSavedKg: 0,
      costSaved: 0,
      percentReduction: 0,
      slaCompliancePct: 0,
    });
  } finally {
    server.close();
    Module2._load = savedLoad;
  }
});
