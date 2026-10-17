

const SCHEDULER_TIMEOUT_MS = 3000;

async function getSchedulingDecision({ resourceId, action, targetCapacity }) {
  const schedulerUrl = process.env.SCHEDULER_SERVICE_URL;
  if (!schedulerUrl) {
    return { decision: 'proceed', reason: 'SCHEDULER_SERVICE_URL not configured' };
  }

  try {
    const params = new URLSearchParams({ resourceId, action, targetCapacity: String(targetCapacity) });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SCHEDULER_TIMEOUT_MS);
    const res = await fetch(`${schedulerUrl}/schedule?${params}`, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      return { decision: 'proceed', reason: `scheduler returned ${res.status}` };
    }
    return await res.json();
  } catch (err) {
    return { decision: 'proceed', reason: `scheduler unreachable: ${err.message}` };
  }
}

exports.handler = async (event) => {
  const { resourceId, action, targetCapacity } = event;

  const scheduling = await getSchedulingDecision({ resourceId, action, targetCapacity });

  console.log(
    `[scaling-handler] ${resourceId}: ${action} -> ${targetCapacity}% ` +
      `| scheduler decision: ${scheduling.decision} (${scheduling.reason || 'no reason given'}) ` +
      `at ${new Date().toISOString()}`
  );

  if (scheduling.decision === 'defer') {
    return {
      statusCode: 202,
      body: JSON.stringify({
        resourceId,
        action,
        targetCapacity,
        simulated: true,
        deferred: true,
        deferredUntil: scheduling.deferredUntil || null,
        reason: scheduling.reason || null,
        timestamp: new Date().toISOString(),
      }),
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      resourceId,
      action,
      targetCapacity,
      simulated: true,
      deferred: false,
      timestamp: new Date().toISOString(),
    }),
  };
};

