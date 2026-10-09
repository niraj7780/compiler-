'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { runProcess } = require('./process');

const COMPILE_SENTINEL = '.devcode-compile-error';

/**
 * Local fallback engine. Runs code directly on the host inside a locked-down
 * temp directory. Only used when Docker is unavailable - it is weaker
 * isolation than the container engine.
 */
function buildScript(lang) {
  const lines = ['#!/bin/sh', 'cd . || exit 1'];
  if (lang.build) {
    lines.push(`{ ${lang.build} ; } >.build.log 2>&1`);
    lines.push('st=$?');
    lines.push('if [ "$st" -ne 0 ]; then');
    lines.push(`  touch ${COMPILE_SENTINEL}`);
    lines.push('  cat .build.log >&2');
    lines.push('  exit 65');
    lines.push('fi');
    lines.push('if [ -s .build.log ]; then cat .build.log >&2; fi');
  }
  lines.push(`{ ${lang.run} ; } < stdin.txt`);
  lines.push('exit $?');
  return lines.join('\n') + '\n';
}

async function execute({ lang, code, stdin, timeoutMs, maxOutput }) {
  const tmpRoot = os.tmpdir();
  await fsp.mkdir(tmpRoot, { recursive: true }).catch(() => {});
  const workdir = await fsp.mkdtemp(path.join(tmpRoot, 'devcode-local-'));
  const started = Date.now();

  try {
    const file = lang.mainFile || `main.${lang.ext}`;
    await fsp.writeFile(path.join(workdir, file), code, { mode: 0o600 });
    await fsp.writeFile(path.join(workdir, 'stdin.txt'), stdin ?? '', { mode: 0o600 });
    for (const [name, content] of Object.entries(lang.extraFiles || {})) {
      await fsp.writeFile(path.join(workdir, name), content, { mode: 0o600 });
    }
    const scriptPath = path.join(workdir, '.devcode-run.sh');
    await fsp.writeFile(scriptPath, buildScript(lang), { mode: 0o700 });

    const bin = path.join(__dirname, '..', '..', 'node_modules', '.bin');
    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH || ''}`,
      HOME: workdir,
      TMPDIR: workdir,
      LANG: 'C.UTF-8',
      ...(lang.env || {}),
    };
    if (lang.sharedCache) {
      // Local engine keeps its own throwaway cache inside the temp dir.
      env.GOCACHE = path.join(workdir, '.gocache');
    }
    delete env.NODE_OPTIONS;

    const result = await runProcess('sh', [scriptPath], {
      cwd: workdir,
      env,
      timeoutMs,
      maxOutput,
    });

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.code,
      signal: result.signal,
      timedOut: result.timedOut,
      compileError: fs.existsSync(path.join(workdir, COMPILE_SENTINEL)),
      truncated: result.truncated,
      daemonDown: false,
      durationMs: Date.now() - started,
    };
  } finally {
    await fsp.rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { execute, buildScript };
