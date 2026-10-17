
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchWriteCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { DATASETS, itemsFor } from '../src/store.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { days: { type: 'string', default: '30' }, alerts: { type: 'string', default: '20' } },
});
const dir = positionals[0] || path.resolve(here, '../../../results/simulation');
const { DYNAMODB_TABLE = 'AURA', AWS_REGION = 'us-east-1' } = process.env;

const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: AWS_REGION }));
for (const [name, { file }] of Object.entries(DATASETS)) {
  let data = JSON.parse(await readFile(path.join(dir, file), 'utf8'));
  if (name === 'energy') data = data.slice(-24 * Number(values.days));
  if (name === 'alerts') data = data.slice(0, Number(values.alerts));
  const items = itemsFor(name, data);
  for (let i = 0; i < items.length; i += 25) {
    let request = { [DYNAMODB_TABLE]: items.slice(i, i + 25).map((Item) => ({ PutRequest: { Item } })) };
    while (request && Object.keys(request).length) {
      const res = await client.send(new BatchWriteCommand({ RequestItems: request }));
      request = res.UnprocessedItems;
    }
  }
  console.log(`${name}: wrote ${items.length} items to ${DYNAMODB_TABLE}`);
}

