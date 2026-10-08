'use strict';

const docker = require('./docker');
const local = require('./local');

const MAX_CODE_BYTES = 128 * 1024;
const MAX_STDIN_BYTES = 64 * 1024;
const MAX_OUTPUT = 64 * 1024;
const TIMEOUT_MS = Number(process.env.EXEC_TIMEOUT_MS) || 20000;

// Serverless hosts (Vercel) have no Docker daemon - skip the probe entirely.
let preferredEngine = (process.env.EXECUTOR || (process.env.VERCEL ? 'local' : 'auto')).toLowerCase();
let dockerCheckedAt = 0;
let dockerAvailable = false;

async function probeDocker(force = false) {
  const now = Date.now();
  if (!force && now - dockerCheckedAt < 60000 && dockerCheckedAt !== 0) {
    return dockerAvailable;
  }
  dockerAvailable = await docker.isAvailable();
  dockerCheckedAt = now;
  return dockerAvailable;
}

async function currentEngine() {
  if (preferredEngine === 'docker') return 'docker';
  if (preferredEngine === 'local') return 'local';
  return (await probeDocker()) ? 'docker' : 'local';
}

/**
 * Validate a run request. Throws an Error with `status` when rejected.
 */
function validate({ language, code, stdin, lang }) {
  if (!lang) {
    const err = new Error(`Unsupported language: ${language}`);
    err.status = 400;
    throw err;
  }
  if (typeof code !== 'string' || code.length === 0) {
    const err = new Error('Code must be a non-empty string.');
    err.status = 400;
    throw err;
  }
  if (Buffer.byteLength(code, 'utf8') > MAX_CODE_BYTES) {
    const err = new Error('Code exceeds the 128 KB limit.');
    err.status = 413;
    throw err;
  }
  if (stdin != null && typeof stdin !== 'string') {
    const err = new Error('Input must be a string.');
    err.status = 400;
    throw err;
  }
  if (stdin && Buffer.byteLength(stdin, 'utf8') > MAX_STDIN_BYTES) {
    const err = new Error('Input exceeds the 64 KB limit.');
    err.status = 413;
    throw err;
  }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(code)) {
    const err = new Error('Code contains invalid control characters.');
    err.status = 400;
    throw err;
  }
}

/**
 * Execute user code in the safest available engine, falling back from Docker
 * to the local engine if the daemon disappears mid-flight.
 */
async function execute({ lang, code, stdin = '' }) {
  const opts = { lang, code, stdin, timeoutMs: TIMEOUT_MS, maxOutput: MAX_OUTPUT };
  const engine = await currentEngine();

  if (engine === 'docker') {
    const result = await docker.execute(opts);
    if (result.daemonDown) {
      dockerAvailable = false;
      dockerCheckedAt = Date.now();
      const fallback = await local.execute(opts);
      return { ...fallback, engine: 'local', degraded: true };
    }
    return { ...result, engine: 'docker' };
  }

  const result = await local.execute(opts);
  return { ...result, engine: 'local' };
}

module.exports = {
  execute,
  validate,
  currentEngine,
  probeDocker,
  MAX_CODE_BYTES,
  MAX_STDIN_BYTES,
  MAX_OUTPUT,
  TIMEOUT_MS,
};
