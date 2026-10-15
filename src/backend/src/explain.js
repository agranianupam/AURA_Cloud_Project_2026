// AURA Explainer: explains a simulation result in plain language and answers follow-up questions.
// Uses the Claude API when ANTHROPIC_API_KEY is set; otherwise a built-in rule-based explainer, so it always works offline.

const MODEL = process.env.AURA_EXPLAIN_MODEL || 'claude-sonnet-5-5';

const SYSTEM = `You are AURA Explainer, an assistant inside a university data-center optimisation dashboard.
AURA forecasts campus demand with an LSTM trained on the CU-BEMS university-building dataset, then switches servers on/off ahead of demand and shifts deferrable batch jobs to low-carbon hours. "Baseline" means an always-on data center.
You get the JSON of one simulation run. Explain it to a teacher or administrator with no ML background: short, plain sentences, no jargon without a one-line definition.
Rules: use only the numbers in the JSON; never invent figures. Say these are simulated estimates, not measurements. If SLA misses or warnings exist, mention them honestly. Judge whether the result is good and why. Keep answers under 200 words unless asked for more.`;

const n = (x, d = 0) => Number(x).toLocaleString('en-US', { maximumFractionDigits: d });

// Trim a result to what the explainer needs (not hundreds of hourly rows).
export function compact(result = {}) {
  const hourly = result.hourly ?? [];
  const peak = hourly.reduce((m, h) => (h.demandKw > (m?.demandKw ?? -1) ? h : m), null);
  const cleanest = hourly.reduce((m, h) => (h.carbonIntensity < (m?.carbonIntensity ?? Infinity) ? h : m), null);
  return {
    summary: result.summary,
    params: result.params,
    model: result.model,
    daily: result.daily?.slice(0, 31),
    warnings: result.warnings,
    recommendations: result.recommendations,
    alerts: result.alerts?.slice(0, 8),
    peakHour: peak && { ts: peak.ts, demandKw: peak.demandKw, serversOn: peak.serversOn },
    cleanestHour: cleanest && { ts: cleanest.ts, carbonIntensity: cleanest.carbonIntensity },
    hours: hourly.length,
    upload: result.upload && { name: result.upload.name, similarity: result.upload.similarity },
  };
}

function overview(c) {
  const s = c.summary;
  const out = [];
  out.push(`**What happened.** For ${c.params?.startDate ?? 'the chosen period'} to ${c.params?.endDate ?? ''}, AURA predicted demand and kept only the servers needed. An always-on data center would have used ${n(s.baselineKwh)} kWh; AURA used ${n(s.energyKwh)} kWh, saving **${n(s.energySavedKwh)} kWh (${n(s.percentReduction, 1)}%)**.`);
  out.push(`**Carbon.** That avoids about **${n(s.co2SavedKg)} kg of CO₂** (${n(s.co2PercentReduction, 1)}%), partly by running flexible jobs when the grid is cleaner. The saved electricity is worth about $${n(s.costSaved)}.`);
  out.push(`**Service quality (SLA).** ${n(s.slaPct, 2)}% of hours had enough capacity${s.slaMissHours ? `, and ${s.slaMissHours} hour(s) fell short` : ', and no hours fell short'}. This matters because saving energy is only useful if users are still served.`);
  out.push(`**Servers.** On average ${n(s.avgServersOn, 1)} of ${c.params?.servers ?? '?'} servers were on; at the busiest hour ${s.peakServersOn} were needed.`);
  const good = s.slaPct >= 99 && s.percentReduction >= 20;
  let verdict;
  if (good) verdict = 'Yes: large savings with the service level intact.';
  else if (s.slaPct < 99) verdict = 'Be careful: the savings come with service misses, so consider more headroom or fewer unplanned surges.';
  else verdict = 'The savings are modest here, likely because demand is high or the fleet is small.';
  out.push(`**Is this good?** ${verdict}`);
  if (c.warnings?.length) out.push(`**Caveats.** ${c.warnings.slice(0, 3).join(' ')}`);
  out.push('_All figures are simulated estimates, not measured values._');
  return out.join('\n\n');
}

const TOPICS = [
  [/good|bad|worth|success|result ok|well|verdict|summar|overall|conclusion/i, (c) => {
    const s = c.summary;
    const ok = s.slaPct >= 99 && s.percentReduction >= 20;
    const why = `AURA cut energy by ${n(s.percentReduction, 1)}% and CO₂ by ${n(s.co2PercentReduction, 1)}% while ${n(s.slaPct, 2)}% of hours were fully served.`;
    if (ok) return `Yes, this is a good result. ${why} The key test is that savings did not hurt service. Remember these are simulated estimates${c.warnings?.length ? ', and the caveats above apply' : ''}.`;
    if (s.slaPct < 99) return `Mixed. ${why} But ${s.slaMissHours} hour(s) lacked capacity, so the savings cost some service quality. Try more servers or avoid unplanned surges.`;
    return `Modest. ${why} Savings are below 20%, which usually means demand is close to fleet capacity.`;
  }],
  [/sla|service|miss|capacity/i, (c) => `SLA is the share of hours with enough servers on to meet demand. Here it is ${n(c.summary.slaPct, 2)}% (${c.summary.slaMissHours} missed hour(s)). Higher is better; below about 99% means users could have felt slowdowns.`],
  [/carbon|co2|emission|grid/i, (c) => `Carbon is electricity use times how dirty the grid is each hour (${c.summary.carbonSource}). AURA saved ${n(c.summary.co2SavedKg)} kg CO₂ (${n(c.summary.co2PercentReduction, 1)}%). It beats energy savings alone by moving flexible jobs to the cleanest hour${c.cleanestHour ? ` (around ${c.cleanestHour.ts?.slice(11, 16)}, ${n(c.cleanestHour.carbonIntensity)} gCO₂/kWh)` : ''}.`],
  [/baseline|always|compare/i, (c) => `The baseline is a data center with every server always on. It would use ${n(c.summary.baselineKwh)} kWh; AURA used ${n(c.summary.energyKwh)} kWh. The gap is the saving.`],
  [/model|lstm|forecast|accura|predict/i, (c) => (c.model
    ? `The forecaster is an ${c.model.name}. On unseen test data its average error is ${c.model.testMaeKw} kW (${c.model.testMapePct}%), versus ${c.model.seasonalNaiveMaeKw} kW for the simple "same hour last week" guess. It is trained on one Thai university building, so results for other data are indicative.`
    : 'The forecaster is an LSTM trained on the CU-BEMS dataset.')],
  [/server|node|scal/i, (c) => `AURA scales servers to the forecast plus a safety margin (${n((c.params?.headroom ?? 0.25) * 100)}% headroom). On average ${n(c.summary.avgServersOn, 1)} servers were on, peaking at ${c.summary.peakServersOn}.`],
  [/cost|money|\$|price/i, (c) => `Cost saved is the saved energy times the electricity price ($${c.params?.pricePerKwh ?? 0.12}/kWh): about $${n(c.summary.costSaved)}.`],
  [/improve|better|recommend|suggest|what should/i, (c) => (c.recommendations?.length ? c.recommendations.join(' ') : 'Try a higher deferrable share or a dirtier-grid scenario to see how much scheduling helps.')],
];

export function ruleBased(c, question) {
  if (!c.summary) return 'Run a simulation first, then I can explain the results.';
  if (!question) return overview(c);
  const hit = TOPICS.find(([re]) => re.test(question));
  if (hit) return hit[1](c);
  return `${overview(c)}\n\n_(Built-in mode answers questions about: whether it is good, SLA, carbon, the baseline, the model, servers, cost and improvements. Add an ANTHROPIC_API_KEY to the backend for free-form questions.)_`;
}

export async function explain({ result, question, history = [] }) {
  const c = compact(result);
  if (!c.summary) return { answer: 'Run a simulation first, then I can explain the results.', source: 'rules' };
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { answer: ruleBased(c, question), source: 'rules' };
  const prior = history
    .slice(-8)
    .filter((m) => ['user', 'assistant'].includes(m?.role) && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
  const ask = question ? `Question: ${String(question).slice(0, 1000)}` : 'Explain this result: what the outputs mean and whether it is good.';
  const messages = [...prior, { role: 'user', content: `Simulation result:\n${JSON.stringify(c)}\n\n${ask}` }];
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 700, system: SYSTEM, messages }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`Claude API ${res.status}`);
    const data = await res.json();
    const answer = data.content?.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    if (!answer) throw new Error('empty reply');
    return { answer, source: 'claude' };
  } catch (e) {
    return { answer: ruleBased(c, question), source: 'rules', note: `AI unavailable (${e.message}); showing the built-in explanation.` };
  }
}
