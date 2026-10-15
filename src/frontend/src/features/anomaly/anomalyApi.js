import axios from 'axios';
import { headers } from '../simulator/simulatorApi';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

// body: { startDate, endDate, uploadId?, sensitivity?, inject?: { type: 'spike'|'dropout', hours? } }
export async function detectAnomalies(body) {
  const res = await axios.post(`${API_BASE}/api/anomalies`, body, { headers: await headers() });
  return res.data;
}
