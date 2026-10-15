import test from 'node:test';
import assert from 'node:assert/strict';
import { equivalentsFor, uncertaintyHint } from '../src/features/report/equivalents.js';
import { buildCsv } from '../src/features/report/exportCsv.js';
import { buildReportHtml } from '../src/features/report/reportHtml.js';

const result = {
  hourly: Array.from({ length: 48 }, (_, i) => ({ ts: `2019-08-12T${String(i % 24).padStart(2, '0')}:00:00Z`, demandKw: 5, serversOn: 10, energyKwh: 3 + (i % 5), baselineKwh: 9, co2G: 1500, baselineCo2G: 4000, carbonIntensity: 400 })),
  summary: { energySavedKwh: 213.1, co2SavedKg: 108.9, costSaved: 25.58, slaPct: 100, percentReduction: 42.3, co2PercentReduction: 44.3, slaMissHours: 0, period: { start: '2019-08-12', end: '2019-08-13', days: 2 } },
  recommendations: ['Shift <b>batch</b> jobs'],
  params: { servers: 50, idleWatts: 100, peakWatts: 250, deferrableShare: 0.3, carbonGrid: 'medium', events: [] },
  model: { name: 'AURA LSTM', testMaeKw: 35.93, testMapePct: 20.5, seasonalNaiveMaeKw: 44.89 },
};

test('equivalents are faithful to the run', () => {
  const e = Object.fromEntries(equivalentsFor(result.summary).map((x) => [x.key, x.value]));
  assert.equal(e.car, `${Math.round(108.9 / 0.17).toLocaleString()} km`);
  assert.match(e.tree, /5\.18 tree-years/);
  assert.match(e.india, /64\.58 home-days/);
});

test('zero savings produce zero equivalents, not NaN', () => {
  for (const e of equivalentsFor({ energySavedKwh: 0, co2SavedKg: 0 })) assert.doesNotMatch(e.value, /NaN/);
});

test('uncertainty hint uses the model MAPE', () => {
  assert.match(uncertaintyHint(result).text, /20\.5%/);
  assert.match(uncertaintyHint({ summary: {} }).text, /simulated estimates/i);
});

test('csv has inputs, summary and one row per hour', () => {
  const csv = buildCsv(result, undefined, new Date('2020-01-01T00:00:00Z'));
  assert.match(csv, /\[inputs\]/);
  assert.match(csv, /servers,50/);
  assert.match(csv, /energySavedKwh,213.1/);
  assert.match(csv, /summary.*\r\n/s);
  const hourly = csv.split('[hourly]\r\n')[1].trim().split('\r\n');
  assert.equal(hourly.length, 49);
});

test('csv neutralises formula injection and quotes commas', () => {
  const csv = buildCsv({ ...result, params: { ...result.params, carbonGrid: '=HYPERLINK("x")' } });
  assert.match(csv, /carbonGrid,"'=HYPERLINK/);
});

test('report html is A4, escapes text, contains required sections', () => {
  const html = buildReportHtml(result);
  assert.match(html, /size: A4/);
  assert.match(html, /<svg/);
  assert.doesNotMatch(html, /<b>batch<\/b>/);
  for (const t of ['Scenario inputs', 'Simulated estimates', 'Accuracy and uncertainty', 'Caveats', 'Everyday equivalents']) assert.match(html, new RegExp(t));
  assert.match(html, /MAPE 20\.5%/);
});
