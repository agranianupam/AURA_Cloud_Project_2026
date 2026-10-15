// Auto-Optimizer: sweeps server count, headroom and deferrable share with the real forecast engine and picks the best
// feasible combination for a goal. Capacity is varied against a FIXED workload (the one the base fleet would carry),
// so fewer servers genuinely risk SLA misses and more servers genuinely cost idle power.
import { EngineError } from './engine.js';

export const OBJECTIVES = {
  energy: { key: 'energyKwh', label: 'energy used' },
  carbon: { key: 'co2Kg', label: 'carbon emitted' },
  cost: { key: 'cost', label: 'cost' },
};
export const MAX_RUNS = 150;
const COARSE_BUDGET = 96;
const DEFAULT_RANGES = (base) => ({
  servers: [Math.max(5, Math.round(base.servers * 0.2)), Math.min(1000, Math.round(base.servers * 1.5))],
  headroom: [0.05, 0.5],
  deferrableShare: [0.1, 0.6],
});
const INT_FIELDS = new Set(['servers']);
const LIMITS = { servers: [1, 1000], headroom: [0, 2], deferrableShare: [0, 1] };

function bad(message, field) { return new EngineError('validation', message, field); }

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function parseRequest(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw bad('request body must be a JSON object');
  const objective = body.objective ?? 'energy';
  if (!Object.hasOwn(OBJECTIVES, objective)) throw bad(`objective must be one of ${Object.keys(OBJECTIVES).join(', ')}`, 'objective');
  const slaFloor = body.slaFloor ?? 99;
  if (!isNum(slaFloor) || slaFloor < 50 || slaFloor > 100) throw bad('slaFloor must be a number between 50 and 100', 'slaFloor');
  const base = body.base ?? {};
  if (base === null || typeof base !== 'object' || Array.isArray(base)) throw bad('base must be an object of simulate inputs', 'base');
  if (base.servers !== undefined && (!Number.isInteger(base.servers) || base.servers < 1 || base.servers > 1000)) {
    throw bad('base.servers must be a whole number between 1 and 1000', 'base.servers');
  }
  const baseServers = base.servers ?? 50;
  const ranges = body.ranges ?? {};
  if (ranges === null || typeof ranges !== 'object' || Array.isArray(ranges)) throw bad('ranges must be an object', 'ranges');
  const defaults = DEFAULT_RANGES({ servers: baseServers });
  const out = {};
  for (const name of Object.keys(defaults)) {
    const r = ranges[name] ?? defaults[name];
    const f = `ranges.${name}`;
    if (!Array.isArray(r) || r.length !== 2 || !r.every(isNum)) throw bad(`${f} must be [min, max]`, f);
    const [lo, hi] = r;
    if (lo > hi) throw bad(`${f}: min must not exceed max`, f);
    const [L, H] = LIMITS[name];
    if (lo < L || hi > H) throw bad(`${f} must stay between ${L} and ${H}`, f);
    if (INT_FIELDS.has(name) && (!Number.isInteger(lo) || !Number.isInteger(hi))) throw bad(`${f} must be whole numbers`, f);
    out[name] = [lo, hi];
  }
  for (const k of Object.keys(ranges)) if (!(k in defaults)) throw bad(`unknown range '${k}'; use servers, headroom or deferrableShare`, `ranges.${k}`);
  const maxRuns = body.maxRuns ?? MAX_RUNS;
  if (!Number.isInteger(maxRuns) || maxRuns < 10 || maxRuns > MAX_RUNS) throw bad(`maxRuns must be a whole number between 10 and ${MAX_RUNS}`, 'maxRuns');
  const { servers: _s, headroom: _h, deferrableShare: _d, workloadServers: _w, ...fixed } = base;
  return { objective, slaFloor, baseServers, ranges: out, fixed, maxRuns, baseShare: base.deferrableShare };
}

const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

function levels([lo, hi], n, integer) {
  if (lo === hi || n <= 1) return [integer ? Math.round(lo) : lo];
  const set = new Set();
  for (let i = 0; i < n; i++) {
    const v = lo + ((hi - lo) * i) / (n - 1);
    set.add(integer ? Math.round(v) : round(v, 3));
  }
  return [...set].sort((a, b) => a - b);
}

// Choose per-dimension level counts whose product stays within the budget (servers get the most levels).
function plan(ranges, budget) {
  const counts = { servers: 6, headroom: 4, deferrableShare: 4 };
  const size = () => Object.entries(counts).reduce((p, [k, c]) => p * levels(ranges[k], c, INT_FIELDS.has(k)).length, 1);
  while (size() > budget) {
    const k = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    counts[k] -= 1;
  }
  return Object.fromEntries(Object.keys(counts).map((k) => [k, levels(ranges[k], counts[k], INT_FIELDS.has(k))]));
}

// Non-dominated points when maximising energy saved and SLA together.
export function paretoFront(points) {
  const sorted = [...points].sort((a, b) => b.slaPct - a.slaPct || b.energySavedKwh - a.energySavedKwh);
  const front = [];
  let bestEnergy = -Infinity;
  for (const p of sorted) {
    if (p.energySavedKwh > bestEnergy) { front.push(p); bestEnergy = p.energySavedKwh; }
  }
  return front;
}

export async function optimize(engine, body) {
  const t0 = Date.now();
  const req = parseRequest(body);
  const obj = OBJECTIVES[req.objective];
  const cache = new Map();
  const warnings = [];
  const key = (p) => `${p.servers}|${p.headroom}|${p.deferrableShare}`;
  const priceOf = (sim) => sim.params.pricePerKwh;

  // Reference: the user's current fleet, always on. Savings are reported against it so all candidates share one baseline.
  const baseParams = { ...req.fixed, servers: req.baseServers, workloadServers: req.baseServers };
  const baseRun = await engine.simulate(baseParams);
  const ref = { energyKwh: baseRun.summary.baselineKwh, co2Kg: baseRun.summary.baselineCo2Kg, cost: baseRun.summary.baselineKwh * priceOf(baseRun) };
  const fixedOut = { ...baseRun.params };
  let runs = 1;

  const evaluate = async (point) => {
    const k = key(point);
    if (cache.has(k)) return cache.get(k);
    const params = { ...req.fixed, ...point, workloadServers: req.baseServers };
    const sim = await engine.simulate(params);
    runs += 1;
    const s = sim.summary;
    const cand = {
      params: { ...point },
      energyKwh: s.energyKwh, co2Kg: s.co2Kg, cost: round(s.energyKwh * priceOf(sim), 2),
      energySavedKwh: round(ref.energyKwh - s.energyKwh, 1), co2SavedKg: round(ref.co2Kg - s.co2Kg, 1),
      costSaved: round(ref.cost - s.energyKwh * priceOf(sim), 2), slaPct: s.slaPct, slaMissHours: s.slaMissHours,
      feasible: s.slaPct >= req.slaFloor,
    };
    cache.set(k, { cand, summary: s });
    return cache.get(k);
  };
  const pick = (entries) => {
    const feas = entries.filter((e) => e.cand.feasible);
    const pool = feas.length ? feas : [];
    return pool.reduce((best, e) => (best === null || e.cand[obj.key] < best.cand[obj.key] - 1e-9 ? e : best), null);
  };

  // 1) coarse grid
  const grid = plan(req.ranges, Math.min(COARSE_BUDGET, req.maxRuns - 40));
  for (const servers of grid.servers) {
    for (const headroom of grid.headroom) {
      for (const deferrableShare of grid.deferrableShare) await evaluate({ servers, headroom, deferrableShare });
    }
  }
  // 2) refine around the best feasible point (or the highest-SLA point when nothing is feasible)
  const nearest = (arr, v) => arr.reduce((i, x, j) => (Math.abs(x - v) < Math.abs(arr[i] - v) ? j : i), 0);
  let center = pick([...cache.values()]);
  if (!center) center = [...cache.values()].reduce((b, e) => (e.cand.slaPct > b.cand.slaPct ? e : b));
  const around = (name, step) => {
    const [lo, hi] = req.ranges[name];
    const v = center.cand.params[name];
    const isInt = INT_FIELDS.has(name);
    const pts = new Set([v]);
    for (const d of [-step / 2, step / 2, -step / 4, step / 4]) {
      const x = Math.min(hi, Math.max(lo, v + d));
      pts.add(isInt ? Math.round(x) : round(x, 3));
    }
    return [...pts];
  };
  const stepOf = (name) => {
    const g = grid[name];
    if (g.length < 2) return 0;
    const i = nearest(g, center.cand.params[name]);
    return Math.max(...[g[i] - (g[i - 1] ?? g[i]), (g[i + 1] ?? g[i]) - g[i]]);
  };
  const fine = [];
  for (const servers of stepOf('servers') ? around('servers', stepOf('servers')) : [center.cand.params.servers]) {
    for (const headroom of stepOf('headroom') ? around('headroom', stepOf('headroom')) : [center.cand.params.headroom]) {
      for (const deferrableShare of stepOf('deferrableShare') ? around('deferrableShare', stepOf('deferrableShare')) : [center.cand.params.deferrableShare]) {
        fine.push({ servers, headroom, deferrableShare });
      }
    }
  }
  for (const p of fine) {
    if (runs >= req.maxRuns) { warnings.push(`Stopped refining after ${req.maxRuns} runs.`); break; }
    await evaluate(p);
  }

  const all = [...cache.values()];
  const winner = pick(all);
  const candidates = all.map((e) => e.cand);
  const out = {
    objective: req.objective,
    objectiveLabel: obj.label,
    slaFloor: req.slaFloor,
    runs,
    elapsedMs: Date.now() - t0,
    reference: { servers: req.baseServers, energyKwh: round(ref.energyKwh, 1), co2Kg: round(ref.co2Kg, 1), cost: round(ref.cost, 2) },
    base: { params: { servers: req.baseServers, headroom: baseRun.params.headroom, deferrableShare: baseRun.params.deferrableShare }, summary: baseRun.summary },
    candidates,
    pareto: paretoFront(candidates),
    warnings,
  };
  if (winner) {
    out.best = { params: winner.cand.params, summary: winner.summary, energySavedKwh: winner.cand.energySavedKwh,
      co2SavedKg: winner.cand.co2SavedKg, costSaved: winner.cand.costSaved, slaPct: winner.cand.slaPct };
    out.best.applyParams = { ...fixedOut, ...winner.cand.params };
    delete out.best.applyParams.workloadServers;
    out.explanation = explain(out, req);
  } else {
    out.best = null;
    const top = candidates.reduce((b, c) => (c.slaPct > b.slaPct ? c : b));
    out.closest = top;
    out.explanation = `No combination reached an SLA of ${req.slaFloor}%. The best service level found was ${top.slaPct}% with ${top.params.servers} servers `
      + `and ${Math.round(top.params.headroom * 100)}% headroom; widen the server range, lower the SLA floor or raise the headroom range.`;
  }
  return out;
}

function explain(out, req) {
  const b = out.best;
  const p = b.params;
  const metric = { energy: `${b.energySavedKwh.toLocaleString('en')} kWh of energy`, carbon: `${b.co2SavedKg.toLocaleString('en')} kg of CO2`,
    cost: `$${b.costSaved.toLocaleString('en')}` }[req.objective];
  const infeasible = out.candidates.filter((c) => !c.feasible).length;
  return `With ${p.servers} servers, ${Math.round(p.headroom * 100)}% headroom and ${Math.round(p.deferrableShare * 100)}% deferrable work AURA saves `
    + `${metric} compared with keeping ${out.reference.servers} servers always on, while meeting the service level ${b.slaPct}% of hours `
    + `(floor ${req.slaFloor}%). ${infeasible} of ${out.candidates.length} tried combinations were too risky for that floor: trimming servers or headroom `
    + `further saves more energy but starts missing demand.`;
}
