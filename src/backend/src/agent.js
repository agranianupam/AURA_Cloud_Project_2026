// Talk to AURA: turns a plain-English request into simulate inputs.
// With ANTHROPIC_API_KEY / GEMINI_API_KEY the model extracts the parameters; without a key (or on any AI error)
// the rule-based parser below does it, so the feature always works offline.
import { askClaude, askGemini } from './explain.js';

export const DATA_MIN = '2018-07-15';
export const DATA_MAX = '2019-10-21';
const DEFAULT_START = '2019-08-12';
const GRIDS = ['low', 'medium', 'high', 'india'];
const EVENTS = ['exam', 'break', 'holiday', 'event'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const DAY_RE = '(\\d{1,2})(?!\\d)(?:st|nd|rd|th)?';

const iso = (d) => d.toISOString().slice(0, 10);
const utc = (y, m, d) => new Date(Date.UTC(y, m, d));
const addDays = (s, n) => iso(new Date(new Date(`${s}T00:00:00Z`).getTime() + n * 86400000));
const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const num = (x) => (x === '' || x === null || x === undefined ? NaN : Number(x));
const monthIdx = (name) => MONTHS.indexOf(name.slice(0, 3));
// Data covers Jul 2018 - Oct 2019: a month with no year means 2019 when 2019 has data for it, else 2018.
const guessYear = (mon, y) => y ?? (mon <= 9 ? 2019 : 2018);

// Clamp whatever a parser/model produced to the ranges the engine enforces. Corrections go to `notes`.
export function sanitize(raw = {}) {
  const params = {};
  const notes = [];
  const clamp = (key, label, lo, hi, int = false) => {
    let v = num(raw[key]);
    if (!Number.isFinite(v)) return;
    if (int) v = Math.round(v);
    const c = Math.min(hi, Math.max(lo, v));
    if (c !== v) notes.push(`${label} ${v} is outside ${lo}-${hi}, so I used ${c}.`);
    params[key] = c;
  };
  clamp('servers', 'Servers', 1, 1000, true);
  clamp('idleWatts', 'Idle power', 10, 500);
  const shareIn = num(raw.deferrableShare);
  if (Number.isFinite(shareIn)) raw = { ...raw, deferrableShare: shareIn > 1 && shareIn <= 100 ? shareIn / 100 : shareIn };
  clamp('deferrableShare', 'Flexible share', 0, 1);
  clamp('peakWatts', 'Peak power', (params.idleWatts ?? 100) + 1, 1500);
  if (GRIDS.includes(raw.carbonGrid)) params.carbonGrid = raw.carbonGrid;
  if (Array.isArray(raw.events)) {
    const ev = [...new Set(raw.events.filter((e) => EVENTS.includes(e)))];
    if (ev.length) params.events = ev;
  }
  let start = isDate(raw.startDate) ? raw.startDate : undefined;
  let end = isDate(raw.endDate) ? raw.endDate : undefined;
  if (start || end) {
    start ??= addDays(end, -6);
    end ??= addDays(start, 6);
    if (end < start) [start, end] = [end, start];
    const s0 = start;
    const e0 = end;
    const span = daysBetween(s0, e0);
    if (start < DATA_MIN) start = DATA_MIN;
    if (start > DATA_MAX) start = addDays(DATA_MAX, -Math.min(6, span));
    if (end > DATA_MAX) end = DATA_MAX;
    if (end < start) end = start;
    if (daysBetween(start, end) > 30) end = addDays(start, 30);
    if (start !== s0 || end !== e0) notes.push(`Our building data covers ${DATA_MIN} to ${DATA_MAX} (max 31 days), so I used ${start} to ${end}.`);
    params.startDate = start;
    params.endDate = end;
  }
  return { params, notes };
}

function durationDays(t) {
  const m = t.match(/\b(\d+|a|one|two|three|four|five|six)\s*(day|week|month)s?\b/);
  if (m) {
    const words = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
    const k = Number.isNaN(Number(m[1])) ? words[m[1]] : Number(m[1]);
    return k * { day: 1, week: 7, month: 30 }[m[2]];
  }
  if (/\bfortnight\b/.test(t)) return 14;
  if (/\bweek\b/.test(t)) return 7;
  if (/\bmonth\b/.test(t)) return 30;
  if (/\bday\b|\btoday\b|\bovernight\b/.test(t)) return 1;
  return null;
}

function parseDates(t, understood, assumptions) {
  const yearNote = (y, given) => { if (!given) assumptions.push(`No year given, so I used ${y}.`); };

  const isos = [...t.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)].map((x) => x[0]).filter(isDate);
  if (isos.length) {
    const a = isos[0];
    const b = isos[1] ?? addDays(a, 6);
    understood.push(`dates ${a} to ${b}`);
    if (!isos[1]) assumptions.push('No end date given, so I used a 7-day period.');
    return { startDate: a, endDate: b };
  }
  const sep = '\\s*(?:-|–|to|until|through|till)\\s*';
  // "5 aug to 12 aug 2019", "5-12 aug"
  let m = t.match(new RegExp(`\\b${DAY_RE}\\s*(?:${MONTH_RE})?${sep}${DAY_RE}\\s+${MONTH_RE}(?:\\s*,?\\s*(\\d{4}))?`));
  if (m) {
    const mon2 = monthIdx(m[4]);
    const mon1 = m[2] ? monthIdx(m[2]) : mon2;
    const y = guessYear(mon2, m[5] ? Number(m[5]) : null);
    const a = iso(utc(y, mon1, Number(m[1])));
    const b = iso(utc(y, mon2, Number(m[3])));
    understood.push(`dates ${a} to ${b}`);
    yearNote(y, m[5]);
    return { startDate: a, endDate: b };
  }
  // "aug 5 - aug 12", "march 3 to 9 2019"
  m = t.match(new RegExp(`\\b${MONTH_RE}\\s+${DAY_RE}${sep}(?:${MONTH_RE}\\s+)?${DAY_RE}(?:\\s*,?\\s*(\\d{4}))?`));
  if (m) {
    const mon1 = monthIdx(m[1]);
    const mon2 = m[3] ? monthIdx(m[3]) : mon1;
    const y = guessYear(mon1, m[5] ? Number(m[5]) : null);
    const a = iso(utc(y, mon1, Number(m[2])));
    const b = iso(utc(y, mon2, Number(m[4])));
    understood.push(`dates ${a} to ${b}`);
    yearNote(y, m[5]);
    return { startDate: a, endDate: b };
  }
  // single start date, optional duration: "5 aug for 10 days"
  m = t.match(new RegExp(`\\b${DAY_RE}\\s+${MONTH_RE}(?:\\s*,?\\s*(\\d{4}))?|\\b${MONTH_RE}\\s+${DAY_RE}(?:\\s*,?\\s*(\\d{4}))?`));
  if (m) {
    const [dd, mm, yy] = m[1] ? [m[1], m[2], m[3]] : [m[5], m[4], m[6]];
    const mon = monthIdx(mm);
    const y = guessYear(mon, yy ? Number(yy) : null);
    const dur = durationDays(t);
    const n = Math.min(dur ?? 7, 31);
    const a = iso(utc(y, mon, Number(dd)));
    understood.push(`start ${a} for ${n} day${n > 1 ? 's' : ''}`);
    yearNote(y, yy);
    if (!dur) assumptions.push('No length given, so I used 7 days.');
    return { startDate: a, endDate: addDays(a, n - 1) };
  }
  // whole month: "in september", "march 2019"
  m = t.match(new RegExp(`\\b${MONTH_RE}(?:\\s*,?\\s*(\\d{4}))?\\b`));
  if (m && !(m[1] === 'may' && !/\bin may\b|\bmay \d{4}\b|\bof may\b|\bduring may\b/.test(t))) {
    const mon = monthIdx(m[1]);
    const y = guessYear(mon, m[2] ? Number(m[2]) : null);
    const a = iso(utc(y, mon, 1));
    const dur = durationDays(t);
    const n = Math.min(dur && !/\bmonth\b/.test(t) ? dur : 31, 31);
    understood.push(`${m[1]} ${y}`);
    yearNote(y, m[2]);
    if (n < 31) assumptions.push(`Started on the 1st of the month for ${n} days.`);
    return { startDate: a, endDate: addDays(a, n - 1) };
  }
  return null;
}

export function ruleBasedParse(text) {
  const t = ` ${String(text).toLowerCase().replace(/\s+/g, ' ')} `;
  const understood = [];
  const assumptions = [];
  const raw = {};
  let score = 0;

  let m = t.match(/(\d[\d,]*)\s*(?:servers?|machines?|nodes?|hosts?|vms?|computers?)\b/)
    || t.match(/\b(?:servers?|pool|fleet|cluster)\s*(?:of|size|=|:)?\s*(\d[\d,]*)\b/);
  if (m) { raw.servers = Number(m[1].replace(/,/g, '')); understood.push(`${raw.servers} servers`); score++; }

  m = t.match(/idle[^.\d]{0,20}?(\d+(?:\.\d+)?)\s*w(?:atts?)?\b/) || t.match(/(\d+(?:\.\d+)?)\s*w(?:atts?)?\s*(?:when\s*)?idle/);
  if (m) { raw.idleWatts = Number(m[1]); understood.push(`idle power ${raw.idleWatts} W`); score++; }
  m = t.match(/(?:peak|max(?:imum)?|full[- ]load)[^.\d]{0,20}?(\d+(?:\.\d+)?)\s*w(?:atts?)?\b/) || t.match(/(\d+(?:\.\d+)?)\s*w(?:atts?)?\s*(?:at\s*)?(?:peak|full)/);
  if (m) { raw.peakWatts = Number(m[1]); understood.push(`peak power ${raw.peakWatts} W`); score++; }

  const FLEX = '(?:deferr?able|flexible|batch|shiftable|movable|delayable)';
  m = t.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:%|percent|per cent)\\s*(?:of\\s*(?:the\\s*)?(?:load|work(?:load)?|jobs?)\\s*)?(?:is\\s*|are\\s*|can be\\s*)?${FLEX}`))
    || t.match(new RegExp(`${FLEX}[^.\\d%]{0,25}?(\\d+(?:\\.\\d+)?)\\s*(?:%|percent|per cent)`));
  if (m) { raw.deferrableShare = Number(m[1]) / 100; understood.push(`${m[1]}% flexible workload`); score++; }
  else if (/\bno (?:deferr?able|flexible|batch)|\bnothing (?:can )?(?:be )?(?:deferred|shifted)/.test(t)) { raw.deferrableShare = 0; understood.push('no flexible workload'); score++; }
  else if (/\bfully flexible|\ball (?:of the )?(?:work|load|jobs?)\b[^.]*\b(?:deferr?able|flexible)/.test(t)) { raw.deferrableShare = 1; understood.push('fully flexible workload'); score++; }

  if (/\bindia(?:n)?\b/.test(t)) { raw.carbonGrid = 'india'; understood.push('India grid'); score++; }
  else if (/\b(?:uk|u\.k\.|britain|british|england|united kingdom)\b/.test(t)) {
    raw.carbonGrid = 'low'; understood.push('UK grid (low carbon)');
    assumptions.push('The UK grid is approximated by the "low carbon" profile (~200 g/kWh).'); score++;
  } else if (/\b(?:dirt(?:y|ier|iest)|high[- ]carbon|coal|polluted|polluting|carbon[- ]heavy|fossil|high grid)\b/.test(t)) { raw.carbonGrid = 'high'; understood.push('high-carbon (dirty) grid'); score++; }
  else if (/\b(?:clean(?:er|est)?|green|low[- ]carbon|renewables?|hydro|nuclear|low grid)\b/.test(t)) { raw.carbonGrid = 'low'; understood.push('low-carbon (clean) grid'); score++; }
  else if (/\b(?:medium|average|typical|moderate|mixed)\b[^.]{0,15}\b(?:grid|carbon)\b/.test(t)) { raw.carbonGrid = 'medium'; understood.push('medium-carbon grid'); score++; }

  const events = [];
  if (/\bexams?\b|\bfinals?\b|\bmidterms?\b/.test(t)) events.push('exam');
  if (/\b(?:break|vacation|recess)\b|\bquiet period\b/.test(t)) events.push('break');
  if (/\bholidays?\b|\bfestival\b/.test(t)) events.push('holiday');
  if (/\bunplanned\b|\bsurge\b|\bspike\b|\bconference\b|\bopen day\b|\bsudden\b|\bunexpected\b|\bcampus event\b|\bspecial event\b/.test(t)) events.push('event');
  if (events.length) { raw.events = events; understood.push(`events: ${events.join(', ')}`); score++; }

  const dates = parseDates(t, understood, assumptions);
  if (dates) { Object.assign(raw, dates); score++; }
  else {
    const dur = durationDays(t);
    if (dur && /\b(?:week|month|day|fortnight)s?\b/.test(t)) {
      const n = Math.min(dur, 31);
      raw.startDate = DEFAULT_START;
      raw.endDate = addDays(DEFAULT_START, n - 1);
      understood.push(`${n}-day period`);
      assumptions.push(`No dates given, so I started on ${DEFAULT_START}, the first day of our test data.`);
      score++;
    } else if (events.length) {
      raw.startDate = DEFAULT_START;
      raw.endDate = addDays(DEFAULT_START, 6);
      assumptions.push(`No dates given, so I used the week starting ${DEFAULT_START} (our test data).`);
    }
  }

  const { params, notes } = sanitize(raw);
  assumptions.push(...notes);
  const missing = ['servers', 'carbonGrid', 'deferrableShare'].filter((k) => params[k] === undefined);
  if (missing.length && score) assumptions.push(`Not mentioned, so left at the current form values: ${missing.join(', ')}.`);
  return { params, understood, assumptions, confidence: score >= 3 ? 'high' : score >= 1 ? 'medium' : 'low', source: 'rules' };
}

const LLM_SYSTEM = `You convert a teacher's request about a university data-center simulation into JSON for a simulator. Reply with ONE JSON object and nothing else:
{"params": {...}, "understood": [short strings], "assumptions": [short strings]}
"params" may contain only these keys, and ONLY ones the request actually mentions or clearly implies:
startDate, endDate ("YYYY-MM-DD", inclusive, within ${DATA_MIN}..${DATA_MAX}, span at most 31 days; default year 2019 if unspecified), servers (integer 1-1000), idleWatts (10-500), peakWatts (idleWatts+1 to 1500), deferrableShare (0-1; 30% = 0.3), carbonGrid (one of "low","medium","high","india": clean/renewable=low, dirty/coal=high, India=india, UK=low), events (array from "exam","break","holiday","event"; "event" = unplanned surge).
List every assumption you made (e.g. dates you picked) in "assumptions". Never invent values for things not mentioned.`;

function extractJson(text) {
  const s = String(text ?? '').replace(/```(?:json)?/gi, '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('no JSON in reply');
  return JSON.parse(s.slice(a, b + 1));
}

const strings = (x) => (Array.isArray(x) ? x.filter((v) => typeof v === 'string').slice(0, 10).map((v) => v.slice(0, 200)) : []);

export async function parseRequest(text) {
  const rules = ruleBasedParse(text);
  const claudeKey = process.env.ANTHROPIC_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!claudeKey && !geminiKey) return rules;
  const messages = [{ role: 'user', content: String(text) }];
  try {
    const reply = claudeKey
      ? await askClaude(claudeKey, messages, { system: LLM_SYSTEM, maxTokens: 600 })
      : await askGemini(geminiKey, messages, { system: LLM_SYSTEM });
    const json = extractJson(reply);
    const { params, notes } = sanitize(json.params ?? {});
    if (!Object.keys(params).length) throw new Error('model returned no usable parameters');
    const understood = strings(json.understood);
    return {
      params,
      understood: understood.length ? understood : Object.keys(params).map((k) => `${k} = ${JSON.stringify(params[k])}`),
      assumptions: [...strings(json.assumptions), ...notes],
      confidence: Object.keys(params).length >= 3 ? 'high' : 'medium',
      source: claudeKey ? 'claude' : 'gemini',
    };
  } catch (e) {
    return { ...rules, note: `AI unavailable (${e.message}); used the built-in parser.` };
  }
}
