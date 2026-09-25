import axios from 'axios';
import { generateMockData } from '../mock/mockData.js';
import { fetchAuthSession } from 'aws-amplify/auth';

const mocks = generateMockData();
const USE_MOCK = import.meta.env.VITE_USE_MOCK === "true";
const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

const simulateNetwork = (data) => new Promise((res) => setTimeout(() => res({ data }), 300));

const handleRequest = async (mockData, endpoint) => {
  try {
    if (USE_MOCK) {
      const response = await simulateNetwork(mockData);
      return { data: response.data, loading: false, error: null };
    } else {
      const session = await fetchAuthSession();
      const token = session.tokens?.idToken?.toString();
      const response = await axios.get(\\\\, {
        headers: { Authorization: \Bearer \\ }
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
