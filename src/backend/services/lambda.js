const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const config = require('../config');

const client = new LambdaClient({ region: config.awsRegion });

async function invokeScalingHandler(payload) {
  const functionName = process.env.SCALING_LAMBDA_NAME || 'aura-scaling-handler';
  try {
    const res = await client.send(
      new InvokeCommand({
        FunctionName: functionName,
        InvocationType: 'Event', // async — don't block the API response on Lambda cold start
        Payload: Buffer.from(JSON.stringify(payload)),
      })
    );
    return { invoked: true, statusCode: res.StatusCode };
  } catch (err) {
    console.warn('[lambda] invoke failed:', err.message);
    return { invoked: false, error: err.message };
  }
}

module.exports = { invokeScalingHandler };
