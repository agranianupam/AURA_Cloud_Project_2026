import axios from 'axios';
import { fetchAuthSession } from 'aws-amplify/auth';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';
const AUTH_DISABLED = import.meta.env.VITE_AUTH_DISABLED === 'true';

export const DEFAULTS = {
  startDate: '2019-08-12',
  endDate: '2019-08-18',
  servers: 50,
  idleWatts: 100,
  peakWatts: 250,
  deferrableShare: 0.3,
  carbonGrid: 'medium',
  events: [],
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

// Turn any failure into a message a teacher can read (contract error format: {error:{code,message,field}})
export function toMessage(e) {
  const apiErr = e?.response?.data?.error;
  if (apiErr?.message) return { message: apiErr.message, field: apiErr.field };
  if (e?.response) return { message: `The server returned an error (${e.response.status}). Please try again.` };
  return { message: 'Could not reach the AURA server. Check that the backend is running and try again.' };
}

export async function simulate(params) {
  const res = await axios.post(`${API_BASE}/api/simulate`, params, { headers: await headers() });
  return res.data;
}

export async function forecastPreview(date) {
  const res = await axios.get(`${API_BASE}/api/forecast/preview`, { params: { date }, headers: await headers() });
  return res.data;
}

export async function uploadCsv(file, params) {
  const form = new FormData();
  form.append('file', file);
  for (const k of ['servers', 'idleWatts', 'peakWatts', 'deferrableShare', 'carbonGrid']) form.append(k, params[k]);
  const res = await axios.post(`${API_BASE}/api/upload`, form, { headers: await headers() });
  return res.data;
}
