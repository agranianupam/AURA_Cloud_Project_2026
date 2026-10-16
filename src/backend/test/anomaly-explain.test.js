import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { compact, ruleBased } from '../src/explain.js';

const incident = {
  id: 1, start: '2019-08-15T13:00:00Z', end: '2019-08-15T15:00:00Z', hours: 3, peakTs: '2019-08-15T13:00:00Z',
  peakDeviationKw: 640, peakDeviationPct: 140, direction: 'spike', severity: 'critical', synthetic: false, forecastKw: 450, actualKw: 1090,
};
const base = { summary: { incidents: 1, flaggedHours: 3, maeKw: 36 }, threshold: { sigmaKw: 48, k: 3 }, incidents: [incident] };

describe('Explainer anomaly topics (built-in mode)', () => {
  test('explains a specific incident', () => {
    const a = ruleBased(compact({ anomalies: { ...base, incident } }), 'Explain this critical spike incident');
    assert.match(a, /1,090 kW/);
    assert.match(a, /Possible causes/);
    assert.match(a, /critical/);
  });
  test('says a synthetic fault has no real cause', () => {
    const a = ruleBased(compact({ anomalies: { ...base, incident: { ...incident, synthetic: true } } }), 'why the incident?');
    assert.match(a, /injected for testing/);
  });
  test('summarises when no incident is selected', () => {
    assert.match(ruleBased(compact({ anomalies: { ...base, incident: null } }), 'summarise the anomalies'), /1 incident/);
  });
  test('explains the term in a normal simulation context', () => {
    assert.match(ruleBased({ summary: { slaPct: 100 } }, 'what is an anomaly?'), /real load differs/);
  });
  test('does not hijack other questions', () => {
    const c = compact({ summary: { slaPct: 99.5, slaMissHours: 2 } });
    assert.match(ruleBased(c, 'What does SLA mean?'), /SLA is the share/);
  });
});
