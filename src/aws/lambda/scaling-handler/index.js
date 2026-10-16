// Simulated EC2 scaling action, wrapped around the carbon-aware scheduler
// (PRD section 6.2: "a thin wrapper that invokes Agrani's carbon-aware
// scheduler logic"). This Lambda does not implement scheduling policy
// itself - it calls out to the scheduler service for a defer/proceed
// decision, then logs + simulates the resulting action. Free-tier
// friendly: no real EC2 calls, only CloudWatch logging (automatic via
// the Lambda's own log group).

const SCHEDULER_TIMEOUT_MS = 3000;

// Calls the ML/scheduler track's service for a defer/proceed decision.
// Never throws - falls back to "proceed immediately" (this Lambda's
// pre-scheduler behavior) if the scheduler is unset or unreachable, so a
// scaling action is never blocked by scheduler unavailability. See
// docs/api-contract.md "Carbon-aware scheduler integration".
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

  // Placeholder for a real EC2 call, e.g.
  //   ec2.modifyInstanceAttribute(...) / autoscaling.setDesiredCapacity(...)
  // Left simulated to stay within Free Tier and avoid touching real infra
  // from an automated demo pipeline.

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
