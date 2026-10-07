'use strict';

const { spawn } = require('node:child_process');

/**
 * Spawn a process, capture bounded stdout/stderr, enforce a wall-clock timeout
 * and return a structured result. Never throws for non-zero exits.
 */
function runProcess(cmd, args, opts = {}) {
  const {
    cwd,
    env = process.env,
    timeoutMs = 15000,
    maxOutput = 64 * 1024,
    onSpawn,
    onTimeout,
    input,
  } = opts;

  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let stdout = '';
    let stderr = '';
    let stdoutLen = 0;
    let stderrLen = 0;
    let truncated = false;

    let child;
    try {
      child = spawn(cmd, args, {
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      });
    } catch (err) {
      resolve({
        code: null,
        signal: null,
        stdout: '',
        stderr: `Failed to spawn ${cmd}: ${err.message}`,
        timedOut: false,
        truncated: false,
        error: err,
      });
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      if (onTimeout) {
        try {
          onTimeout(child);
        } catch {
          /* ignore */
        }
      }
      killTree(child);
    }, timeoutMs);

    const append = (which, chunk) => {
      const text = chunk.toString('utf8');
      if (which === 'out') {
        if (stdoutLen < maxOutput) {
          const room = maxOutput - stdoutLen;
          stdout += text.slice(0, room);
          stdoutLen += text.length;
          if (text.length > room) truncated = true;
        } else {
          truncated = true;
        }
      } else if (stderrLen < maxOutput) {
        const room = maxOutput - stderrLen;
        stderr += text.slice(0, room);
        stderrLen += text.length;
        if (text.length > room) truncated = true;
      } else {
        truncated = true;
      }
    };

    child.stdout.on('data', (c) => append('out', c));
    child.stderr.on('data', (c) => append('err', c));

    if (input != null) {
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    } else {
      child.stdin.end();
    }

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (truncated) {
        const note = '\n[output truncated: limit reached]\n';
        if (stdoutLen >= maxOutput) stdout += note;
        if (stderrLen >= maxOutput) stderr += note;
      }
      resolve({
        timedOut,
        truncated,
        stdout,
        stderr,
        ...result,
      });
    };

    child.on('error', (err) => {
      finish({ code: null, signal: null, error: err, stderr: stderr || err.message });
    });

    child.on('close', (code, signal) => {
      finish({ code, signal, error: null });
    });

    if (onSpawn) onSpawn(child);
  });
}

function killTree(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  try {
    if (process.platform !== 'win32' && child.pid) {
      process.kill(-child.pid, 'SIGKILL');
    } else {
      child.kill('SIGKILL');
    }
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

module.exports = { runProcess, killTree };
