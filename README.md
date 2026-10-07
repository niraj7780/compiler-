# DevCode — Modern Online Compiler

A fast, professional online compiler and code playground. Write, run and test
code in **Python, Java, C, C++, JavaScript, TypeScript, Go, Ruby, PHP, Perl and
Bash** directly in the browser.

- **Monaco editor** — the same editor that powers VS Code (syntax highlighting,
  IntelliSense, bracket pairing, word wrap, minimap).
- **Secure execution** — user code runs inside locked-down Docker containers
  (`--network none`, read-only rootfs, dropped capabilities, memory/CPU/PID
  limits, hard wall-clock timeout).
- **Input/output console** — separate `stdin` input and `stdout`/`stderr`
  output panes with compile-error, runtime-error and timeout reporting.
- **Dark / light mode** — instant theme switching, remembered across visits.
- **Responsive UI** — desktop three-pane layout that collapses cleanly on
  tablets and phones.
- **Self-hosted assets** — no CDNs or external fonts; works offline.

## Quick start

```bash
npm install
npm start          # http://localhost:3000
npm run dev        # auto-restart on changes
npm test           # end-to-end smoke test (API + all core languages)
```

Requirements: Node.js ≥ 18 and Docker (recommended — see
[Execution engines](#execution-engines)).

## Built-in languages

| Language   | Image                      | Build              | Run             |
| ---------- | -------------------------- | ------------------ | --------------- |
| Python     | `python:3.12-slim`         | —                  | `python3 main.py` |
| JavaScript | `node:22-slim`             | —                  | `node main.js`  |
| TypeScript | `devcode/ts:1`             | `tsc --strict …`   | `node main.js`  |
| Java       | `eclipse-temurin:21-jdk`   | `javac Main.java`  | `java Main`     |
| C          | `gcc:13.2`                 | `gcc -std=c17 …`   | `./prog`        |
| C++        | `gcc:13.2`                 | `g++ -std=c++17 …` | `./prog`        |
| Go         | `golang:1.23-alpine`       | `go build …`       | `./prog`        |
| Ruby       | `ruby:3.3-slim`            | —                  | `ruby main.rb`  |
| PHP        | `php:8.3-cli`              | —                  | `php main.php`  |
| Perl       | `devcode/perl:1`           | —                  | `perl main.pl`  |
| Bash       | `debian:trixie-slim`       | —                  | `bash main.sh`  |

Custom images (`devcode/ts`, `devcode/perl`) are built with:

```bash
npm run images    # runs docker/build.sh
```

## Execution engines

| Engine  | Isolation                                                                  |
| ------- | -------------------------------------------------------------------------- |
| `docker` (default) | Fresh container per run: no network, read-only filesystem, `cap-drop=ALL`, `no-new-privileges`, non-root user, 256 MB RAM, 0.5 CPU, 64 PIDs, 15 s timeout. |
| `local`  | Fallback used only when the Docker daemon is unavailable. Runs `sh` in a private temp directory on the host — weaker isolation, flagged as `degraded` in API responses. |

Force an engine with `EXECUTOR=docker|local|auto` (default `auto`), and tune the
timeout with `EXEC_TIMEOUT_MS` (default `15000`).

## API

### `POST /api/run`

```json
{ "language": "python", "code": "print(input())", "stdin": "hello\n" }
```

Response:

```json
{
  "status": "ok | error | compile-error | timeout",
  "stdout": "…", "stderr": "…",
  "exitCode": 0, "signal": null,
  "timedOut": false, "compileError": false, "truncated": false,
  "engine": "docker", "degraded": false, "durationMs": 412
}
```

### `GET /api/languages` — language metadata + starter programs.
### `GET /api/health` — engine, uptime, platform.

## Security model

- **Container sandbox**: no network namespace, read-only rootfs + `tmpfs /tmp`,
  all capabilities dropped, `no-new-privileges`, `--user 65534`, PID/CPU/memory
  limits, core dumps disabled, output capped at 64 KB/stream.
- **Timeouts**: wall-clock limit enforced by the host; the container is
  force-killed and removed on expiry.
- **HTTP layer**: Helmet (CSP, frame/ MIME protections), per-IP rate limiting
  (240 req/min global, 20 runs/min), 128 KB code and 64 KB input limits,
  control-character validation, JSON body capped at 256 KB.
- **Never trust output**: all program output is rendered as text nodes only
  (no HTML injection), and CSP restricts scripts to same-origin.

## Project structure

```
├── public/               # frontend
│   ├── index.html        # app shell (header, editor, console, status bar)
│   ├── css/styles.css    # design tokens, dark/light themes, responsive layout
│   └── js/app.js         # editor bootstrapping, theme, run loop, output render
├── server/
│   ├── index.js          # express app, security middleware, REST API
│   ├── languages.js      # language registry (images, commands, starters)
│   └── sandbox/
│       ├── index.js      # engine selection + validation + limits
│       ├── docker.js      # container executor
│       ├── local.js       # host fallback executor
│       └── process.js     # bounded child-process runner
├── docker/               # Dockerfiles for custom images
└── test/smoke.js         # end-to-end test suite
```

## Keyboard

- `Ctrl` / `Cmd` + `Enter` — run the current program.

## License

MIT
