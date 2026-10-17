
import { EngineError } from './engine.js';

const MAX_DAYS = 14;
const K = { low: 4, medium: 3, high: 2.5 };
const MIN_REL = 0.2;
const INJECT_TYPES = ['spike', 'dropout'];

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const r2 = (x) => Math.round(x * 100) / 100;
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const dayMs = 86400000;

export function injectFault(points, { type, start, hours = 3 }) {
  const withActual = points.map((p, i) => [p, i]).filter(([p]) => p.actualKw != null);
  if (!withActual.length) return points;
  let first = start ? points.findIndex((p) => p.ts.slice(0, 13) === start.slice(0, 13)) : -1;
  if (first < 0) {

    const day = points[Math.floor(points.length / 48) * 24]?.ts.slice(0, 10) ?? points[0].ts.slice(0, 10);
    first = points.findIndex((p) => p.ts.startsWith(`${day}T13`));
    if (first < 0) first = withActual[Math.floor(withActual.length / 2)][1];
  }
  return points.map((p, i) => {
    if (i < first || i >= first + hours || p.actualKw == null) return p;
    const actualKw = type === 'spike' ? p.actualKw + 0.8 * Math.max(p.forecastKw, p.actualKw) : p.actualKw * 0.15;
    return { ...p, originalKw: p.actualKw, actualKw: r2(actualKw), synthetic: true };
  });
}

export function detect(points, { sensitivity = 'medium' } = {}) {
  const k = K[sensitivity] ?? K.medium;
  const known = points.filter((p) => p.actualKw != null && p.forecastKw != null);
  const res = known.map((p) => p.actualKw - p.forecastKw);
  const bias = res.length ? median(res) : 0;
  const mad = res.length ? median(res.map((x) => Math.abs(x - bias))) : 0;
  const sigma = 1.4826 * mad;

  const out = points.map((p) => {
    const band = Math.max(k * sigma, MIN_REL * p.forecastKw);
    const center = p.forecastKw + bias;
    const base = { ...p, lowerKw: r2(Math.max(0, center - band)), upperKw: r2(center + band) };
    if (p.actualKw == null || p.forecastKw == null) return { ...base, residualKw: null, flagged: false, ratio: 0 };
    const residual = p.actualKw - center;
    const ratio = Math.abs(residual) / band;
    return { ...base, residualKw: r2(p.actualKw - p.forecastKw), flagged: ratio > 1, ratio: r2(ratio) };
  });

  const incidents = [];
  let cur = null;
  const close = () => {
    if (!cur) return;
    const peak = cur.rows.reduce((a, b) => (Math.abs(b.residualKw) > Math.abs(a.residualKw) ? b : a));
    const peakRatio = Math.max(...cur.rows.map((r) => r.ratio));
    const hours = cur.rows.length;
    const severity = peakRatio >= 2.2 || (hours >= 4 && peakRatio >= 1.5) ? 'critical' : peakRatio >= 1.5 || hours >= 3 ? 'warning' : 'info';
    const direction = peak.residualKw > 0 ? 'spike' : 'drop';
    incidents.push({
      id: incidents.length + 1,
      start: cur.rows[0].ts,
      end: cur.rows.at(-1).ts,
      hours,
      peakTs: peak.ts,
      peakDeviationKw: peak.residualKw,
      peakDeviationPct: peak.forecastKw ? r2((peak.residualKw / peak.forecastKw) * 100) : null,
      direction,
      severity,
      synthetic: cur.rows.some((r) => r.synthetic),
      forecastKw: peak.forecastKw,
      actualKw: peak.actualKw,
    });
    cur = null;
  };
  for (const row of out) {
    const adjacent = cur && Date.parse(row.ts) - Date.parse(cur.rows.at(-1).ts) === 3600000;
    if (row.flagged) {
      if (cur && !adjacent) close();
      cur ??= { rows: [] };
      cur.rows.push(row);
    } else close();
  }
  close();

  const bySeverity = { info: 0, warning: 0, critical: 0 };
  for (const i of incidents) bySeverity[i.severity]++;
  return {
    incidents,
    points: out,
    threshold: { method: 'robust (median/MAD)', sensitivity, k, sigmaKw: r2(sigma), biasKw: r2(bias), minRelPct: MIN_REL * 100 },
    summary: {
      hours: points.length,
      actualHours: known.length,
      flaggedHours: out.filter((p) => p.flagged).length,
      incidents: incidents.length,
      bySeverity,
      maeKw: known.length ? r2(res.reduce((s, x) => s + Math.abs(x), 0) / known.length) : null,
    },
  };
}

export function validateRequest(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new EngineError('validation', 'request body must be a JSON object');
  const { startDate, endDate, uploadId, sensitivity, inject } = body;
  if (!isDate(startDate)) throw new EngineError('validation', 'startDate is required (YYYY-MM-DD)', 'startDate');
  const end = endDate ?? startDate;
  if (!isDate(end)) throw new EngineError('validation', 'endDate must be YYYY-MM-DD', 'endDate');
  const days = (Date.parse(end) - Date.parse(startDate)) / dayMs + 1;
  if (days < 1) throw new EngineError('validation', 'endDate must be on or after startDate', 'endDate');
  if (days > MAX_DAYS) throw new EngineError('validation', `choose at most ${MAX_DAYS} days`, 'endDate');
  if (uploadId !== undefined && (typeof uploadId !== 'string' || !/^[\w-]{1,64}$/.test(uploadId))) throw new EngineError('validation', 'uploadId is not valid', 'uploadId');
  if (sensitivity !== undefined && !K[sensitivity]) throw new EngineError('validation', 'sensitivity must be low, medium or high', 'sensitivity');
  let inj;
  if (inject !== undefined && inject !== null) {
    if (typeof inject !== 'object' || !INJECT_TYPES.includes(inject.type)) throw new EngineError('validation', 'inject.type must be "spike" or "dropout"', 'inject');
    const hours = inject.hours === undefined ? 3 : Number(inject.hours);
    if (!Number.isInteger(hours) || hours < 1 || hours > 12) throw new EngineError('validation', 'inject.hours must be a whole number from 1 to 12', 'inject');
    if (inject.start !== undefined && Number.isNaN(Date.parse(inject.start))) throw new EngineError('validation', 'inject.start must be an ISO timestamp', 'inject');
    inj = { type: inject.type, hours, start: inject.start };
  }
  return { startDate, endDate: end, days, uploadId, sensitivity: sensitivity ?? 'medium', inject: inj };
}

export async function analyze(engine, body) {
  const req = validateRequest(body);
  const points = [];
  const warnings = [];
  for (let i = 0; i < req.days; i++) {
    const date = new Date(Date.parse(req.startDate) + i * dayMs).toISOString().slice(0, 10);
    const day = await engine.preview(date, req.uploadId);
    for (const h of day.hourly) points.push({ ts: h.ts, forecastKw: h.forecastKw, actualKw: h.actualKw ?? null });
    for (const w of day.warnings ?? []) if (!warnings.includes(w)) warnings.push(w);
  }
  if (!points.some((p) => p.actualKw != null)) throw new EngineError('validation', 'no measured readings exist for these dates, so there is nothing to compare with the forecast', 'startDate');
  const series = req.inject ? injectFault(points, req.inject) : points;
  const result = detect(series, { sensitivity: req.sensitivity });
  result.summary.injected = req.inject ? { ...req.inject, synthetic: true, hoursAffected: series.filter((p) => p.synthetic).length } : null;
  return { ...result, params: { startDate: req.startDate, endDate: req.endDate, uploadId: req.uploadId ?? null, sensitivity: req.sensitivity }, warnings };
}

