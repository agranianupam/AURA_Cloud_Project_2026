const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const sns = new SNSClient({});
// Publishes new warning/critical alert rows from the AURA table to SNS.
exports.handler = async (event) => {
  let sent = 0;
  for (const r of event.Records || []) {
    if (r.eventName !== 'INSERT') continue;
    const img = r.dynamodb.NewImage || {};
    if (img.type?.S !== 'alert') continue;
    const severity = img.severity?.S;
    if (severity !== 'critical' && severity !== 'warning') continue;
    const kind = img.alertType?.S || 'alert';
    await sns.send(new PublishCommand({
      TopicArn: process.env.TOPIC_ARN,
      Subject: `AURA ${severity}: ${kind}`.slice(0, 100),
      Message: `${img.timestamp?.S || ''}\n${img.message?.S || ''}`,
    }));
    sent++;
  }
  return { sent };
};
