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
      // Energy/carbon fields are owned by the ML/scheduler track (power model,
      // PRD FR-SC-1/2) — backend passes them through as stored, never computes
      // them. null until that track writes them.
      energyKwh: row.energyKwh ?? null,
      carbonIntensity: row.carbonIntensity ?? null,
      carbonGco2: row.carbonGco2 ?? null,
      baselineEnergyKwh: row.baselineEnergyKwh ?? null,
      baselineCarbonGco2: row.baselineCarbonGco2 ?? null,
    }));

    res.json({ data });
  } catch (err) {
    console.error('[metrics] GET /energy failed:', err);
    res.status(500).json({ error: 'Failed to load energy metrics' });
  }
});

// GET /api/metrics/savings
// Aggregates ResourceUsage into a single AURA-vs-static-baseline summary
// (PRD FR-BE-7 / FR-SC-5). Degrades to all-zero output rather than erroring
// if energy/carbon fields haven't been populated yet by the ML/scheduler
// track — see docs/api-contract.md for the exact per-field formula and the
// documented placeholder status of slaCompliancePct.
router.get('/savings', async (req, res) => {
  try {
    const rows = await scanAll(config.tables.usage);

    let energySum = 0;
    let baselineEnergySum = 0;
    let carbonSum = 0;
    let baselineCarbonSum = 0;
    let costSum = 0;
    let slaMetCount = 0;
    let rowsWithSlaSignal = 0;

    for (const row of rows) {
      if (typeof row.energyKwh === 'number' && typeof row.baselineEnergyKwh === 'number') {
        energySum += row.energyKwh;
        baselineEnergySum += row.baselineEnergyKwh;
      }
      if (typeof row.carbonGco2 === 'number' && typeof row.baselineCarbonGco2 === 'number') {
        carbonSum += row.carbonGco2;
        baselineCarbonSum += row.baselineCarbonGco2;
      }
      if (typeof row.cost === 'number') {
        costSum += row.cost;
      }
      if (typeof row.utilization === 'number') {
        rowsWithSlaSignal += 1;
        if (row.utilization <= 100) {
          slaMetCount += 1;
        }
      }
    }

    const energySavedKwh = baselineEnergySum - energySum;
    const carbonSavedKg = (baselineCarbonSum - carbonSum) / 1000;
    const percentReduction =
      baselineEnergySum > 0 ? (energySavedKwh / baselineEnergySum) * 100 : 0;
    const slaCompliancePct =
      rowsWithSlaSignal > 0 ? (slaMetCount / rowsWithSlaSignal) * 100 : 0;
    // No baselineCost field exists in the schema, so costSaved is a naive
    // proportional estimate (actual cost incurred x the energy reduction
    // ratio) - not an independently measured baseline-cost comparison.
    // See docs/api-contract.md.
    const costSaved = costSum * (percentReduction / 100);

    res.json({
      data: {
        energySavedKwh: Number(energySavedKwh.toFixed(2)),
        carbonSavedKg: Number(carbonSavedKg.toFixed(2)),
        costSaved: Number(costSaved.toFixed(2)),
        percentReduction: Number(percentReduction.toFixed(1)),
        slaCompliancePct: Number(slaCompliancePct.toFixed(1)),
      },
    });
  } catch (err) {
    console.error('[metrics] GET /savings failed:', err);
    res.status(500).json({ error: 'Failed to load savings metrics' });
  }
});

module.exports = router;
