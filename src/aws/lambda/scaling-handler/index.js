// Simulated EC2 scaling action. Free-tier friendly: no real EC2 calls —
// logs the action to CloudWatch (via the Lambda's own log group, automatic)
// and returns a structured result the backend can record.

exports.handler = async (event) => {
  const { resourceId, action, targetCapacity } = event;

  console.log(
    `[scaling-handler] ${resourceId}: ${action} -> ${targetCapacity}% at ${new Date().toISOString()}`
  );

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
      timestamp: new Date().toISOString(),
    }),
  };
};
