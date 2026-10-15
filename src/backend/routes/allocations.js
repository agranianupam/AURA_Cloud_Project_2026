const express = require('express');
const { scanAll, getItem, updateItem } = require('../services/dynamodb');
const { publishAlert } = require('../services/sns');
const { putMetric } = require('../services/cloudwatch');
const { invokeScalingHandler } = require('../services/lambda');
const config = require('../config');

const router = express.Router();

const VALID_ACTIONS = new Set(['scale_up', 'scale_down', 'maintain']);

// GET /api/allocations
router.get('/', async (req, res) => {
  try {
    const data = await scanAll(config.tables.allocations);
    res.json({ data });
  } catch (err) {
    console.error('[allocations] GET / failed:', err);
    res.status(500).json({ error: 'Failed to load allocations' });
  }
});

// POST /api/allocations/scale
router.post('/scale', async (req, res) => {
  const { resourceId, action, targetCapacity } = req.body || {};

  if (typeof resourceId !== 'string' || !resourceId) {
    return res.status(400).json({ success: false, message: 'Invalid resourceId' });
  }
  if (!VALID_ACTIONS.has(action)) {
    return res.status(400).json({ success: false, message: 'Invalid action' });
  }
  if (
    typeof targetCapacity !== 'number' ||
    targetCapacity < 0 ||
    targetCapacity > 100
  ) {
    return res.status(400).json({ success: false, message: 'Invalid targetCapacity' });
  }

  try {
    const existing = await getItem(config.tables.allocations, { resourceId });
    if (!existing) {
      return res.status(400).json({ success: false, message: 'Invalid resourceId' });
    }

    const updated = await updateItem(
      config.tables.allocations,
      { resourceId },
      {
        capacity: targetCapacity,
        status: targetCapacity === 0 ? 'stopped' : 'active',
        lastUpdated: new Date().toISOString(),
      }
    );

    await Promise.all([
      invokeScalingHandler({ resourceId, action, targetCapacity }),
      publishAlert({
        subject: 'AURA Scaling Event',
        message: `${resourceId}: ${action} -> ${targetCapacity}%`,
      }),
      putMetric('ScalingAction', targetCapacity, 'Percent', [
        { Name: 'resourceId', Value: resourceId },
      ]),
    ]);

    res.json({
      success: true,
      message: 'Scaling action initiated',
      newCapacity: updated.capacity,
    });
  } catch (err) {
    console.error('[allocations] POST /scale failed:', err);
    res.status(500).json({ success: false, message: 'Failed to scale resource' });
  }
});

module.exports = router;
