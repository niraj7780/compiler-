'use strict';

/**
 * Builds the shared Go build cache (`.cache/gocache`) by compiling the Go
 * standard library once, so user programs link in well under a second instead
 * of cold-compiling `runtime` for 15-30s on every run.
 *
 * Also makes sure the custom sandbox images (`devcode/ts`, `devcode/perl`)
 * exist, so a fresh self-hosted deployment has every language from the start.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const docker = require('./docker');
const { runProcess } = require('./process');

const WARMUP_TIMEOUT_MS = Number(process.env.WARMUP_TIMEOUT_MS) || 10 * 60 * 1000;

const CUSTOM_IMAGES = [
  { ref: 'devcode/ts:1', file: 'Dockerfile.ts' },
  { ref: 'devcode/perl:1', file: 'Dockerfile.perl' },
];

let status = 'idle'; // idle | warming | warm | unavailable | failed
let lastError = null;
let pending = null;

async function cacheHasContent() {
  try {
    const dir = await fsp.readdir(docker.cacheDir('gocache'));
    return dir.length > 0;
  } catch {
    return false;
  }
}

/** Build `devcode/ts` and `devcode/perl` on the daemon when they are missing. */
async function ensureCustomImages() {
  const ctx = path.join(__dirname, '..', '..', 'docker');
  if (!fs.existsSync(ctx)) return;
  for (const { ref, file } of CUSTOM_IMAGES) {
    if (!fs.existsSync(path.join(ctx, file))) continue;
    const probe = await runProcess('docker', ['image', 'inspect', ref], {
      timeoutMs: 5000,
      maxOutput: 512,
    });
    if (probe.code === 0) continue;
    console.log(`[warmup] building missing image ${ref}…`);
    const res = await runProcess('docker', ['build', '-t', ref, '-f', path.join(ctx, file), ctx], {
      timeoutMs: 15 * 60 * 1000,
      maxOutput: 4096,
    });
    if (res.code === 0) {
      console.log(`[warmup] built ${ref}`);
    } else {
      console.warn(
        `[warmup] could not build ${ref}: ` +
          `${((res.stderr || '') + '').trim().slice(0, 300) || `exit ${res.code}`}`
      );
    }
  }
}

async function warm() {
  if (pending) return pending;
  pending = (async () => {
    try {
      if (!(await docker.isAvailable())) {
        status = 'unavailable';
        return status;
      }

      await ensureCustomImages();

      const dir = await docker.ensureCacheDir('gocache');
      status = (await cacheHasContent()) ? 'warm' : 'warming';

      const args = [
        'run',
        '--rm',
        '--name', `dc-warm-${Date.now().toString(36)}`,
        '--network', 'none',
        '--memory', '1536m',
        '--memory-swap', '1536m',
        '--cpus', '1',
        '--pids-limit', '128',
        '--read-only',
        '--tmpfs', '/tmp:rw,nosuid,size=1g',
        '--cap-drop', 'ALL',
        '--security-opt', 'no-new-privileges',
        '--user', '65534:65534',
        '--workdir', '/work',
        '--env', 'HOME=/tmp',
        '--env', 'GO111MODULE=off',
        '--env', 'GOCACHE=/gocache',
        '--env', 'GOPATH=/tmp/gopath',
        '--volume', `${dir}:/gocache:rw`,
        'golang:1.23-alpine',
        'sh',
        '-c',
        // umask 000 keeps every cache entry world-writable/readable so the
        // host process can manage the directory regardless of container uid.
        'umask 000 && cd /tmp && go build std',
      ];

      const result = await runProcess('docker', args, {
        timeoutMs: WARMUP_TIMEOUT_MS,
        maxOutput: 8 * 1024,
      });

      if (result.timedOut || result.code !== 0) {
        lastError = (result.stderr || '').trim().slice(0, 500) || `exit ${result.code}`;
        status = status === 'warm' ? 'warm' : 'failed';
        console.warn(`[warmup] go cache warm-up failed: ${lastError}`);
      } else {
        status = 'warm';
        lastError = null;
        console.log('[warmup] go build cache ready');
      }
    } catch (err) {
      lastError = err.message;
      status = status === 'warm' ? 'warm' : 'failed';
      console.warn(`[warmup] ${err.message}`);
    } finally {
      pending = null;
    }
    return status;
  })();
  return pending;
}

function state() {
  return { status, error: lastError };
}

if (require.main === module) {
  warm()
    .then((s) => {
      console.log(`go cache: ${s}`);
      process.exit(s === 'warm' ? 0 : 1);
    })
    .catch(() => process.exit(1));
}

module.exports = { warm, state, ensureCustomImages };
