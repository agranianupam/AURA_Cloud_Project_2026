const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const config = require('../config');

const client = new SNSClient({ region: config.awsRegion });

async function publishAlert({ message, subject }) {
  if (!config.snsTopicArn) {
    console.warn('[sns] SNS_TOPIC_ARN not set — skipping publish:', message);
    return { skipped: true };
  }
  const res = await client.send(
    new PublishCommand({
      TopicArn: config.snsTopicArn,
      Message: message,
      Subject: subject || 'AURA Alert',
    })
  );
  return { skipped: false, messageId: res.MessageId };
}

module.exports = { publishAlert };
