require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

module.exports = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',

  awsRegion: process.env.AWS_REGION || 'ap-south-1',

  tables: {
    usage: process.env.DYNAMODB_TABLE_USAGE || 'ResourceUsage',
    allocations: process.env.DYNAMODB_TABLE_ALLOCATIONS || 'Allocations',
    alerts: process.env.DYNAMODB_TABLE_ALERTS || 'Alerts',
  },

  cognito: {
    userPoolId: process.env.COGNITO_USER_POOL_ID,
    appClientId: process.env.COGNITO_APP_CLIENT_ID,
    region: process.env.COGNITO_REGION || 'ap-south-1',
  },

  snsTopicArn: process.env.SNS_TOPIC_ARN,

  mlServiceUrl: process.env.ML_SERVICE_URL || 'http://localhost:8000',

  frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',

  // When true, auth middleware and AWS service calls are stubbed so the API
  // is runnable/testable with zero AWS credentials (Sprint 1/2 local dev).
  authDisabled: process.env.AUTH_DISABLED === 'true',
};
