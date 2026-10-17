import axios from 'axios';
import { headers } from '../simulator/simulatorApi';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

export async function askAdvisor(body) {
  const res = await axios.post(`${API_BASE}/api/advisor`, body, { headers: await headers(), timeout: 20000 });
  return res.data;
}

const dayDiff = (d, now) => Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86400000);

export function fmtLocal(iso, now = new Date()) {
  const d = new Date(iso);
  const t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const diff = dayDiff(d, now);
  return diff === 0 ? t : diff === 1 ? `${t} tomorrow` : `${t} on ${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}`;
}

export function adviceSentence(r, now = new Date()) {
  const kg = r.savingKg;
  const nf = (n) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (!(kg > 0.0005)) return `Run it now. Nothing in this window is cleaner than starting now (${nf(r.now.avgIntensity)} gCO₂/kWh), so waiting would not save carbon.`;
  return `Start at ${fmtLocal(r.best.start, now)} to emit ${nf(r.savingPct)}% less CO₂, saving ${nf(kg)} kg compared with starting now.`;
}

