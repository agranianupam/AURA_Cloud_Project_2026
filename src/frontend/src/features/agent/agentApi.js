import axios from 'axios';
import { headers } from '../simulator/simulatorApi';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

export async function parseAgentRequest(text) {
  const res = await axios.post(`${API_BASE}/api/agent/parse`, { text }, { headers: await headers() });
  return res.data;
}

