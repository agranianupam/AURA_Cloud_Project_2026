// Verifies Cognito ID tokens sent by the dashboard as "Authorization: Bearer <token>".
// With no user pool configured, auth is disabled so the API can be run locally against the mock-free dashboard.
import { CognitoJwtVerifier } from 'aws-jwt-verify';

export function cognitoAuth({ userPoolId, clientId } = {}) {
  if (!userPoolId || !clientId) {
    console.warn('COGNITO_USER_POOL_ID / COGNITO_CLIENT_ID not set: API authentication is DISABLED');
    return (req, res, next) => next();
  }
  const verifier = CognitoJwtVerifier.create({ userPoolId, clientId, tokenUse: 'id' });

  return async (req, res, next) => {
    const match = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (!match) return res.status(401).json({ error: 'missing bearer token' });
    try {
      req.user = await verifier.verify(match[1]);
      next();
    } catch {
      res.status(401).json({ error: 'invalid or expired token' });
    }
  };
}
