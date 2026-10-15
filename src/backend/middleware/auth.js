const { verifyToken } = require('../services/cognito');
const config = require('../config');

async function requireAuth(req, res, next) {
  if (config.authDisabled) {
    req.user = { sub: 'local-dev', email: 'dev@localhost' };
    return next();
  }

  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const payload = await verifyToken(token);
    req.user = { sub: payload.sub, email: payload.email };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

module.exports = { requireAuth };
