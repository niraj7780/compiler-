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

## Self-hosting (all 11 languages)

Vercel has no Docker daemon and no compilers, so only the languages the host
can run work there. On your own machine **every language works** — the Docker
engine ships each toolchain in its image.

**Option A — machine with Node.js and Docker (the full test suite runs here):**

```bash
git clone https://github.com/niraj7780/compiler- && cd compiler-
npm install
npm run images      # build devcode/ts:1 and devcode/perl:1 (once)
npm start           # http://localhost:3000
```

**Option B — any Docker host, no Node.js needed (VPS, bare metal):**

```bash
git clone https://github.com/niraj7780/compiler- && cd compiler-
docker compose up -d --build      # http://localhost:3000
```

The compose setup mounts the host Docker socket and a shared data directory
(`/var/lib/devcode`) so sandbox containers can bind-mount work directories by
absolute path. On first boot the app builds any missing custom images and
warms the Go build cache in the background — no extra steps.

Plain `docker run` equivalent:

```bash
docker build -t devcode .
docker run -d --name devcode -p 3000:3000 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /var/lib/devcode:/var/lib/devcode \
  devcode
```

Note: the server container needs access to the Docker socket, which is root
equivalent — expose it only on hosts you trust (put it behind a reverse proxy
with TLS before serving it publicly).

## Deploying to Vercel

The repository ships with a ready-made [`vercel.json`](./vercel.json), so the
only step is importing the repo at [vercel.com/new](https://vercel.com/new)
(or running `vercel` in the project root). No settings to fill in.

How the pieces map onto Vercel:

| Piece                     | On Vercel                                                        |
| ------------------------- | ---------------------------------------------------------------- |
| `public/**`               | Static assets served from the CDN (`/`, `/css/*`, `/js/*`).      |
| `api/index.js`            | One serverless function running the whole Express app.           |
| `/(.*) → /api` rewrite    | Every other path (API, `/monaco/vs/*`) reaches that function.    |
| `node_modules/monaco-editor/min/**` | Bundled into the function so the editor loads offline. |

Differences from self-hosting:

- **No Docker.** The `local` engine is selected automatically, so user code
  runs as a plain child process. Each language is then checked against the
  host: languages whose toolchain is missing are reported as
  `available: false`, disabled in the UI, and rejected with `503` by
  `/api/run`. (With the Docker engine every language stays available — the
  image provides the toolchain.) Out of the box that means JavaScript plus
  whatever the runtime image ships; C, C++, Java and Go need the Docker
  engine — self-host for the full set.
- **`trust proxy` is enabled** for `X-Forwarded-For` so rate limits are keyed
  per visitor instead of per platform IP.
- Function duration is set to 300 s, comfortably above the 20 s execution
  timeout.

## Built-in languages

| Language   | Image                      | Build              | Run             |
| ---------- | -------------------------- | ------------------ | --------------- |
| Python     | `python:3.12-slim`         | —                  | `python3 main.py` |
| JavaScript | `node:22-slim`             | —                  | `node main.js`  |
| TypeScript | `devcode/ts:1`             | `tsc --strict …`   | `node main.js`  |
| Java       | `eclipse-temurin:21-jdk-jammy` | `javac -encoding UTF-8 Main.java` | `java -XX:+UseSerialGC -Xmx192m -cp . Main` |
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
| `docker` (default) | Fresh container per run: no network, read-only filesystem, `cap-drop=ALL`, `no-new-privileges`, non-root user, 384 MB RAM, 1 CPU, 64 PIDs, 20 s timeout. |
| `local`  | Fallback used only when the Docker daemon is unavailable. Runs `sh` in a private temp directory on the host — weaker isolation, flagged as `degraded` in API responses. |

Force an engine with `EXECUTOR=docker|local|auto` (default `auto`), and tune the
timeout with `EXEC_TIMEOUT_MS` (default `20000`).

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

### `GET /api/languages` — language metadata + starter programs, including an
`available` flag per language (false when the host lacks that toolchain).
### `GET /api/health` — engine, host (`self-hosted` | `vercel`), uptime, platform.

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
├── api/index.js          # Vercel serverless entry (exports the Express app)
├── vercel.json           # Vercel routing, static output, bundled assets
├── Dockerfile            # app image for self-hosting (drives the host daemon)
├── docker-compose.yml    # one-command self-host: docker compose up -d --build
├── public/               # frontend
│   ├── index.html        # app shell (header, editor, console, status bar)
│   ├── css/styles.css    # design tokens, dark/light themes, responsive layout
│   └── js/app.js         # editor bootstrapping, theme, run loop, output render
├── server/
│   ├── index.js          # express app, security middleware, REST API
│   ├── languages.js      # language registry (images, commands, starters)
│   ├── toolchains.js     # host toolchain probe (available flag, 503 responses)
│   └── sandbox/
│       ├── index.js      # engine selection + validation + limits
│       ├── docker.js      # container executor
│       ├── local.js       # host fallback executor
│       ├── process.js     # bounded child-process runner
│       └── warmup.js      # custom image build + Go cache warm-up
├── docker/               # Dockerfiles for custom images
└── test/smoke.js         # end-to-end test suite
```

## Keyboard

- `Ctrl` / `Cmd` + `Enter` — run the current program.

## License

MIT
