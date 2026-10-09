'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { runProcess } = require('./process');

const COMPILE_SENTINEL = '.devcode-compile-error';
// Overridable so a containerized server can put the cache at a path that is
// identical inside the container and on the Docker host (bind-mount parity).
const CACHE_ROOT =
  process.env.DEVCODE_CACHE_DIR || path.join(__dirname, '..', '..', '.cache');

function cacheDir(name) {
  return path.join(CACHE_ROOT, name);
}

async function ensureCacheDir(name) {
  const dir = cacheDir(name);
  await fsp.mkdir(dir, { recursive: true, mode: 0o777 });
  await fsp.chmod(dir, 0o777).catch(() => {});
  return dir;
}

/** POSIX sh wrapper executed inside the container (busybox sh compatible). */
function buildScript(lang) {
  const lines = ['#!/bin/sh', 'cd /work || exit 1'];
  appendBuild(lang, lines);
  appendRun(lang, lines);
  return lines.join('\n') + '\n';
}

function buildOnlyScript(lang) {
  const lines = ['#!/bin/sh', 'cd /work || exit 1'];
  appendBuild(lang, lines);
  lines.push('exit 0');
  return lines.join('\n') + '\n';
}

function runOnlyScript(lang) {
  const lines = ['#!/bin/sh', 'cd /work || exit 1'];
  appendRun(lang, lines);
  return lines.join('\n') + '\n';
}

function appendBuild(lang, lines) {
  if (!lang.build) return;
  lines.push(`{ ${lang.build} ; } >/work/.build.log 2>&1`);
  lines.push('st=$?');
  lines.push('if [ "$st" -ne 0 ]; then');
  lines.push(`  touch /work/${COMPILE_SENTINEL}`);
  lines.push('  cat /work/.build.log >&2');
  lines.push('  exit 65');
  lines.push('fi');
  lines.push('if [ -s /work/.build.log ]; then cat /work/.build.log >&2; fi');
}

function appendRun(lang, lines) {
  lines.push(`{ ${lang.run} ; } < /work/stdin.txt`);
  lines.push('exit $?');
}

function baseArgs(name, workdir) {
  return [
    'run',
    '--name', name,
    '--rm',
    '--network', 'none',
    '--memory', process.env.EXEC_MEMORY || '384m',
    '--memory-swap', process.env.EXEC_MEMORY || '384m',
    '--cpus', process.env.EXEC_CPUS || '1',
    '--pids-limit', '64',
    '--read-only',
    '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--user', '65534:65534',
    '--ulimit', 'core=0',
    '--ulimit', 'nofile=256',
    '--workdir', '/work',
    '--env', 'HOME=/tmp',
    '--env', 'LANG=C.UTF-8',
    '--env', 'TZ=UTC',
    '--volume', `${workdir}:/work:rw`,
  ];
}

/**
 * Run one container phase. Resolves with the bounded process result; never
 * throws for non-zero exits. Cleans up the container when something went wrong.
 */
async function runPhase({
  name,
  workdir,
  image,
  env = {},
  scriptFile,
  mounts = [],
  timeoutMs,
  maxOutput,
}) {
  const args = baseArgs(name, workdir);
  for (const [key, value] of Object.entries(env)) {
    args.push('--env', `${key}=${value}`);
  }
  for (const mount of mounts) {
    args.push('--volume', `${mount.source}:${mount.target}:rw`);
  }
  args.push(image, 'sh', `/work/${scriptFile}`);

  let result = null;
  try {
    result = await runProcess('docker', args, {
      timeoutMs,
      maxOutput,
      onTimeout: () => {
        // Killing the docker CLI does not stop the container - stop it explicitly.
        runProcess('docker', ['kill', name], { timeoutMs: 3000 }).catch(() => {});
      },
    });
  } finally {
    if (!result || result.timedOut || result.error) {
      runProcess('docker', ['rm', '-f', name], { timeoutMs: 3000 }).catch(() => {});
    }
  }
  return result;
}

function isDaemonDown(result) {
  return (
    /Cannot connect to the Docker daemon|Is the docker daemon running/i.test(
      (result && result.stderr) || ''
    ) || (result && result.error && result.error.code === 'ENOENT')
  );
}

async function execute({ lang, code, stdin, timeoutMs, maxOutput }) {
  // os.tmpdir() may point at a directory that only exists on the host (the
  // compose bind mount hides whatever the image pre-created).
  const tmpRoot = os.tmpdir();
  await fsp.mkdir(tmpRoot, { recursive: true }).catch(() => {});
  const workdir = await fsp.mkdtemp(path.join(tmpRoot, 'devcode-'));
  const started = Date.now();
  const tag = crypto.randomBytes(6).toString('hex');

  try {
    const file = lang.mainFile || `main.${lang.ext}`;
    await fsp.writeFile(path.join(workdir, file), code, { mode: 0o644 });
    await fsp.writeFile(path.join(workdir, 'stdin.txt'), stdin ?? '', { mode: 0o644 });
    for (const [name, content] of Object.entries(lang.extraFiles || {})) {
      await fsp.writeFile(path.join(workdir, name), content, { mode: 0o644 });
    }
    await fsp.chmod(workdir, 0o777);

    const mounts = [];
    const env = { ...(lang.env || {}) };
    let result;

    if (lang.sharedCache && lang.build) {
      // Two-phase run: the build phase gets the shared warm cache mounted,
      // the run phase never sees it, so user code cannot touch the cache.
      const cachePath = await ensureCacheDir(lang.sharedCache);
      mounts.push({ source: cachePath, target: '/gocache' });
      env.GOCACHE = '/gocache';

      const buildScriptPath = '.devcode-build.sh';
      await fsp.writeFile(path.join(workdir, buildScriptPath), buildOnlyScript(lang), {
        mode: 0o755,
      });

      const buildResult = await runPhase({
        name: `dc-b-${tag}`,
        workdir,
        image: lang.image,
        env,
        scriptFile: buildScriptPath,
        mounts,
        timeoutMs,
        maxOutput,
      });

      if (isDaemonDown(buildResult) || buildResult.timedOut || buildResult.error) {
        return finish(buildResult, started, workdir, { compileError: false });
      }

      const compileFailed =
        buildResult.code !== 0 || fs.existsSync(path.join(workdir, COMPILE_SENTINEL));
      if (compileFailed) {
        return finish(buildResult, started, workdir, { compileError: true });
      }

      const runScriptPath = '.devcode-run.sh';
      await fsp.writeFile(path.join(workdir, runScriptPath), runOnlyScript(lang), {
        mode: 0o755,
      });

      result = await runPhase({
        name: `dc-r-${tag}`,
        workdir,
        image: lang.image,
        env: lang.env || {},
        scriptFile: runScriptPath,
        mounts: [],
        timeoutMs,
        maxOutput,
      });

      return finish(result, started, workdir, { compileError: false });
    }

    // Single-phase run: build + execute inside one container.
    await fsp.writeFile(path.join(workdir, '.devcode-run.sh'), buildScript(lang), {
      mode: 0o755,
    });

    result = await runPhase({
      name: `dc-${tag}`,
      workdir,
      image: lang.image,
      env,
      scriptFile: '.devcode-run.sh',
      mounts,
      timeoutMs,
      maxOutput,
    });

    const compileError = Boolean(lang.build) && fs.existsSync(path.join(workdir, COMPILE_SENTINEL));
    return finish(result, started, workdir, { compileError });
  } catch (err) {
    await fsp.rm(workdir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

function finish(result, started, workdir, opts = {}) {
  const out = {
    stdout: (result && result.stdout) || '',
    stderr: (result && result.stderr) || '',
    exitCode: result ? result.code : null,
    signal: result ? result.signal : null,
    timedOut: Boolean(result && result.timedOut),
    compileError: Boolean(opts.compileError),
    truncated: Boolean(result && result.truncated),
    daemonDown: isDaemonDown(result),
    durationMs: Date.now() - started,
  };
  fsp.rm(workdir, { recursive: true, force: true }).catch(() => {});
  return out;
}

async function isAvailable(timeoutMs = 4000) {
  const res = await runProcess('docker', ['info', '--format', '{{.ServerVersion}}'], {
    timeoutMs,
    maxOutput: 2048,
  });
  return res.code === 0;
}

module.exports = {
  execute,
  isAvailable,
  buildScript,
  buildOnlyScript,
  runOnlyScript,
  cacheDir,
  ensureCacheDir,
  CACHE_ROOT,
};
