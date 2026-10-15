import cors from 'cors';
import express from 'express';
import multer from 'multer';
import { EngineError } from './engine.js';
import { explain } from './explain.js';
import { optimize } from './optimize.js';

// Positive integer query parameter, clamped to [1, max]; falls back to `def` when absent or invalid.
function intParam(value, def, max) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : def;
}

const UPLOAD_LIMIT = 5 * 1024 * 1024;
const STATUS = { validation: 400, csv: 422, too_large: 413, timeout: 504, unavailable: 503, internal: 500 };
const CODE = { validation: 'VALIDATION_ERROR', csv: 'CSV_INVALID', too_large: 'TOO_LARGE', timeout: 'INTERNAL', unavailable: 'INTERNAL', internal: 'INTERNAL' };
const SIM_FIELDS = ['startDate', 'endDate', 'servers', 'idleWatts', 'peakWatts', 'deferrableShare', 'carbonGrid', 'events',
  'headroom', 'pue', 'pricePerKwh', 'carbonShift', 'dataset'];

function apiError(res, status, code, message, field) {
  return res.status(status).json({ error: { code, message, ...(field ? { field } : {}) } });
}

// Multipart text fields arrive as strings; coerce the numeric ones and the events list like the JSON API expects.
function coerceForm(body) {
  const out = {};
  for (const k of SIM_FIELDS) {
    if (body[k] === undefined || body[k] === '') continue;
    const v = body[k];
    if (['servers', 'idleWatts', 'peakWatts', 'deferrableShare', 'headroom', 'pue', 'pricePerKwh'].includes(k)) out[k] = Number(v);
    else if (k === 'events') {
      try { out[k] = Array.isArray(v) ? v : (String(v).trim().startsWith('[') ? JSON.parse(v) : String(v).split(',').map((s) => s.trim()).filter(Boolean)); }
      catch { out[k] = v; }
    } else if (k === 'carbonShift') out[k] = v === 'true' ? true : v === 'false' ? false : v;
    else out[k] = v;
  }
  return out;
}

export function createApp({ store, engine, auth = (req, res, next) => next(), corsOrigin = '*' }) {
  const app = express();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: UPLOAD_LIMIT, files: 1 } });
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

  // ---- interactive endpoints: run the trained LSTM and the allocation logic on the user's inputs
  const run = (handler) => async (req, res, next) => {
    if (!engine) return apiError(res, 503, 'INTERNAL', 'the forecast engine is not configured');
    try { res.json(await handler(req)); } catch (err) {
      if (err instanceof EngineError) return apiError(res, STATUS[err.type] ?? 500, CODE[err.type] ?? 'INTERNAL', err.message, err.field);
      next(err);
    }
  };

  api.post('/simulate', express.json({ limit: '100kb' }), run((req) => {
    if (req.body === null || typeof req.body !== 'object' || Array.isArray(req.body)) {
      throw new EngineError('validation', 'request body must be a JSON object');
    }
    return engine.simulate(req.body);
  }));

  api.get('/forecast/preview', run((req) => {
    if (!req.query.date) throw new EngineError('validation', 'date is required (YYYY-MM-DD)', 'date');
    return engine.preview(String(req.query.date), req.query.dataset ? String(req.query.dataset) : undefined);
  }));

  api.post('/upload', (req, res, next) => upload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return apiError(res, 413, 'TOO_LARGE', 'the file is larger than 5 MB', 'file');
    return apiError(res, 400, 'VALIDATION_ERROR', `invalid upload: ${err.message}`, 'file');
  }), run((req) => {
    if (!req.file) throw new EngineError('validation', "attach a CSV in the multipart field 'file'", 'file');
    return engine.upload(req.file.buffer.toString('utf8'), req.file.originalname, coerceForm(req.body ?? {}));
  }));

  // Auto-Optimizer: sweep servers / headroom / deferrable share for a goal (up to ~150 engine runs)
  api.post('/optimize', express.json({ limit: '100kb' }), run((req) => optimize(engine, req.body)));

  // AURA Explainer: plain-language explanation of a simulation result (Claude if ANTHROPIC_API_KEY is set, else rules)
  api.post('/explain', express.json({ limit: '500kb' }), async (req, res, next) => {
    try {
      const { result, question, history } = req.body ?? {};
      if (!result || typeof result !== 'object') return apiError(res, 400, 'VALIDATION_ERROR', 'result (a simulation result) is required', 'result');
      res.json(await explain({ result, question: typeof question === 'string' ? question : undefined, history: Array.isArray(history) ? history : [] }));
    } catch (err) { next(err); }
  });

  app.use('/api', api);
  app.use((req, res) => apiError(res, 404, 'NOT_FOUND', 'not found'));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return apiError(res, 400, 'VALIDATION_ERROR', 'request body is not valid JSON');
    if (err.type === 'entity.too.large') return apiError(res, 413, 'TOO_LARGE', 'request body too large');
    if (err.code === 'ENOENT') {
      return apiError(res, 503, 'INTERNAL', 'data not generated yet; run src/ml_model/simulate.py');
    }
    console.error(err);
    apiError(res, 500, 'INTERNAL', 'internal error');
  });
  return app;
}
