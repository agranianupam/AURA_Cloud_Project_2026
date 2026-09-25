const { DynamoDBClient, CreateTableCommand } = require('@aws-sdk/client-dynamodb');
require('dotenv').config({ path: require('path').resolve(__dirname, '../../../.env') });

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'ap-south-1' });

async function createTable(tableName, partitionKey, pkType, sortKey = null, skType = null) {
  try {
    const params = {
      TableName: tableName,
      AttributeDefinitions: [{ AttributeName: partitionKey, AttributeType: pkType }],
      KeySchema: [{ AttributeName: partitionKey, KeyType: 'HASH' }],
      BillingMode: 'PAY_PER_REQUEST'
    };

    if (sortKey && skType) {
      params.AttributeDefinitions.push({ AttributeName: sortKey, AttributeType: skType });
      params.KeySchema.push({ AttributeName: sortKey, KeyType: 'RANGE' });
    }

    console.log(`Creating table ${tableName}...`);
    await client.send(new CreateTableCommand(params));
    console.log(`Table ${tableName} created successfully (or creation started).`);
  } catch (err) {
    if (err.name === 'ResourceInUseException') {
      console.log(`Table ${tableName} already exists.`);
    } else {
      console.error(`Error creating ${tableName}:`, err);
    }
  }
}

async function run() {
  await createTable(process.env.DYNAMODB_TABLE_USAGE || 'ResourceUsage', 'timestamp', 'S');
  await createTable(process.env.DYNAMODB_TABLE_ALLOCATIONS || 'Allocations', 'resourceId', 'S');
  await createTable(process.env.DYNAMODB_TABLE_ALERTS || 'Alerts', 'timestamp', 'S');
  console.log('Finished initializing tables. Wait a few seconds for AWS to provision them before seeding.');
}

run();
