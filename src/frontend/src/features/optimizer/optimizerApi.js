import axios from 'axios';
import { fetchAuthSession } from 'aws-amplify/auth';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';
const AUTH_DISABLED = import.meta.env.VITE_AUTH_DISABLED === 'true';

export const GOALS = [
  { value: 'energy', label: 'Use the least energy', unit: 'kWh', saved: 'energySavedKwh' },
  { value: 'carbon', label: 'Emit the least carbon', unit: 'kg CO₂', saved: 'co2SavedKg' },
  { value: 'cost', label: 'Spend the least money', unit: '$', saved: 'costSaved' },
];

// Slider/input defaults, derived from the simulator's current server count.
export const defaultRanges = (servers) => {
  const n = Number(servers) || 50;
  return {
    servers: [Math.max(1, Math.round(n * 0.2)), Math.min(1000, Math.round(n * 1.5))],
    headroom: [0.05, 0.5],
    deferrableShare: [0.1, 0.6],
  };
};

async function headers() {
  if (AUTH_DISABLED) return {};
  try {
    const t = (await fetchAuthSession()).tokens?.idToken?.toString();
    return t ? { Authorization: `Bearer ${t}` } : {};
  } catch {
    return {};
  }
}

export async function runOptimizer(body) {
  const res = await axios.post(`${API_BASE}/api/optimize`, body, { headers: await headers() });
  return res.data;
}
