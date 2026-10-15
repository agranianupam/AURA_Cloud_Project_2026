// "Run now or later?" carbon advisor. Finds the cleanest window for a job in the next 24-48 h using the
// UK National Grid Carbon Intensity forecast (free, no key). Called from the backend only, cached, with a
// timeout, and falls back to a bundled typical 24 h profile when the API is unreachable.

export const DEFAULT_BASE_URL = 'https://api.carbonintensity.org.uk';
const SLOT_MS = 30 * 60 * 1000;
const HOUR_MS = 3600 * 1000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 8000;
const MAX_WINDOW_H = 48;

// Typical weekday shape (gCO2/kWh by UTC hour), the "medium" profile used by the simulator. Offline fallback only.
export const PROFILE = [
  505, 500, 495, 490, 490, 495, 505, 495, 475, 455, 440, 430,
  425, 430, 440, 460, 490, 530, 560, 555, 545, 530, 520, 510,
];

export class AdvisorError extends Error {
  constructor(message, field, status = 400) {
    super(message);
    this.field = field;
    this.status = status;
  }
}

const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
const isoMinute = (ms) => new Date(ms).toISOString().slice(0, 16) + 'Z'; // 2024-01-01T12:30Z, the API's format

export function parseRequest(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new AdvisorError('request body must be a JSON object');
  const num = (field, v, lo, hi, what) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) throw new AdvisorError(`${field} must be a number between ${lo} and ${hi}${what ? ` (${what})` : ''}`, field);
    return v;
  };
  const durationHours = num('durationHours', body.durationHours, 0.5, 24, 'job length in hours');
  let powerKw;
  if (body.powerKw !== undefined && body.powerKw !== null) powerKw = num('powerKw', body.powerKw, 0.001, 10000, 'average power draw');
  else if (body.servers !== undefined && body.servers !== null) {
    const servers = num('servers', body.servers, 1, 100000);
    const watts = num('serverWatts', body.serverWatts ?? 250, 1, 5000);
    powerKw = (servers * watts) / 1000;
  } else throw new AdvisorError('give either powerKw or servers (with serverWatts)', 'powerKw');
  const windowHours = body.windowHours === undefined ? 24 : num('windowHours', body.windowHours, 1, MAX_WINDOW_H, 'how far ahead to look');
  let deadline = null;
  if (body.deadline !== undefined && body.deadline !== null && body.deadline !== '') {
    deadline = Date.parse(body.deadline);
    if (typeof body.deadline !== 'string' || !Number.isFinite(deadline)) throw new AdvisorError('deadline must be an ISO date-time such as 2024-05-01T18:00:00Z', 'deadline');
  }
  return { durationHours, powerKw, windowHours, deadline };
}

// Normalise the API payload to [{start (ms), intensity}] on a 30-minute grid, sorted, de-duplicated.
export function normalise(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const bySlot = new Map();
  for (const r of rows) {
    const start = Date.parse(r?.from);
    const v = r?.intensity?.forecast ?? r?.intensity?.actual;
    if (Number.isFinite(start) && typeof v === 'number' && Number.isFinite(v) && v >= 0) bySlot.set(start, v);
  }
  return [...bySlot].sort((a, b) => a[0] - b[0]).map(([start, intensity]) => ({ start, intensity }));
}

// Average intensity over [s, s+dur) for a piecewise-constant half-hourly series (time-weighted).
function avgIntensity(slots, i0, s, durMs) {
  let acc = 0;
  const end = s + durMs;
  for (let i = i0; i < slots.length && slots[i].start < end; i += 1) {
    const a = Math.max(slots[i].start, s);
    const b = Math.min(slots[i].start + SLOT_MS, end);
    if (b > a) acc += slots[i].intensity * (b - a);
  }
  return acc / durMs;
}

// Pure search. slots: normalised series starting at "now"'s slot. Returns the response body minus source metadata.
export function findWindow(slots, { durationHours, powerKw, windowHours, deadline }) {
  if (slots.length < 2) throw new AdvisorError('no carbon forecast data available', undefined, 503);
  const durMs = durationHours * HOUR_MS;
  const t0 = slots[0].start;
  const dataEnd = slots[slots.length - 1].start + SLOT_MS;
  const lastStart = Math.min(t0 + windowHours * HOUR_MS, deadline ? deadline - durMs : Infinity, dataEnd - durMs);
  if (lastStart < t0) {
    throw deadline && deadline - durMs < t0
      ? new AdvisorError(`the deadline is too soon: a ${durationHours} h job started now would finish after it`, 'deadline')
      : new AdvisorError(`the forecast only covers ${round((dataEnd - t0) / HOUR_MS, 1)} h, which is shorter than the job`, 'durationHours');
  }
  const kwh = powerKw * durationHours;
  let best = null;
  let now = null;
  for (let i = 0; i < slots.length && slots[i].start <= lastStart; i += 1) {
    const avg = avgIntensity(slots, i, slots[i].start, durMs);
    const c = { start: slots[i].start, avg };
    if (i === 0) now = c;
    if (!best || avg < best.avg - 1e-9) best = c; // earliest start wins ties
  }
  const co2 = (c) => (kwh * c.avg) / 1000;
  const bestKg = co2(best);
  const nowKg = co2(now);
  const out = (c) => ({ start: isoMinute(c.start), end: isoMinute(c.start + durMs), avgIntensity: round(c.avg, 1), co2Kg: round(co2(c), 3) });
  return {
    best: out(best),
    now: { ...out(now) },
    savingKg: round(nowKg - bestKg, 3),
    savingPct: nowKg > 0 ? round(((nowKg - bestKg) / nowKg) * 100, 1) : 0,
    energyKwh: round(kwh, 3),
    series: slots.filter((s) => s.start < Math.max(lastStart + durMs, t0 + windowHours * HOUR_MS)).map((s) => ({ start: isoMinute(s.start), intensity: s.intensity })),
    window: { from: isoMinute(t0), latestStart: isoMinute(lastStart) },
  };
}

// Offline series: the typical hourly profile tiled over 48 h from the current half-hour.
export function profileSlots(t0) {
  return Array.from({ length: 96 }, (_, i) => {
    const start = t0 + i * SLOT_MS;
    return { start, intensity: PROFILE[new Date(start).getUTCHours()] };
  });
}

export function createAdvisor({ fetchFn = globalThis.fetch, now = () => Date.now(), baseUrl = DEFAULT_BASE_URL, ttlMs = CACHE_TTL_MS, timeoutMs = TIMEOUT_MS } = {}) {
  const cache = new Map(); // from-slot -> { at, slots }

  async function load(t0) {
    const key = `${baseUrl}|${isoMinute(t0)}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttlMs) return { slots: hit.slots, fetchedAt: hit.at, source: 'live', cached: true };
    try {
      if (typeof fetchFn !== 'function') throw new Error('fetch is not available');
      const res = await fetchFn(`${baseUrl}/intensity/${isoMinute(t0)}/fw48h`, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`carbon API returned HTTP ${res.status}`);
      const slots = normalise(await res.json()).filter((s) => s.start >= t0 - SLOT_MS);
      if (slots.length < 4) throw new Error('carbon API returned too little data');
      const at = now();
      cache.set(key, { at, slots });
      for (const [k, v] of cache) if (at - v.at > ttlMs) cache.delete(k); // keep the cache small
      return { slots, fetchedAt: at, source: 'live', cached: false };
    } catch (err) {
      return { slots: profileSlots(t0), fetchedAt: now(), source: 'profile', cached: false, reason: err?.name === 'TimeoutError' ? 'timed out' : String(err?.message || err) };
    }
  }

  return async function advise(body) {
    const req = parseRequest(body);
    const t0 = Math.floor(now() / SLOT_MS) * SLOT_MS;
    const { slots, fetchedAt, source, cached, reason } = await load(t0);
    // The API may start a slot earlier than requested; the first slot at or after t0's slot is "now"
    const usable = slots.filter((s) => s.start >= t0);
    const result = findWindow(usable, req);
    return {
      ...result,
      source,
      fetchedAt: new Date(fetchedAt).toISOString(),
      cached,
      grid: source === 'live' ? 'UK National Grid (carbonintensity.org.uk)' : 'typical profile (offline)',
      ...(source === 'profile' ? { notice: `offline - using typical profile (${reason})` } : {}),
    };
  };
}
