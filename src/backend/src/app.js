import cors from 'cors';
import express from 'express';

// Positive integer query parameter, clamped to [1, max]; falls back to `def` when absent or invalid.
function intParam(value, def, max) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : def;
}

export function createApp({ store, auth = (req, res, next) => next(), corsOrigin = '*' }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: corsOrigin }));

  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

  const api = express.Router();
  api.use(auth);

  // Hourly energy/carbon records, most recent `hours` (default one week), oldest first
  api.get('/metrics/energy', async (req, res, next) => {
    try {
      const rows = await store.get('energy');
      res.json(rows.slice(-intParam(req.query.hours, 168, rows.length || 1)));
    } catch (err) { next(err); }
  });

  api.get('/metrics/savings', async (req, res, next) => {
    try {
      const { assumptions, ...savings } = await store.get('savings');
      res.json(req.query.details === 'true' ? { ...savings, assumptions } : savings);
    } catch (err) { next(err); }
  });

  // ?status=Running filters the fleet; default lists everything
  api.get('/allocations', async (req, res, next) => {
    try {
      const items = await store.get('allocations');
      res.json(req.query.status ? items.filter((a) => a.status === req.query.status) : items);
    } catch (err) { next(err); }
  });

  // Newest first; ?severity=critical|warning|info filters, ?limit caps the count (default 20)
  api.get('/alerts', async (req, res, next) => {
    try {
      let items = await store.get('alerts');
      if (req.query.severity) items = items.filter((a) => a.severity === req.query.severity);
      res.json(items.slice(0, intParam(req.query.limit, 20, 500)));
    } catch (err) { next(err); }
  });

  api.get('/forecast', async (req, res, next) => {
    try {
      res.json(await store.get('forecast'));
    } catch (err) { next(err); }
  });

  app.use('/api', api);
  app.use((req, res) => res.status(404).json({ error: 'not found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.code === 'ENOENT') {
      return res.status(503).json({ error: 'data not generated yet; run src/ml_model/simulate.py' });
    }
    console.error(err);
    res.status(500).json({ error: 'internal error' });
  });
  return app;
}
