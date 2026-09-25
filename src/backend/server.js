const express = require('express');
const cors = require('cors');
const config = require('./config');
const { requireAuth } = require('./middleware/auth');

const metricsRoutes = require('./routes/metrics');
const allocationsRoutes = require('./routes/allocations');
const alertsRoutes = require('./routes/alerts');

const app = express();

app.use(cors({ origin: config.frontendOrigin }));
app.use(express.json());

// Unauthenticated liveness check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/metrics', requireAuth, metricsRoutes);
app.use('/api/allocations', requireAuth, allocationsRoutes);
app.use('/api/alerts', requireAuth, alertsRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[server] unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`AURA backend listening on port ${config.port} (env: ${config.nodeEnv})`);
    if (config.authDisabled) {
      console.log('AUTH_DISABLED=true — all routes are open, do not deploy like this.');
    }
  });
}

module.exports = app;
