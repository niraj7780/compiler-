'use strict';

/* End-to-end smoke test for the DevCode compiler.
 * Starts the server on an ephemeral port, exercises the API and the
 * execution sandbox, then reports a pass/fail summary.
 */

process.env.EXEC_TIMEOUT_MS = process.env.EXEC_TIMEOUT_MS || '8000';

const { start } = require('../server');

let passed = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.error(`  FAIL ${name}\n       ${err.message.split('\n').join('\n       ')}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

async function json(base, path, opts) {
  const res = await fetch(base + path, opts);
  const body = await res.json().catch(() => null);
  return { res, body };
}

async function run(base, payload) {
  const { res, body } = await json(base, '/api/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body };
}

async function main() {
  console.log('DevCode smoke test\n');

  const server = await start(0, '127.0.0.1');
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  console.log(`server listening on ${base}\n`);

  try {
    await check('health endpoint responds with an engine', async () => {
      const { res, body } = await json(base, '/api/health');
      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert(body.ok === true, 'ok flag missing');
      assert(['docker', 'local'].includes(body.engine), `bad engine: ${body.engine}`);
    });

    await check('security headers are set', async () => {
      const res = await fetch(base + '/');
      assert(res.headers.get('content-security-policy'), 'missing CSP header');
      assert(res.headers.get('x-content-type-options') === 'nosniff', 'missing nosniff');
      assert(res.headers.get('x-frame-options') === 'DENY', 'missing frame protection');
    });

    await check('rate limit headers are sent', async () => {
      const res = await fetch(base + '/api/languages');
      const rl = ['ratelimit', 'ratelimit-limit', 'x-ratelimit-limit'].some(
        (h) => res.headers.get(h)
      );
      assert(rl, 'no rate limit headers found');
    });

    await check('language list exposes the core set', async () => {
      const { res, body } = await json(base, '/api/languages');
      assert(res.status === 200, `expected 200, got ${res.status}`);
      const ids = body.languages.map((l) => l.id);
      for (const want of ['python', 'java', 'c', 'cpp', 'javascript', 'typescript']) {
        assert(ids.includes(want), `missing language: ${want}`);
      }
      for (const l of body.languages) {
        assert(typeof l.starter === 'string' && l.starter.length > 0, `${l.id}: no starter`);
        assert(l.monaco, `${l.id}: no monaco id`);
        assert(l.file, `${l.id}: no file name`);
      }
    });

    await check('frontend shell is served', async () => {
      const res = await fetch(base + '/');
      const html = await res.text();
      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert(html.includes('DevCode'), 'brand missing');
      assert(html.includes('id="run-btn"'), 'run button missing');
      assert(html.includes('/js/app.js'), 'app script missing');
    });

    await check('monaco assets are served', async () => {
      const res = await fetch(base + '/monaco/vs/loader.js');
      assert(res.status === 200, `expected 200, got ${res.status}`);
      const text = await res.text();
      assert(text.length > 1000, 'loader.js looks empty');
    });

    await check('unknown language is rejected with 400', async () => {
      const { status, body } = await run(base, {
        language: 'brainfuck-9000',
        code: 'print(1)',
        stdin: '',
      });
      assert(status === 400, `expected 400, got ${status}`);
      assert(body.error, 'error message missing');
    });

    await check('empty code is rejected with 400', async () => {
      const { status } = await run(base, { language: 'python', code: '', stdin: '' });
      assert(status === 400, `expected 400, got ${status}`);
    });

    await check('oversized code is rejected with 413', async () => {
      const { status } = await run(base, {
        language: 'python',
        code: '# ' + 'x'.repeat(140 * 1024),
        stdin: '',
      });
      assert(status === 413, `expected 413, got ${status}`);
    });

    await check('python: runs with stdin', async () => {
      const { status, body } = await run(base, {
        language: 'python',
        code: 'name = input().strip()\nprint(f"Hello, {name}!")\n',
        stdin: 'DevCode\n',
      });
      assert(status === 200, `expected 200, got ${status}`);
      assert(body.status === 'ok', `status=${body.status} stderr=${body.stderr}`);
      assert(body.stdout === 'Hello, DevCode!\n', `stdout=${JSON.stringify(body.stdout)}`);
      assert(body.exitCode === 0, `exitCode=${body.exitCode}`);
    });

    await check('python: stdout and stderr are separated', async () => {
      const { body } = await run(base, {
        language: 'python',
        code: 'import sys\nprint("out")\nprint("err", file=sys.stderr)\n',
        stdin: '',
      });
      assert(body.status === 'ok', `status=${body.status}`);
      assert(body.stdout.includes('out'), 'stdout missing');
      assert(!body.stdout.includes('err'), 'stderr leaked into stdout');
      assert(body.stderr.includes('err'), 'stderr missing');
    });

    await check('python: runtime error is reported', async () => {
      const { body } = await run(base, {
        language: 'python',
        code: 'raise ValueError("boom")\n',
        stdin: '',
      });
      assert(body.status === 'error', `status=${body.status}`);
      assert(body.exitCode !== 0, 'expected non-zero exit');
      assert(body.stderr.includes('ValueError'), `stderr=${body.stderr}`);
    });

    await check('javascript: runs', async () => {
      const { body } = await run(base, {
        language: 'javascript',
        code: 'const fs = require("fs");\nconst data = fs.readFileSync(0, "utf8").trim();\nconsole.log(`Hello, ${data || "world"}!`);\n',
        stdin: 'DevCode\n',
      });
      assert(body.status === 'ok', `status=${body.status} stderr=${body.stderr}`);
      assert(body.stdout === 'Hello, DevCode!\n', `stdout=${JSON.stringify(body.stdout)}`);
    });

    await check('c: compiles and runs', async () => {
      const { body } = await run(base, {
        language: 'c',
        code: '#include <stdio.h>\nint main(void){int a,b;if(scanf("%d %d",&a,&b)!=2)return 1;printf("%d\\n",a+b);return 0;}\n',
        stdin: '20 22\n',
      });
      assert(body.status === 'ok', `status=${body.status} stderr=${body.stderr}`);
      assert(body.stdout === '42\n', `stdout=${JSON.stringify(body.stdout)}`);
    });

    await check('c: compile error is flagged', async () => {
      const { body } = await run(base, {
        language: 'c',
        code: 'int main(void) { return }',
        stdin: '',
      });
      assert(body.status === 'compile-error', `status=${body.status}`);
      assert(body.compileError !== undefined, 'no compileError field');
      assert(/error/i.test(body.stderr), `stderr=${body.stderr}`);
    });

    await check('cpp: compiles and runs', async () => {
      const { body } = await run(base, {
        language: 'cpp',
        code: '#include <iostream>\nint main(){long long a,b;if(!(std::cin>>a>>b))return 1;std::cout<<(a+b)<<"\\n";return 0;}\n',
        stdin: '9000000000 1000000000\n',
      });
      assert(body.status === 'ok', `status=${body.status} stderr=${body.stderr}`);
      assert(body.stdout === '10000000000\n', `stdout=${JSON.stringify(body.stdout)}`);
    });

    await check('java: compiles and runs', async () => {
      const { body } = await run(base, {
        language: 'java',
        code: 'public class Main { public static void main(String[] a){ System.out.println("Hello, Java!"); } }\n',
        stdin: '',
      });
      assert(body.status === 'ok', `status=${body.status} stderr=${body.stderr}`);
      assert(body.stdout === 'Hello, Java!\n', `stdout=${JSON.stringify(body.stdout)}`);
    });

    await check('infinite loop is terminated by the timeout', async () => {
      const { body } = await run(base, {
        language: 'python',
        code: 'while True:\n    pass\n',
        stdin: '',
      });
      assert(body.timedOut === true, `timedOut=${body.timedOut}`);
      assert(body.status === 'timeout', `status=${body.status}`);
      assert(body.durationMs < 20000, `took too long: ${body.durationMs}ms`);
    });

    const { body: health } = await json(base, '/api/health');
    console.log(`\nengine: ${health.engine}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exitCode = 1;
});
