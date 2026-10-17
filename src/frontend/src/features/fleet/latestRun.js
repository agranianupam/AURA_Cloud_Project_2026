
const KEY = 'aura.latestRun';

export function saveLatestRun(run) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ result: run.result, inputs: run.inputs, savedAt: Date.now() }));
  } catch {

  }
}

export function loadLatestRun() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    return raw?.result?.hourly?.length ? raw : null;
  } catch {
    return null;
  }
}

