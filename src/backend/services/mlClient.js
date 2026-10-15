const config = require('../config');

// Calls Agrani's FastAPI prediction service. Never throws — callers should
// treat a null return as "no predictions available" and fall back gracefully,
// per docs/api-contract.md.
async function getPredictions(nSteps = 12) {
  const url = `${config.mlServiceUrl}/predict?n_steps=${nSteps}`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) {
      console.warn(`[mlClient] ML service returned ${res.status}`);
      return null;
    }
    const body = await res.json();
    return body.predictions || [];
  } catch (err) {
    console.warn('[mlClient] ML service unreachable:', err.message);
    return null;
  }
}

module.exports = { getPredictions };
