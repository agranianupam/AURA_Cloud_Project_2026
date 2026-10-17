
import { equivalentsFor, uncertaintyHint, SOURCES, fmtNum } from './equivalents.js';
import { inputsOf } from './exportCsv.js';

export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function lineChartSvg({ title, unit, series, labels, width = 720, height = 220 }) {
  const m = { l: 52, r: 12, t: 12, b: 28 };
  const n = Math.max(...series.map((s) => s.values.length), 1);
  const max = Math.max(1e-9, ...series.flatMap((s) => s.values)) * 1.08;
  const x = (i) => m.l + (n <= 1 ? 0 : (i / (n - 1)) * (width - m.l - m.r));
  const y = (v) => m.t + (1 - v / max) * (height - m.t - m.b);
  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((f) => {
      const v = max * f;
      return `<line x1="${m.l}" x2="${width - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="#e5e7eb"/><text x="${m.l - 6}" y="${y(v) + 3}" text-anchor="end" font-size="9" fill="#6b7280">${esc(fmtNum(v))}</text>`;
    })
    .join('');
  const ticks = Array.from({ length: Math.min(6, n) }, (_, k) => Math.round((k * (n - 1)) / Math.max(1, Math.min(6, n) - 1)))
    .map((i) => `<text x="${x(i)}" y="${height - 10}" text-anchor="middle" font-size="9" fill="#6b7280">${esc(labels[i] ?? '')}</text>`)
    .join('');
  const lines = series
    .map((s) => `<polyline fill="none" stroke="${s.color}" stroke-width="1.6" points="${s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}"/>`)
    .join('');
  const legend = series
    .map((s) => `<span class="lg"><i style="background:${s.color}"></i>${esc(s.name)}</span>`)
    .join('');
  return `<figure class="chart"><figcaption>${esc(title)} <small>(${esc(unit)})</small></figcaption>
<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="${esc(title)}">${grid}${ticks}${lines}</svg>
<div class="legend">${legend}</div></figure>`;
}

const dayLabel = (ts) => {
  const d = new Date(ts);
  return `${d.getUTCDate()}/${d.getUTCMonth() + 1} ${String(d.getUTCHours()).padStart(2, '0')}h`;
};

export function summaryText(result, inputs) {
  const s = result.summary;
  const p = { ...(result.params || {}), ...(inputs || {}) };
  const days = s.period?.days ?? Math.round((result.hourly?.length || 0) / 24);
  const parts = [
    `Over ${days} day${days === 1 ? '' : 's'} with ${p.servers ?? 'the configured'} servers, AURA's forecast-driven scheduling is estimated to use ${fmtNum(s.energySavedKwh)} kWh less energy than keeping every server on${s.percentReduction != null ? ` (${s.percentReduction}% lower)` : ''}, avoiding about ${fmtNum(s.co2SavedKg)} kg of CO₂${s.co2PercentReduction != null ? ` (${s.co2PercentReduction}% lower)` : ''} and roughly $${fmtNum(s.costSaved)} in electricity cost.`,
    `Service level was met in ${s.slaPct}% of hours${s.slaMissHours ? ` (${s.slaMissHours} hour${s.slaMissHours === 1 ? '' : 's'} with too little capacity)` : ''}.`,
  ];
  if (s.avgServersOn != null) parts.push(`On average ${s.avgServersOn} servers were switched on, peaking at ${s.peakServersOn}.`);
  return parts.join(' ');
}

const CSS = `
@page { size: A4; margin: 14mm; }
* { box-sizing: border-box; }
body { font: 11pt/1.45 system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #111827; margin: 0; background: #f3f4f6; }
.page { max-width: 182mm; margin: 0 auto; background: #fff; padding: 12mm; }
h1 { font-size: 20pt; margin: 0 0 2mm; } h2 { font-size: 13pt; margin: 6mm 0 2mm; border-bottom: 1px solid #d1d5db; padding-bottom: 1mm; }
.meta { color: #4b5563; font-size: 10pt; }
table { border-collapse: collapse; width: 100%; font-size: 10pt; } th, td { text-align: left; padding: 1.5mm 2mm; border-bottom: 1px solid #e5e7eb; }
th { color: #4b5563; font-weight: 600; width: 45%; }
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3mm; margin: 3mm 0; }
.kpi { border: 1px solid #d1d5db; border-radius: 2mm; padding: 2.5mm; } .kpi b { display: block; font-size: 14pt; } .kpi span { font-size: 9pt; color: #4b5563; }
.chart { margin: 3mm 0; break-inside: avoid; } figcaption { font-weight: 600; font-size: 10pt; } .legend { font-size: 9pt; color: #374151; }
.lg { margin-right: 4mm; } .lg i { display: inline-block; width: 8px; height: 8px; margin-right: 1.5mm; }
.note { background: #fffbeb; border: 1px solid #fcd34d; border-radius: 2mm; padding: 2.5mm; font-size: 9.5pt; break-inside: avoid; }
ul { margin: 1mm 0; padding-left: 5mm; } li { margin: 0.5mm 0; } small, .small { font-size: 9pt; color: #4b5563; }
section { break-inside: avoid; }
.bar { position: sticky; top: 0; background: #111827; color: #fff; padding: 3mm; text-align: center; font-size: 10pt; }
.bar button { margin-left: 3mm; padding: 1.5mm 4mm; font-size: 10pt; cursor: pointer; }
@media print { body { background: #fff; } .page { padding: 0; max-width: none; } .bar { display: none; } * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
`;

export function buildReportHtml(result, inputs, now = new Date()) {
  const s = result.summary;
  const hourly = result.hourly || [];
  const labels = hourly.map((h) => dayLabel(h.ts));
  const model = result.model;
  const eq = equivalentsFor(s);
  const hint = uncertaintyHint(result);
  const accuracy = model
    ? `Forecast model: ${esc(model.name || 'AURA LSTM')}. On held-out test data its average error was ${model.testMaeKw} kW (MAPE ${model.testMapePct}%)${model.seasonalNaiveMaeKw ? `, versus ${model.seasonalNaiveMaeKw} kW for a same-hour-last-week baseline` : ''}.`
    : 'Forecast accuracy figures were not provided with this run.';
  const kpis = [
    ['Energy saved', `${fmtNum(s.energySavedKwh)} kWh`],
    ['CO₂ avoided', `${fmtNum(s.co2SavedKg)} kg`],
    ['Cost saved', `$${fmtNum(s.costSaved)}`],
    ['Service level met', `${s.slaPct}%`],
  ];
  const detail = [
    ['AURA energy', s.energyKwh != null && `${fmtNum(s.energyKwh)} kWh`],
    ['Always-on baseline energy', s.baselineKwh != null && `${fmtNum(s.baselineKwh)} kWh`],
    ['AURA CO₂', s.co2Kg != null && `${fmtNum(s.co2Kg)} kg`],
    ['Baseline CO₂', s.baselineCo2Kg != null && `${fmtNum(s.baselineCo2Kg)} kg`],
    ['Energy reduction', s.percentReduction != null && `${s.percentReduction}%`],
    ['CO₂ reduction', s.co2PercentReduction != null && `${s.co2PercentReduction}%`],
    ['Hours below required capacity', s.slaMissHours != null && s.slaMissHours],
    ['Average / peak servers on', s.avgServersOn != null && `${s.avgServersOn} / ${s.peakServersOn}`],
    ['Carbon source', s.carbonSource],
  ].filter(([, v]) => v !== false && v !== undefined && v !== null);
  const recs = (result.recommendations || []).slice(0, 8);

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AURA simulation report</title><style>${CSS}</style></head><body>
<div class="bar">Print preview: choose “Save as PDF” as the destination. <button onclick="window.print()">Print / Save as PDF</button></div>
<div class="page">
<h1>AURA simulation report</h1>
<p class="meta">Generated ${esc(now.toLocaleString())} · Period ${esc(s.period?.start ?? '')} to ${esc(s.period?.end ?? '')}</p>
<div class="note"><b>Simulated estimates.</b> These figures come from a model and an allocation simulation, not from metered measurements of a real data centre.</div>

<h2>Scenario inputs</h2>
<table>${inputsOf(result, inputs).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(Array.isArray(v) ? v.join(', ') : v)}</td></tr>`).join('')}</table>

<h2>Results</h2>
<div class="kpis">${kpis.map(([k, v]) => `<div class="kpi"><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join('')}</div>
<table>${detail.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>

${lineChartSvg({ title: 'Energy per hour: AURA vs always-on', unit: 'kWh', labels, series: [
    { name: 'Always-on', color: '#9ca3af', values: hourly.map((h) => h.baselineKwh) },
    { name: 'AURA', color: '#16a34a', values: hourly.map((h) => h.energyKwh) }] })}
${lineChartSvg({ title: 'CO₂ per hour: AURA vs always-on', unit: 'g', labels, series: [
    { name: 'Always-on', color: '#9ca3af', values: hourly.map((h) => h.baselineCo2G) },
    { name: 'AURA', color: '#2563eb', values: hourly.map((h) => h.co2G) }] })}

<h2>Summary in plain language</h2>
<p>${esc(summaryText(result, inputs))}</p>
${recs.length ? `<h2>Recommendations</h2><ul>${recs.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}

<h2>Everyday equivalents (rough)</h2>
<table>${eq.map((e) => `<tr><th>${esc(e.label)}</th><td>${esc(e.value)} <small>(${esc(e.detail)})</small></td></tr>`).join('')}</table>
<p class="small">${SOURCES.map(esc).join(' ')}</p>

<h2>Accuracy and uncertainty</h2>
<p>${accuracy}</p>
<p>${esc(hint.text)}</p>

<h2>Caveats</h2>
<ul>
<li>Building electricity load from the CU-BEMS dataset (one Thai university building, 2018–2019) stands in for server demand.</li>
<li>Server count, idle and peak power, headroom, PUE and the deferrable share are assumptions you supplied or defaults, not measurements.</li>
<li>Carbon intensity comes from the chosen grid profile and may not match your local grid.</li>
<li>Equivalents use rule-of-thumb factors and are for intuition only.</li>
${(result.warnings || []).map((w) => `<li>${esc(w)}</li>`).join('')}
</ul>
<p class="small">Generated by AURA (Autonomous University Resource Allocator). Simulated estimates only.</p>
</div></body></html>`;
}

export function openReport(result, inputs) {
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.open();
  w.document.write(buildReportHtml(result, inputs));
  w.document.close();
  w.focus();
  setTimeout(() => {
    try {
      w.print();
    } catch {
    }
  }, 400);
  return true;
}

