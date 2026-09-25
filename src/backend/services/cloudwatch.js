const { CloudWatchClient, PutMetricDataCommand } = require('@aws-sdk/client-cloudwatch');
const config = require('../config');

const client = new CloudWatchClient({ region: config.awsRegion });
const NAMESPACE = 'AURA';

async function putMetric(metricName, value, unit = 'None', dimensions = []) {
  try {
    await client.send(
      new PutMetricDataCommand({
        Namespace: NAMESPACE,
        MetricData: [
          {
            MetricName: metricName,
            Value: value,
            Unit: unit,
            Timestamp: new Date(),
            Dimensions: dimensions,
          },
        ],
      })
    );
  } catch (err) {
    // Metrics are best-effort — never fail the request because CloudWatch is unreachable.
    console.warn('[cloudwatch] putMetric failed:', err.message);
  }
}

module.exports = { putMetric };
