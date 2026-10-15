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
    anomalies: result.anomalies && {
      incident: result.anomalies.incident,
      incidents: result.anomalies.incidents?.slice(0, 8),
      summary: result.anomalies.summary,
      threshold: result.anomalies.threshold,
      params: result.anomalies.params,
    },
  };
}

// Anomaly detection answers (built-in mode). `c.anomalies` is sent by the Anomalies panel.
const ANOMALY_Q = /anomal|incident|fault|spike|dropout|drop out|unusual|outlier|deviat|abnormal|flagged/i;
function anomalyAnswer(c) {
  const a = c.anomalies;
  const when = (ts) => `${ts?.slice(0, 10)} at ${ts?.slice(11, 16)}`;
  const inc = a.incident;
  if (!inc) {
    const s = a.summary ?? {};
    if (!s.incidents) return `No unusual hours were found: measured load stayed within the expected band around the forecast (typical error ${n(s.maeKw ?? 0, 1)} kW). _Simulated forecast comparison, not a diagnosis._`;
    const list = (a.incidents ?? []).slice(0, 3).map((i) => `${i.direction} of ${n(Math.abs(i.peakDeviationKw))} kW on ${when(i.peakTs)} (${i.severity})`).join('; ');
    return `**${s.incidents} incident(s)** were found, ${s.flaggedHours} hour(s) in total: ${list}. An anomaly is an hour where the real load differs from the forecast by much more than the model's normal error (band about ±${n((a.threshold?.sigmaKw ?? 0) * (a.threshold?.k ?? 3))} kW).`;
  }
  const up = inc.direction === 'spike';
  const out = [];
  out.push(`**What happened.** On ${when(inc.peakTs)} the real load was ${n(inc.actualKw)} kW against a forecast of ${n(inc.forecastKw)} kW: ${up ? 'higher' : 'lower'} by ${n(Math.abs(inc.peakDeviationKw))} kW (${n(Math.abs(inc.peakDeviationPct ?? 0))}%). The incident lasted ${inc.hours} hour(s), ${inc.start.slice(11, 16)} to ${inc.end.slice(11, 16)}, rated **${inc.severity}**.`);
  if (inc.synthetic) out.push('**Note.** This fault was injected for testing: the measured series was altered on purpose, so there is no real cause. It shows the detector catching a problem on demand.');
  else out.push(up
    ? '**Possible causes.** An unplanned event or extra equipment, a cooling or HVAC fault making the building draw more, or a day the forecast did not know was busier (exam, open day).'
    : '**Possible causes.** A partial outage or closure, a meter or sensor dropout, or a quiet day (holiday, cancelled classes) that the forecast did not expect.');
  out.push(`**Why it was flagged.** The deviation is outside the expected band (about ±${n((a.threshold?.sigmaKw ?? 0) * (a.threshold?.k ?? 3))} kW, based on the model's typical error of ${n(a.summary?.maeKw ?? 0, 1)} kW).`);
  out.push(up ? '**What to do.** Check cooling and lighting schedules for that period and whether an event was booked; AURA should add headroom if this repeats.' : '**What to do.** Check the meter or data feed first; if the readings are right, find out which area went offline.');
  return out.join('\n\n');
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


// Page-help topics: what each input, chart and feature on the Simulator page means.
const HELP = [
  [/deferrable|batch|flexible/i, () => 'Deferrable share is the part of the workload that can wait (batch jobs, research runs, backups). AURA moves it to hours when the grid is cleaner, which lowers carbon without hurting interactive users. A higher share means more carbon savings.'],
  [/idle watt|idle power|peak watt|peak power|watts/i, (c) => `Idle watts (${c.params?.idleWatts}) is what one server draws when on but doing nothing; peak watts (${c.params?.peakWatts}) is its draw at full load. Turning servers off saves the idle part, which is why savings are large when many servers sit idle.`],
  [/headroom|safety|margin/i, (c) => `Headroom (${n((c.params?.headroom ?? 0.25) * 100)}%) is the extra capacity AURA keeps above the forecast so a forecast error does not cause a service miss. More headroom means fewer misses but less energy saved.`],
  [/pue|overhead|cooling/i, (c) => `PUE (${c.params?.pue ?? 1.5}) is the data center's overhead multiplier for cooling and power delivery. A PUE of 1.5 means every 1 kWh of server power costs 1.5 kWh at the meter.`],
  [/event|exam|holiday|break|surge/i, () => 'Events change demand: exam raises weekday daytime load, break and holiday lower it (all planned, so the forecast accounts for them). "Unplanned surge" is a spike the forecast does NOT see, so it can cause SLA misses, which is a useful stress test.'],
  [/peak|busiest|highest|max/i, (c) => (c.peakHour ? `The busiest hour was ${c.peakHour.ts?.slice(0, 16).replace('T', ' ')} with demand of ${n(c.peakHour.demandKw)} kW, needing ${c.peakHour.serversOn} servers.` : 'No hourly data to find a peak.')],
  [/clean|dirt|best hour|when.*(run|shift)/i, (c) => (c.cleanestHour ? `The cleanest hour was around ${c.cleanestHour.ts?.slice(11, 16)} (${n(c.cleanestHour.carbonIntensity)} gCO₂/kWh). That is when AURA prefers to run deferrable jobs. ${c.recommendations?.[0] ?? ''}` : 'No carbon data for this run.')],
  [/day|daily|which date|best day|worst day|weekend|weekday/i, (c) => {
    const d = c.daily ?? [];
    if (!d.length) return 'No daily breakdown for this run.';
    const pct = (x) => (x.baselineKwh ? ((1 - x.energyKwh / x.baselineKwh) * 100) : 0);
    const best = d.reduce((a, b) => (pct(b) > pct(a) ? b : a));
    const worst = d.reduce((a, b) => (pct(b) < pct(a) ? b : a));
    return `Across ${d.length} day(s): the best saving was on ${best.date} (${n(pct(best), 1)}% less energy than always-on) and the smallest on ${worst.date} (${n(pct(worst), 1)}%). Quiet days such as weekends save more because more servers can be switched off.`;
  }],
  [/alert|scaling|scaled|notification|sns/i, (c) => (c.alerts?.length ? `AURA raised ${c.alerts.length} recent alert(s), for example: "${c.alerts[0].message}". Alerts record scaling decisions and risks; in the full AWS design they go to facility managers via SNS.` : 'No alerts were raised for this run.')],
  [/warning|caveat|reliab|trust|limitation|accurate.*upload|upload/i, (c) => (c.warnings?.length ? `Caveats for this run: ${c.warnings.join(' ')} The model was trained on one Thai university building, so other data is indicative only.` : 'There were no warnings for this run. Still, the model was trained on one Thai university building and results are simulated estimates.')],
  [/scenario|compare|save.*run/i, () => 'Scenario compare lets you save up to 3 runs and view them side by side, for example 48 servers vs 32 servers, so you can see how a change affects energy, carbon and SLA.'],
  [/preview|actual|real data|cu-?bems|dataset|trained/i, () => 'The model was trained on CU-BEMS, a public dataset of electricity use in a Chulalongkorn University building (2018-2019). The Forecast preview compares the model\'s prediction with the real measured load for a date you pick, so you can judge its accuracy yourself.'],
  [/what is aura|what does aura|purpose|why aura|about/i, () => 'AURA (Autonomous University Resource Allocator) forecasts a university data center\'s demand and switches servers on and off ahead of it, and shifts flexible jobs to low-carbon hours. The goal is lower energy, cost and carbon without hurting service.'],
  [/aws|cloud|lambda|sagemaker|dynamo|s3|cognito/i, () => 'AURA is designed for AWS: SageMaker trains and serves the forecaster, Lambda runs the scaling logic, S3 stores data and models, DynamoDB stores usage records, CloudWatch monitors, SNS sends alerts, and Cognito handles logins. See the Architecture page for the diagram. This simulator runs the same logic locally.'],
  [/hour|hourly|chart|graph|line|axis/i, () => 'The charts show each hour of the simulated period. Energy and CO₂ charts compare AURA with the always-on baseline (the gap is the saving); the servers-on chart shows how many servers AURA kept running each hour, rising with demand and falling overnight.'],
];

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
  if (c.anomalies && (!c.summary || ANOMALY_Q.test(question ?? ''))) return anomalyAnswer(c);
  if (!c.summary) return 'Run a simulation first, then I can explain the results.';
  if (!question) return overview(c);
  if (ANOMALY_Q.test(question)) return 'An anomaly is an hour where the real load differs from the forecast by much more than the model\'s normal error, for example a cooling fault or an unplanned event. Use the Anomalies panel to scan a week of data (or inject a test fault) and ask me about any incident it lists.';
  const hit = [...TOPICS, ...HELP].find(([re]) => re.test(question));
  if (hit) return hit[1](c);
  return "I can't answer that one in built-in mode. I only understand questions about this page: whether the result is good, SLA, carbon, the baseline, the model, servers, cost, peak and cleanest hours, best and worst days, alerts, warnings, and what each input means (deferrable share, idle/peak watts, headroom, PUE, events). For open-ended questions, add an ANTHROPIC_API_KEY to the backend and I will answer anything about your results.";
}

export async function askClaude(key, messages, { system = SYSTEM, maxTokens = 700 } = {}) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}`);
  const data = await res.json();
  return data.content?.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

// Google Gemini (has a free tier). Key from https://aistudio.google.com/apikey
export async function askGemini(key, messages, { system = SYSTEM } = {}) {
  const model = process.env.AURA_GEMINI_MODEL || 'gemini-2.5-flash';
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: { maxOutputTokens: 2048, temperature: 0.3, thinkingConfig: { thinkingBudget: 0 } },
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => null))?.error?.message;
    throw new Error(`Gemini API ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join('\n');
}

export async function explain({ result, question, history = [] }) {
  const c = compact(result);
  if (!c.summary && !c.anomalies) return { answer: 'Run a simulation first, then I can explain the results.', source: 'rules' };
  const claudeKey = process.env.ANTHROPIC_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!claudeKey && !geminiKey) return { answer: ruleBased(c, question), source: 'rules' };
  const prior = history
    .slice(-8)
    .filter((m) => ['user', 'assistant'].includes(m?.role) && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
  const ask = question ? `Question: ${String(question).slice(0, 1000)}` : 'Explain this result: what the outputs mean and whether it is good.';
  const messages = [...prior, { role: 'user', content: `Simulation result:
${JSON.stringify(c)}

${ask}` }];
  const source = claudeKey ? 'claude' : 'gemini';
  try {
    const answer = claudeKey ? await askClaude(claudeKey, messages) : await askGemini(geminiKey, messages);
    if (!answer) throw new Error('empty reply');
    return { answer, source };
  } catch (e) {
    return { answer: ruleBased(c, question), source: 'rules', note: `AI unavailable (${e.message}); showing the built-in answer.` };
  }
}
