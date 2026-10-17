import axios from 'axios';
import { generateMockData } from '../mock/mockData.js';
import { fetchAuthSession } from 'aws-amplify/auth';

const mocks = generateMockData();
const USE_MOCK = import.meta.env.VITE_USE_MOCK === "true";

const AUTH_DISABLED = import.meta.env.VITE_AUTH_DISABLED === "true";
const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

const simulateNetwork = (data) => new Promise((res) => setTimeout(() => res({ data }), 300));

const handleRequest = async (mockData, endpoint) => {
  try {
    if (USE_MOCK) {
      const response = await simulateNetwork(mockData);
      return { data: response.data, loading: false, error: null };
    } else {
      const token = AUTH_DISABLED ? null : (await fetchAuthSession()).tokens?.idToken?.toString();
      const response = await axios.get(`${API_BASE}${endpoint}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      return { data: response.data, loading: false, error: null };
    }
  } catch (error) {
    return { data: null, loading: false, error: error.message };
  }
};

export const getEnergyMetrics = () => handleRequest(mocks.energyMetrics, '/api/metrics/energy');
export const getSavings = () => handleRequest(mocks.savings, '/api/metrics/savings');
export const getAllocations = () => handleRequest(mocks.allocations, '/api/allocations');
export const getAlerts = () => handleRequest(mocks.alerts, '/api/alerts');
export const getForecast = () => handleRequest(mocks.forecast, '/api/forecast');

