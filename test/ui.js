'use strict';

/* Browser-level smoke test: boots the server, opens the UI in headless
 * Chromium and verifies the Monaco editor, theming and the run pipeline.
 * Requires the Playwright chromium build: npx playwright install chromium
 */

const assert = require('node:assert');
const { chromium } = require('playwright');
const { start } = require('../server');

async function main() {
  console.log('DevCode UI test\n');
  const server = await start(0, '127.0.0.1');
  const base = `http://127.0.0.1:${server.address().port}`;
  console.log(`server listening on ${base}`);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') pageErrors.push(msg.text());
  });

  const failed = [];
  const check = async (name, fn) => {
    try {
      await fn();
      console.log(`  ok   ${name}`);
    } catch (err) {
      failed.push(name);
      console.error(`  FAIL ${name}: ${err.message}`);
    }
  };

  try {
    await check('page loads with the app shell', async () => {
      const res = await page.goto(base, { waitUntil: 'domcontentloaded' });
      assert(res.status() === 200, `status ${res.status()}`);
      await page.waitForSelector('#run-btn', { timeout: 10000 });
      const title = await page.title();
      assert(/DevCode/.test(title), `title=${title}`);
    });

    await check('monaco editor boots', async () => {
      await page.waitForSelector('.monaco-editor', { timeout: 20000 });
      const visible = await page.isVisible('.monaco-editor');
      assert(visible, 'editor not visible');
    });

    await check('language selector lists the core languages', async () => {
      await page.waitForFunction(
        () => document.querySelectorAll('#language option').length >= 6,
        { timeout: 10000 }
      );
      const ids = await page.$$eval('#language option', (opts) => opts.map((o) => o.value));
      for (const want of ['python', 'java', 'c', 'cpp', 'javascript']) {
        assert(ids.includes(want), `missing ${want}`);
      }
    });

    await check('dark/light toggle switches theme', async () => {
      const before = await page.getAttribute('html', 'data-theme');
      await page.click('#theme-toggle');
      await page.waitForTimeout(150);
      const after = await page.getAttribute('html', 'data-theme');
      assert(before !== after, `theme stayed ${before}`);
      await page.click('#theme-toggle');
      await page.waitForTimeout(150);
      const restored = await page.getAttribute('html', 'data-theme');
      assert(restored === before, 'theme did not restore');
    });

    await check('Run button executes the starter program', async () => {
      await page.click('#run-btn');
      await page.waitForSelector('#status-chip.is-ok', { timeout: 40000 });
      const output = await page.textContent('#output');
      assert(output.includes('Hello, DevCode!'), `output=${JSON.stringify(output.slice(0, 200))}`);
      const meta = await page.textContent('#run-meta');
      assert(/\d+ ms/.test(meta), `meta=${meta}`);
    });

    await check('switching language loads its starter code', async () => {
      await page.selectOption('#language', 'cpp');
      await page.waitForTimeout(300);
      const fileName = await page.textContent('#file-name');
      assert(fileName === 'main.cpp', `file=${fileName}`);
      const code = await page.evaluate(() => {
        const model = window.monaco && window.monaco.editor.getModels()[0];
        return model ? model.getValue() : '';
      });
      assert(code.includes('#include <iostream>'), 'cpp starter not loaded');
    });

    await check('compiled language runs after switching', async () => {
      await page.click('#run-btn');
      await page.waitForSelector('#status-chip.is-ok', { timeout: 40000 });
      const output = await page.textContent('#output');
      assert(output.includes('Hello, DevCode!'), `output=${JSON.stringify(output.slice(0, 200))}`);
    });

    await check('no page or CSP errors', async () => {
      const relevant = pageErrors.filter(
        (e) => !/favicon|Download the React/i.test(e)
      );
      assert(relevant.length === 0, relevant.slice(0, 5).join(' | '));
    });
  } finally {
    await browser.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
  }

  console.log(`\n${failed.length ? failed.length + ' failed' : 'all passed'}`);
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exitCode = 1;
});
