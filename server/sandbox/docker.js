'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { runProcess } = require('./process');

const COMPILE_SENTINEL = '.devcode-compile-error';

/** POSIX sh wrapper executed inside the container (busybox sh compatible). */
function buildScript(lang) {
  const lines = ['#!/bin/sh', 'cd /work || exit 1'];
  if (lang.build) {
    lines.push(`{ ${lang.build} ; } >/work/.build.log 2>&1`);
    lines.push('st=$?');
    lines.push('if [ "$st" -ne 0 ]; then');
    lines.push(`  touch /work/${COMPILE_SENTINEL}`);
    lines.push('  cat /work/.build.log >&2');
    lines.push('  exit 65');
    lines.push('fi');
    lines.push('if [ -s /work/.build.log ]; then cat /work/.build.log >&2; fi');
  }
  lines.push(`{ ${lang.run} ; } < /work/stdin.txt`);
  lines.push('exit $?');
  return lines.join('\n') + '\n';
}

function dockerArgs(name, workdir, image, extraEnv) {
  const args = [
    'run',
    '--name', name,
    '--rm',
    '--network', 'none',
    '--memory', '256m',
    '--memory-swap', '256m',
    '--cpus', '0.5',
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
  for (const [k, v] of Object.entries(extraEnv || {})) {
    args.push('--env', `${k}=${v}`);
  }
  args.push(image, 'sh', '/work/.devcode-run.sh');
  return args;
}

async function execute({ lang, code, stdin, timeoutMs, maxOutput }) {
  const workdir = await fsp.mkdtemp(path.join(os.tmpdir(), 'devcode-'));
  const name = `dc-${crypto.randomBytes(6).toString('hex')}`;
  const started = Date.now();
  let result = null;

  try {
    const file = lang.mainFile || `main.${lang.ext}`;
    await fsp.writeFile(path.join(workdir, file), code, { mode: 0o644 });
    await fsp.writeFile(path.join(workdir, 'stdin.txt'), stdin ?? '', { mode: 0o644 });
    await fsp.writeFile(path.join(workdir, '.devcode-run.sh'), buildScript(lang), {
      mode: 0o755,
    });
    await fsp.chmod(workdir, 0o777);

    const args = dockerArgs(name, workdir, lang.image, lang.env);

    result = await runProcess('docker', args, {
      timeoutMs,
      maxOutput,
      onTimeout: () => {
        // Killing the docker CLI does not stop the container - stop it explicitly.
        runProcess('docker', ['kill', name], { timeoutMs: 3000 }).catch(() => {});
      },
    });

    const compileError = fs.existsSync(path.join(workdir, COMPILE_SENTINEL));

    const daemonDown =
      /Cannot connect to the Docker daemon|Is the docker daemon running/i.test(
        result.stderr || ''
      ) || (result.error && result.error.code === 'ENOENT');

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.code,
      signal: result.signal,
      timedOut: result.timedOut,
      compileError,
      truncated: result.truncated,
      daemonDown,
      durationMs: Date.now() - started,
    };
  } finally {
    await fsp.rm(workdir, { recursive: true, force: true }).catch(() => {});
    if (!result || result.timedOut || result.error) {
      runProcess('docker', ['rm', '-f', name], { timeoutMs: 3000 }).catch(() => {});
    }
  }
}

async function isAvailable(timeoutMs = 4000) {
  const res = await runProcess('docker', ['info', '--format', '{{.ServerVersion}}'], {
    timeoutMs,
    maxOutput: 2048,
  });
  return res.code === 0;
}

module.exports = { execute, isAvailable, buildScript };
