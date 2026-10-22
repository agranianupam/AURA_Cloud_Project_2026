
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const DATASETS = {
  energy: { file: 'energy_metrics.json', type: 'energy' },
  savings: { file: 'savings.json', type: 'savings', single: true },
  allocations: { file: 'allocations.json', type: 'allocation' },
  alerts: { file: 'alerts.json', type: 'alert', newestFirst: true },
  forecast: { file: 'forecast.json', type: 'forecast', single: true },
};

function dataset(name) {
  const ds = DATASETS[name];
  if (!ds) throw new Error(`unknown dataset ${name}`);
  return ds;
}

export function itemsFor(name, data) {
  const { type, single } = dataset(name);
  if (single) return [{ type, id: 'latest', ...data }];
  if (name === 'energy') return data.map((r) => ({ type, id: r.timestamp, ...r }));
  if (name === 'allocations') return data.map((r) => ({ type, id: r.resourceId, ...r }));
  return data.map(({ type: alertType, ...r }, i) => ({ ...r, alertType, type, id: `${r.timestamp}#${String(i).padStart(5, '0')}` }));
}

export class FileStore {
  constructor(dir) {
    this.dir = dir;
  }

  async get(name) {
    return JSON.parse(await readFile(path.join(this.dir, dataset(name).file), 'utf8'));
  }
}

export class DynamoStore {
  constructor(tableName, client) {
    this.tableName = tableName;
    this.client = client;
  }

  static async create(tableName, region) {
    const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient } = await import('@aws-sdk/lib-dynamodb');
    return new DynamoStore(tableName, DynamoDBDocumentClient.from(new DynamoDBClient({ region })));
  }

  async get(name) {
    const { type, single, newestFirst } = dataset(name);
    const { QueryCommand } = await import('@aws-sdk/lib-dynamodb');
    const items = [];
    let ExclusiveStartKey;
    do {
      const res = await this.client.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: '#t = :t',
        ExpressionAttributeNames: { '#t': 'type' },
        ExpressionAttributeValues: { ':t': type },
        ScanIndexForward: !newestFirst,
        ExclusiveStartKey,
      }));
      items.push(...res.Items);
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);

    if (!items.length) {
      throw Object.assign(new Error(`no ${type} items in ${this.tableName}`), { code: 'ENOENT' });
    }
    const records = items.map(({ type: _t, id: _id, alertType, ...rest }) => (alertType ? { ...rest, type: alertType } : rest));
    return single ? records[0] : records;
  }
}

