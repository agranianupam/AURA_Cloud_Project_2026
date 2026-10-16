import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DynamoStore, itemsFor } from '../src/store.js';

// Fake DocumentClient: serves Query pages of 2 items for the requested `type`
function fakeClient(items) {
  return {
    calls: [],
    async send(cmd) {
      const { ExpressionAttributeValues, ExclusiveStartKey = 0, ScanIndexForward } = cmd.input;
      this.calls.push(cmd.input);
      let matching = items.filter((i) => i.type === ExpressionAttributeValues[':t']);
      matching.sort((a, b) => a.id.localeCompare(b.id) * (ScanIndexForward ? 1 : -1));
      const page = matching.slice(ExclusiveStartKey, ExclusiveStartKey + 2);
      const next = ExclusiveStartKey + 2 < matching.length ? ExclusiveStartKey + 2 : undefined;
      return { Items: page, LastEvaluatedKey: next };
    },
  };
}

test('itemsFor builds type/id keys per dataset', () => {
  assert.deepEqual(itemsFor('savings', { a: 1 }), [{ type: 'savings', id: 'latest', a: 1 }]);
  assert.equal(itemsFor('energy', [{ timestamp: 't1' }])[0].id, 't1');
  assert.equal(itemsFor('allocations', [{ resourceId: 'n1' }])[0].id, 'n1');
  const alerts = itemsFor('alerts', [{ timestamp: 't' }, { timestamp: 't' }]);
  assert.notEqual(alerts[0].id, alerts[1].id);
});

test('DynamoStore pages through results, strips keys and orders alerts newest first', async () => {
  const energy = itemsFor('energy', ['t3', 't1', 't2'].map((timestamp) => ({ timestamp, energyKwh: 1 })));
  const alerts = itemsFor('alerts', [{ timestamp: '2019-01-02' }, { timestamp: '2019-01-01' }, { timestamp: '2019-01-03' }]);
  const client = fakeClient([...energy, ...alerts, ...itemsFor('savings', { costSaved: 5 })]);
  const store = new DynamoStore('AURA', client);

  const rows = await store.get('energy');
  assert.deepEqual(rows.map((r) => r.timestamp), ['t1', 't2', 't3']);
  assert.equal(rows[0].type, undefined);
  assert.equal(client.calls.length, 2); // two pages
  assert.deepEqual((await store.get('alerts')).map((a) => a.timestamp), ['2019-01-03', '2019-01-02', '2019-01-01']);
  assert.deepEqual(await store.get('savings'), { costSaved: 5 });
  await assert.rejects(store.get('forecast'), { code: 'ENOENT' });
});
