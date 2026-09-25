const { test } = require('node:test');
const assert = require('node:assert');

process.env.AUTH_DISABLED = 'true';

const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request.endsWith('services/dynamodb')) {
    return {
      scanAll: async () => [
        { resourceId: 'ec2-01', service: 'EC2', status: 'active', capacity: 80 },
      ],
      getItem: async (table, key) =>
        key.resourceId === 'ec2-01'
          ? { resourceId: 'ec2-01', service: 'EC2', status: 'active', capacity: 80 }
          : undefined,
      updateItem: async (table, key, updates) => ({ resourceId: key.resourceId, ...updates }),
    };
  }
  if (request.endsWith('services/sns')) {
    return { publishAlert: async () => ({ skipped: true }) };
  }
  if (request.endsWith('services/cloudwatch')) {
    return { putMetric: async () => {} };
  }
  if (request.endsWith('services/lambda')) {
    return { invokeScalingHandler: async () => ({ invoked: false }) };
  }
  if (request.endsWith('services/mlClient')) {
    return { getPredictions: async () => null };
  }
  return originalLoad.apply(this, arguments);
};

const app = require('../server');

async function request(method, path, body) {
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://localhost:${port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json();
    return { status: res.status, json };
  } finally {
    server.close();
  }
}

test('GET /api/health returns ok, no auth needed', async () => {
  const { status, json } = await request('GET', '/api/health');
  assert.strictEqual(status, 200);
  assert.deepStrictEqual(json, { status: 'ok' });
});

test('GET /api/allocations returns seeded data', async () => {
  const { status, json } = await request('GET', '/api/allocations');
  assert.strictEqual(status, 200);
  assert.strictEqual(json.data.length, 1);
  assert.strictEqual(json.data[0].resourceId, 'ec2-01');
});

test('POST /api/allocations/scale rejects unknown resourceId', async () => {
  const { status, json } = await request('POST', '/api/allocations/scale', {
    resourceId: 'does-not-exist',
    action: 'scale_down',
    targetCapacity: 20,
  });
  assert.strictEqual(status, 400);
  assert.strictEqual(json.success, false);
});

test('POST /api/allocations/scale rejects out-of-range targetCapacity', async () => {
  const { status, json } = await request('POST', '/api/allocations/scale', {
    resourceId: 'ec2-01',
    action: 'scale_down',
    targetCapacity: 150,
  });
  assert.strictEqual(status, 400);
  assert.strictEqual(json.success, false);
});

test('POST /api/allocations/scale succeeds for a valid request', async () => {
  const { status, json } = await request('POST', '/api/allocations/scale', {
    resourceId: 'ec2-01',
    action: 'scale_down',
    targetCapacity: 40,
  });
  assert.strictEqual(status, 200);
  assert.strictEqual(json.success, true);
  assert.strictEqual(json.newCapacity, 40);
});

test('GET /api/metrics/energy without auth token is rejected when AUTH_DISABLED=false', async () => {
  process.env.AUTH_DISABLED = 'false';
  delete require.cache[require.resolve('../config')];
  delete require.cache[require.resolve('../middleware/auth')];
  delete require.cache[require.resolve('../server')];
  const freshApp = require('../server');
  const server = freshApp.listen(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://localhost:${port}/api/metrics/energy`);
    assert.strictEqual(res.status, 401);
  } finally {
    server.close();
    process.env.AUTH_DISABLED = 'true';
  }
});
