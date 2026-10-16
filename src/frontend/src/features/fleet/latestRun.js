// The Simulator saves its latest result here so the Allocation page can replay it.
const KEY = 'aura.latestRun';

export function saveLatestRun(run) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ result: run.result, inputs: run.inputs, savedAt: Date.now() }));
  } catch {
    // storage full or unavailable: the replay just won't be shared across pages
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
