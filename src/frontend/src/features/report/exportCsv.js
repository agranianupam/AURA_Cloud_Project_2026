
const cell = (v) => {
  if (v === null || v === undefined) return '';
  const s = Array.isArray(v) ? v.join(';') : String(v);

  const safe = /^[=+\-@]/.test(s) && isNaN(Number(s)) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const line = (arr) => arr.map(cell).join(',');

export function inputsOf(result, inputs) {
  const p = { ...(result?.params || {}), ...(inputs || {}) };
  return [
    ['startDate', p.startDate ?? result?.summary?.period?.start],
    ['endDate', p.endDate ?? result?.summary?.period?.end],
    ['servers', p.servers],
    ['idleWatts', p.idleWatts],
    ['peakWatts', p.peakWatts],
    ['deferrableShare', p.deferrableShare],
    ['carbonGrid', p.carbonGrid],
    ['events', p.events?.length ? p.events : 'none'],
  ];
}

export function buildCsv(result, inputs, now = new Date()) {
  const rows = [];
  rows.push(line(['AURA simulation export']));
  rows.push(line(['generated', now.toISOString()]));
  rows.push(line(['note', 'Simulated estimates, not measurements']));
  rows.push('');
  rows.push(line(['[inputs]']));
  rows.push(line(['name', 'value']));
  for (const r of inputsOf(result, inputs)) rows.push(line(r));
  rows.push('');
  rows.push(line(['[summary]']));
  rows.push(line(['name', 'value']));
  for (const [k, v] of Object.entries(result.summary || {})) {
    if (v && typeof v === 'object') for (const [k2, v2] of Object.entries(v)) rows.push(line([`${k}.${k2}`, v2]));
    else rows.push(line([k, v]));
  }
  rows.push('');
  rows.push(line(['[hourly]']));
  const cols = ['ts', 'demandKw', 'serversOn', 'energyKwh', 'baselineKwh', 'co2G', 'baselineCo2G', 'carbonIntensity'];
  rows.push(line(cols));
  for (const h of result.hourly || []) rows.push(line(cols.map((c) => h[c])));
  return rows.join('\r\n') + '\r\n';
}

export function downloadText(filename, text, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportCsv(result, inputs) {
  const start = (result?.summary?.period?.start || inputs?.startDate || 'run').toString();
  downloadText(`aura-simulation-${start}.csv`, buildCsv(result, inputs));
}

