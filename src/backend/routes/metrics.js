const express = require('express');
const { scanAll } = require('../services/dynamodb');
const { getPredictions } = require('../services/mlClient');
const config = require('../config');

const router = express.Router();

// GET /api/metrics/energy
router.get('/energy', async (req, res) => {
  try {
    const actuals = await scanAll(config.tables.usage);
    actuals.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    const predictions = await getPredictions(12);
    const predictedByTimestamp = new Map(
      (predictions || []).map((p) => [p.timestamp, p.predicted_utilization])
    );

    const data = actuals.map((row) => ({
      timestamp: row.timestamp,
      utilization: row.utilization,
      cost: row.cost,
      predicted: predictedByTimestamp.has(row.timestamp)
        ? predictedByTimestamp.get(row.timestamp)
        : row.predicted ?? null,
    }));

    res.json({ data });
  } catch (err) {
    console.error('[metrics] GET /energy failed:', err);
    res.status(500).json({ error: 'Failed to load energy metrics' });
  }
});

module.exports = router;
