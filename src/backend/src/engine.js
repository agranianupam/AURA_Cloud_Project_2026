
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');

export class EngineError extends Error {
  constructor(type, message, field) {
    super(message);
    this.type = type;
    this.field = field;
  }
}

export function findPython() {
  if (process.env.PYTHON) return process.env.PYTHON;
  for (const rel of ['.venv/Scripts/python.exe', '.venv/bin/python']) {
    const p = path.join(repoRoot, rel);
    if (existsSync(p)) return p;
  }
  return process.platform === 'win32' ? 'python' : 'python3';
}

export class PythonEngine {
  constructor({ python = findPython(), script = path.join(repoRoot, 'src/ml_model/engine_server.py'), timeoutMs = 180000 } = {}) {
    Object.assign(this, { python, script, timeoutMs });
    this.proc = null;
    this.ready = null;
    this.pending = new Map();
    this.nextId = 1;
  }

  start() {
    if (this.ready) return this.ready;
    const proc = spawn(this.python, ['-u', this.script], {
      cwd: path.dirname(this.script),
      stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...process.env, PYTHONPATH: path.dirname(this.script) },
    });
    this.proc = proc;
    this.ready = new Promise((resolve, reject) => {
      proc.once('error', (err) => reject(new EngineError('unavailable', `cannot start the forecast engine (${this.python}): ${err.message}`)));
      readline.createInterface({ input: proc.stdout }).on('line', (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.ready) return resolve();
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.ok) p.resolve(msg.result);
        else p.reject(new EngineError(msg.error.type, msg.error.message, msg.error.field));
      });
      proc.once('exit', (code) => {
        const err = new EngineError('unavailable', `forecast engine exited (code ${code})`);
        reject(err);
        for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(err); }
        this.pending.clear();
        if (this.proc === proc) { this.proc = null; this.ready = null; }
      });
    });
    this.ready.catch(() => {});
    return this.ready;
  }

  async call(method, params = {}) {
    await this.start();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new EngineError('timeout', `the forecast engine did not answer within ${this.timeoutMs / 1000}s`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }

  simulate(params) { return this.call('simulate', params); }
  preview(date, dataset) { return this.call('preview', { date, dataset }); }
  upload(csv, name, params) { return this.call('upload', { csv, name, params }); }
  info() { return this.call('info'); }
  warm() { return this.start(); }
  close() { if (this.proc) this.proc.kill(); }
}

