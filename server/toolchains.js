'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Runtime toolchain probe.
 *
 * The Docker engine ships every compiler in an image, but a serverless host
 * (Vercel, ...) only has whatever happens to be on the machine. Each language
 * declares `versionCmd: ['tool', '--version']`, so the first token is the one
 * binary that has to exist for the language to work - `tsc` is resolved from
 * `node_modules/.bin` because it ships as a dependency.
 */

const LOCAL_BIN = path.join(__dirname, '..', 'node_modules', '.bin');
const cache = new Map();

function searchDirs() {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  if (!dirs.includes(LOCAL_BIN)) dirs.push(LOCAL_BIN);
  return dirs;
}

function resolveBinary(name) {
  if (!name) return null;
  if (name.includes('/') || name.includes(path.sep)) {
    return fs.existsSync(name) ? name : null;
  }
  for (const dir of searchDirs()) {
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      /* try the next directory */
    }
  }
  return null;
}

function binaryOf(lang) {
  return (lang && lang.versionCmd && lang.versionCmd[0]) || null;
}

function isAvailable(lang) {
  if (!lang) return false;
  const bin = binaryOf(lang);
  if (!bin) return true;
  if (!cache.has(bin)) cache.set(bin, Boolean(resolveBinary(bin)));
  return cache.get(bin);
}

function missingTool(lang) {
  return binaryOf(lang);
}

module.exports = { isAvailable, resolveBinary, binaryOf, missingTool };
