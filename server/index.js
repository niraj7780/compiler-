'use strict';

const path = require('node:path');
const os = require('node:os');

const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const { getLanguage, publicList } = require('./languages');
const sandbox = require('./sandbox');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const startedAt = Date.now();

const app = express();
app.disable('x-powered-by');

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        // Monaco loads AMD modules and workers from same origin / blobs.
        'script-src': ["'self'", "'unsafe-eval'"],
        'worker-src': ["'self'", 'blob:'],
        'style-src': ["'self'", "'unsafe-inline'"],
        'font-src': ["'self'", 'data:'],
        'img-src': ["'self'", 'data:', 'blob:'],
        'connect-src': ["'self'"],
        'object-src': ["'none'"],
        'frame-ancestors': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-origin' },
  })
);

app.use((req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex');
  next();
});

const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 240,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' },
});
app.use(globalLimiter);

const runLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Run limit reached (20 executions/minute). Try again shortly.' },
});

app.use(
  express.json({
    limit: '256kb',
    verify: (req, res, buf) => {
      if (buf.length === 0) return;
    },
  })
);

// Monaco editor assets served straight from node_modules.
app.use(
  '/monaco',
  express.static(path.join(__dirname, '..', 'node_modules', 'monaco-editor', 'min', 'vs'), {
    fallthrough: true,
    maxAge: '1h',
    setHeaders: (res, filePath) => {
      if (/\-[A-Za-z0-9_]{8}\.(js|css|ttf|woff2?)$/.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  })
);

app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html' }));

app.get('/api/health', async (req, res) => {
  const engine = await sandbox.currentEngine();
  res.json({
    ok: true,
    engine,
    docker: engine === 'docker',
    uptime: Math.round((Date.now() - startedAt) / 1000),
    node: process.version,
    platform: `${os.type()} ${os.arch()}`,
  });
});

app.get('/api/languages', (req, res) => {
  res.json({ languages: publicList() });
});

app.post('/api/run', runLimiter, async (req, res, next) => {
  try {
    const { language, code, stdin } = req.body || {};
    const lang = getLanguage(language);
    sandbox.validate({ language, code, stdin, lang });

    const result = await sandbox.execute({
      lang,
      code,
      stdin: typeof stdin === 'string' ? stdin : '',
    });

    let status = 'ok';
    if (result.timedOut) status = 'timeout';
    else if (result.compileError) status = 'compile-error';
    else if (result.exitCode !== 0) status = 'error';

    res.json({
      status,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      signal: result.signal || null,
      timedOut: result.timedOut,
      truncated: result.truncated,
      engine: result.engine,
      degraded: Boolean(result.degraded),
      durationMs: result.durationMs,
    });
  } catch (err) {
    next(err);
  }
});

// SPA entry.
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
  if (status >= 500) {
    console.error('[server]', err);
  }
  res.status(status).json({
    error: status >= 500 ? 'Internal server error' : err.message || 'Bad request',
  });
});

function start(port = PORT, host = HOST) {
  return new Promise((resolve) => {
    const server = app.listen(port, host, () => resolve(server));
  });
}

if (require.main === module) {
  start().then(async (server) => {
    const addr = server.address();
    const engine = await sandbox.currentEngine();
    console.log(`DevCode compiler listening on http://localhost:${addr.port}`);
    console.log(`Execution engine: ${engine}${engine === 'local' ? ' (docker unavailable)' : ''}`);
  });
}

module.exports = { app, start };
