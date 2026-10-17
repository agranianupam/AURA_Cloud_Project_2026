
import http from 'node:http';

const PORT = process.env.PORT || 3000;
const GRID = { low: 200, medium: 400, high: 650, india: 700 };
const DAY = 86400000;

const send = (res, status, body) => {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  res.end(JSON.stringify(body));
};
const err = (res, status, code, message, field) =>
  send(res, status, { error: { code, message, ...(field ? { field } : {}) } });
const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });

const baseKw = (h, dow) =>
  (dow === 0 || dow === 6 ? 6 : 10) + (h >= 8 && h <= 18 ? 14 : h >= 19 && h <= 22 ? 6 : 0);

function validate(p) {
  const d = { servers: 50, idleWatts: 100, peakWatts: 250, deferrableShare: 0.3, carbonGrid: 'medium', events: [], ...p };
  const num = (f, lo, hi) => {
    if (typeof d[f] !== 'number' || !(d[f] >= lo && d[f] <= hi)) throw { field: f, message: `${f} must be between ${lo} and ${hi}` };
  };
  num('servers', 1, 1000);
  num('idleWatts', 10, 500);
  num('peakWatts', d.idleWatts + 1, 1500);
  num('deferrableShare', 0, 1);
  if (!GRID[d.carbonGrid]) throw { field: 'carbonGrid', message: 'carbonGrid must be low, medium, high or india' };
  d.startDate ||= '2019-08-12';
  const s = new Date(d.startDate + 'T00:00:00Z');
  if (isNaN(s)) throw { field: 'startDate', message: 'startDate must be YYYY-MM-DD' };
  const e = new Date((d.endDate || new Date(+s + 6 * DAY).toISOString().slice(0, 10)) + 'T00:00:00Z');
  if (isNaN(e)) throw { field: 'endDate', message: 'endDate must be YYYY-MM-DD' };
  if (e < s) throw { field: 'endDate', message: 'endDate must be on or after startDate' };
  if ((e - s) / DAY > 30) throw { field: 'endDate', message: 'Date range cannot exceed 31 days' };
  return { d, s, e };
}

function simulate(d, demand) {
  const ci0 = GRID[d.carbonGrid];
  const hourly = [];
  let eSaved = 0, cSaved = 0, money = 0, ok = 0;
  for (const { ts, kw } of demand) {
    const h = new Date(ts).getUTCHours();
    const ci = ci0 * (1 + 0.3 * Math.cos(((h - 15) / 24) * 2 * Math.PI));
    const unitKw = d.peakWatts / 1000;
    const serversOn = Math.min(d.servers, Math.max(1, Math.ceil((kw * 1.1) / unitKw)));
    const shift = h >= 1 && h <= 5 ? 1 + d.deferrableShare * 0.2 : 1 - d.deferrableShare * 0.05;
    const dyn = ((d.peakWatts - d.idleWatts) / 1000) * Math.min(serversOn, kw / unitKw);
    const energy = ((serversOn * d.idleWatts) / 1000 + dyn) * shift;
    const base = (d.servers * d.idleWatts) / 1000 + dyn;
    hourly.push({
      ts,
      demandKw: +kw.toFixed(2),
      serversOn,
      energyKwh: +energy.toFixed(2),
      baselineKwh: +base.toFixed(2),
      co2G: Math.round(energy * ci),
      baselineCo2G: Math.round(base * ci),
      carbonIntensity: Math.round(ci),
    });
    eSaved += base - energy;
    cSaved += ((base - energy) * ci) / 1000;
    money += (base - energy) * 0.12;
    if (kw <= serversOn * unitKw) ok++;
  }
  const baseTotal = hourly.reduce((a, r) => a + r.baselineKwh, 0) || 1;
  const recommendations = [
    `Run only ${Math.min(...hourly.map((r) => r.serversOn))}-${Math.max(...hourly.map((r) => r.serversOn))} of your ${d.servers} servers; this saves about ${Math.round((eSaved / baseTotal) * 100)}% of energy.`,
    'Schedule batch jobs and backups between 01:00 and 05:00, when demand and grid carbon are lowest.',
    ...(d.deferrableShare < 0.2 ? ['Only a small share of your load is deferrable; making more jobs flexible would raise CO2 savings.'] : []),
    ...(d.events.includes('exam') ? ['Exam period selected: keep extra servers warm on exam days to protect service levels.'] : []),
  ];
  return {
    hourly,
    summary: {
      energySavedKwh: +eSaved.toFixed(1),
      co2SavedKg: +cSaved.toFixed(1),
      costSaved: +money.toFixed(2),
      slaPct: +((ok / hourly.length) * 100).toFixed(1),
    },
    recommendations,
  };
}

function demandFor(s, e, events) {
  const out = [];
  for (let t = +s; t < +e + DAY; t += 3600000) {
    const dt = new Date(t);
    let kw = baseKw(dt.getUTCHours(), dt.getUTCDay());
    if (events.includes('exam')) kw *= 1.3;
    if (events.includes('break') || events.includes('holiday')) kw *= 0.5;
    if (events.includes('event')) kw *= 1.1;
    out.push({ ts: dt.toISOString().replace('.000', ''), kw });
  }
  return out;
}

http
  .createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return send(res, 204, {});
    const url = new URL(req.url, 'http://x');
    try {
      if (req.method === 'POST' && url.pathname === '/api/simulate') {
        let p;
        try {
          p = JSON.parse((await readBody(req)).toString() || '{}');
        } catch {
          return err(res, 400, 'VALIDATION_ERROR', 'Body must be valid JSON');
        }
        const { d, s, e } = validate(p);
        return send(res, 200, simulate(d, demandFor(s, e, d.events)));
      }
      if (req.method === 'GET' && url.pathname === '/api/forecast/preview') {
        const date = url.searchParams.get('date');
        const s = new Date(date + 'T00:00:00Z');
        if (!date || isNaN(s)) return err(res, 400, 'VALIDATION_ERROR', 'date must be YYYY-MM-DD', 'date');
        const known = s < new Date('2019-10-22T00:00:00Z');
        const hourly = demandFor(s, s, []).map((r, i) => ({
          ts: r.ts,
          forecastKw: +r.kw.toFixed(2),
          ...(known ? { actualKw: +(r.kw * (0.92 + 0.16 * Math.abs(Math.sin(i)))).toFixed(2) } : {}),
        }));
        return send(res, 200, { date, hourly });
      }
      if (req.method === 'POST' && url.pathname === '/api/upload') {
        const buf = await readBody(req);
        if (buf.length > 5 * 1024 * 1024) return err(res, 413, 'TOO_LARGE', 'File is larger than 5 MB');
        const text = buf.toString('utf8');
        const field = (n) => (text.match(new RegExp(`name="${n}"\\r?\\n\\r?\\n([^\\r\\n]*)`)) || [])[1];
        if (!/timestamp,\s*kw/i.test(text)) return err(res, 422, 'CSV_INVALID', 'Header must be "timestamp,kw"');
        const rowRe = /^\d{4}-\d{2}-\d{2}[T ][^,]*,\s*-?[\d.]+\s*$/;
        const all = text.split(/\r?\n/).map((l) => l.trim());
        const lines = all.filter((l) => rowRe.test(l));
        if (!lines.length) return err(res, 422, 'CSV_INVALID', 'No valid rows found (expected e.g. 2019-08-12T00:00:00Z,12.5)');
        const byHour = new Map();
        for (const l of lines) {
          const [t, v] = l.split(',');
          const k = new Date(t.trim().replace(' ', 'T') + (/Z|\+/.test(t) ? '' : 'Z'));
          if (isNaN(k)) continue;
          k.setUTCMinutes(0, 0, 0);
          const a = byHour.get(+k) || [];
          a.push(+v);
          byHour.set(+k, a);
        }
        const demand = [...byHour]
          .sort((a, b) => a[0] - b[0])
          .map(([t, v]) => ({ ts: new Date(t).toISOString().replace('.000', ''), kw: v.reduce((x, y) => x + y) / v.length }));
        const d = { servers: 50, idleWatts: 100, peakWatts: 250, deferrableShare: 0.3, carbonGrid: field('carbonGrid') || 'medium', events: [] };
        for (const k of ['servers', 'idleWatts', 'peakWatts', 'deferrableShare']) if (field(k)) d[k] = +field(k);
        const warnings = [];
        const skipped = all.filter((l) => l && !rowRe.test(l) && !/^(timestamp|--|content-|$)/i.test(l) && /^\d/.test(l)).length;
        if (skipped) warnings.push(`${skipped} row(s) skipped because they could not be parsed`);
        return send(res, 200, { ...simulate(d, demand), warnings });
      }
      err(res, 404, 'INTERNAL', 'Not found');
    } catch (x) {
      if (x && x.message && x.field) return err(res, 400, 'VALIDATION_ERROR', x.message, x.field);
      err(res, 500, 'INTERNAL', String(x?.message || x));
    }
  })
  .listen(PORT, () => console.log(`AURA mock API on http://localhost:${PORT}`));

