const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  ScanCommand,
  GetCommand,
  PutCommand,
  UpdateCommand,
} = require('@aws-sdk/lib-dynamodb');
const config = require('../config');

const client = new DynamoDBClient({ region: config.awsRegion });
const doc = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

async function scanAll(tableName) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const res = await doc.send(
      new ScanCommand({ TableName: tableName, ExclusiveStartKey })
    );
    items.push(...(res.Items || []));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

async function getItem(tableName, key) {
  const res = await doc.send(new GetCommand({ TableName: tableName, Key: key }));
  return res.Item;
}

async function putItem(tableName, item) {
  await doc.send(new PutCommand({ TableName: tableName, Item: item }));
  return item;
}

async function updateItem(tableName, key, updates) {
  const names = {};
  const values = {};
  const sets = [];
  for (const [k, v] of Object.entries(updates)) {
    names[`#${k}`] = k;
    values[`:${k}`] = v;
    sets.push(`#${k} = :${k}`);
  }
  const res = await doc.send(
    new UpdateCommand({
      TableName: tableName,
      Key: key,
      UpdateExpression: `SET ${sets.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: 'ALL_NEW',
    })
  );
  return res.Attributes;
}

module.exports = { doc, scanAll, getItem, putItem, updateItem };
