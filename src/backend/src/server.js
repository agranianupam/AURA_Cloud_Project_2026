import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { cognitoAuth } from './auth.js';
import { PythonEngine } from './engine.js';
import { DynamoStore, FileStore } from './store.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const {
  PORT = '3000',
  DATA_DIR = path.resolve(here, '../../../results/simulation'),
  DYNAMODB_TABLE,
  AWS_REGION = 'us-east-1',
  COGNITO_USER_POOL_ID,
  COGNITO_CLIENT_ID,
  CORS_ORIGIN = '*',
  AUTH_DISABLED,
} = process.env;

const store = DYNAMODB_TABLE
  ? await DynamoStore.create(DYNAMODB_TABLE, AWS_REGION)
  : new FileStore(DATA_DIR);
const auth = AUTH_DISABLED === 'true'
  ? cognitoAuth({})
  : cognitoAuth({ userPoolId: COGNITO_USER_POOL_ID, clientId: COGNITO_CLIENT_ID });

const engine = new PythonEngine();
if (process.env.ENGINE_WARM !== 'false') engine.warm().then(() => console.log('forecast engine ready'), (e) => console.error(e.message));
process.on('exit', () => engine.close());

createApp({ store, engine, auth, corsOrigin: CORS_ORIGIN }).listen(Number(PORT), () => {
  const source = DYNAMODB_TABLE ? `DynamoDB table ${DYNAMODB_TABLE}` : DATA_DIR;
  console.log(`AURA API on http://localhost:${PORT} (data: ${source})`);
});
