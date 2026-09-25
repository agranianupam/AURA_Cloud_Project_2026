// Seeds DynamoDB tables from Agrani's mock JSON (src/ml_model/mock_data/),
// which matches docs/api-contract.md exactly. Requires real AWS credentials
// and the tables to already exist (see src/aws/scripts/setup.sh).
//
// Usage: npm run seed

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { putItem } = require('../services/dynamodb');
const config = require('../config');

const MOCK_DIR = path.resolve(__dirname, '../../ml_model/mock_data');

function loadMock(filename) {
  const filePath = path.join(MOCK_DIR, filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Missing ${filePath} — pull src/ml_model/mock_data/ from feature/Agrani first.`
    );
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')).data;
}

async function seed() {
  const energyMetrics = loadMock('energy_metrics.json');
  const allocations = loadMock('allocations.json');
  const alerts = loadMock('alerts.json');

  console.log(`Seeding ${config.tables.usage} (${energyMetrics.length} items)...`);
  for (const row of energyMetrics) {
    await putItem(config.tables.usage, row);
  }

  console.log(`Seeding ${config.tables.allocations} (${allocations.length} items)...`);
  for (const row of allocations) {
    await putItem(config.tables.allocations, {
      ...row,
      lastUpdated: new Date().toISOString(),
    });
  }

  console.log(`Seeding ${config.tables.alerts} (${alerts.length} items)...`);
  for (const row of alerts) {
    await putItem(config.tables.alerts, { alertId: randomUUID(), ...row });
  }

  console.log('Seed complete.');
}

if (require.main === module) {
  seed().catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
}

module.exports = { seed };
