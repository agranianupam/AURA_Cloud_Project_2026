const express = require('express');
const { scanAll } = require('../services/dynamodb');
const config = require('../config');

const router = express.Router();

// GET /api/alerts (sorted by timestamp desc)
router.get('/', async (req, res) => {
  try {
    const items = await scanAll(config.tables.alerts);
    items.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const data = items.map(({ timestamp, type, message, severity }) => ({
      timestamp,
      type,
      message,
      severity,
    }));
    res.json({ data });
  } catch (err) {
    console.error('[alerts] GET / failed:', err);
    res.status(500).json({ error: 'Failed to load alerts' });
  }
});

module.exports = router;
