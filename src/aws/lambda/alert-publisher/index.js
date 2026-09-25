const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');

const client = new SNSClient({});

exports.handler = async (event) => {
  const { message, subject, topicArn } = event;
  const TopicArn = topicArn || process.env.SNS_TOPIC_ARN;

  if (!TopicArn) {
    throw new Error('No SNS topic ARN provided (event.topicArn or SNS_TOPIC_ARN env var)');
  }

  const res = await client.send(
    new PublishCommand({
      TopicArn,
      Message: message,
      Subject: subject || 'AURA Alert',
    })
  );

  return { statusCode: 200, messageId: res.MessageId };
};
