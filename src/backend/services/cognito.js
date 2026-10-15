const { CognitoJwtVerifier } = require('aws-jwt-verify');
const config = require('../config');

let verifier = null;

function getVerifier() {
  if (!config.cognito.userPoolId || !config.cognito.appClientId) {
    return null;
  }
  if (!verifier) {
    verifier = CognitoJwtVerifier.create({
      userPoolId: config.cognito.userPoolId,
      tokenUse: 'id',
      clientId: config.cognito.appClientId,
    });
  }
  return verifier;
}

// Throws if the token is missing, malformed, expired, or fails signature
// verification against the Cognito User Pool's JWKS.
async function verifyToken(token) {
  const v = getVerifier();
  if (!v) {
    throw new Error('Cognito is not configured (COGNITO_USER_POOL_ID/COGNITO_APP_CLIENT_ID missing)');
  }
  return v.verify(token);
}

module.exports = { verifyToken };
