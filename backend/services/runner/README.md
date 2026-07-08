# @stigmer/runner

Embeddable Temporal worker for the Stigmer AI agent platform. The runner executes agent sessions and workflow executions — driving the Cursor and native (deep-agent) harnesses, orchestrating MCP servers, and reporting status and artifacts back to the Stigmer backend.

It is the single runtime behind three surfaces:

- the **CLI daemon** (`stigmer up`) running agents locally,
- **cloud deployments** (Kubernetes / sandbox) running managed executions, and
- the **desktop app**, which embeds the runner as a subprocess to run sessions on the user's own machine.

This document is the operational reference for the package: how it runs, what it needs, and every environment variable that configures it. You should not need to read `config.ts` or `main.ts` to operate or embed the runner.

> **You usually don't start the runner by hand.** `stigmer up` runs it for local agent execution, and the desktop app embeds it automatically. Invoke the `stigmer-runner` binary directly only for advanced operation or embedding — which is what this document covers.

> The deep manager-mode IPC protocol (see [Manager mode](#manager-mode)), the desktop-vs-web embedding walkthrough, and the SDK-level `RunnerAdapter` / `executionTarget` surfaces are documented separately — see [Related documentation](#related-documentation).

## Install and build

The runner is a workspace package in the Stigmer monorepo. Build it from the repo root:

```bash
make build-runner
```

This runs `npm run build` in `backend/services/runner` (`tsc -p tsconfig.build.json`) and then writes a build fingerprint (see [The stale-build guard](#the-stale-build-guard)). The compiled output lands in `dist/`, with a `stigmer-runner` CLI entry point at `dist/main.js`.

Requires Node.js `>= 22.13` (the durable local checkpointer uses the built-in `node:sqlite`, unflagged from v22.13 / v23.4).

### The slim embedding artifact

The plain `dist/` resolves its dependencies from `node_modules` at runtime — ~508 MB unpacked, which is unshippable inside a desktop app ([#170](https://github.com/stigmer/stigmer/issues/170)). For embedding, build the **slim artifact**:

```bash
make build-runner-slim          # or: npm run build:slim
```

This produces `dist-slim/`: a tree-shaken esbuild bundle of the whole runner (`main.js`), a build-time-prebuilt Temporal workflow bundle, and a staged `node_modules` containing only the packages that genuinely cannot be bundled (the platform-pruned Temporal native bridge, `@cursor/sdk` and its native binaries, `jq-wasm`) — **~85 MB per platform**. `node dist-slim/main.js` accepts the same modes, environment variables, and IPC protocol as `dist/main.js`. See `scripts/bundle-slim.mjs` for the full layout, `scripts/verify-slim-artifact.mjs` for the boot verification that gates releases, and the [embedding guide](https://docs.stigmer.ai/guides/runners/embedding) for how apps stage it.

> **Why the slim bundle is CommonJS, not ESM.** The runner's auth correctness depends on a deliberate module **load order**: it installs the fetch + HTTP/2 interceptors first, then lazily loads `@cursor/sdk` and `@connectrpc/connect-node` (via dynamic `import()`) so the interceptors are in place before those packages capture `globalThis.fetch` / snapshot the `node:http2` ESM facade. An **ESM** esbuild bundle destroys this — it hoists every external `import` to the top of the output and evaluates them before any code runs, freezing the `node:http2` facade and capturing the original `fetch` before install, which silently breaks proxy auth on the authenticated path (this was the regression in [#170](https://github.com/stigmer/stigmer/issues/170)). A **CJS** bundle preserves the source's lazy evaluation order, so the dynamic-import boundary keeps both interceptors correct. The meta `package.json` deliberately omits `"type": "module"` so `node main.js` runs as CommonJS — do **not** add it back, and do not flip `format` to `"esm"` in `bundle-slim.mjs`. The boot guard `assertHttp2ConnectPatched()` plus the authenticated check in `verify-slim-artifact.mjs` fail loudly if this is ever reverted.

The slim build is also published to npm as `@stigmer/runner-slim` (with per-platform `@stigmer/runner-slim-<platform>` support packages) alongside the full `@stigmer/runner` package on every release.

## Run modes

The runner has two **run modes**, selected by the `STIGMER_RUNNER_MODE` environment variable. Do not confuse the run mode (process topology) with the execution location (`MODE=local|cloud`) or the transport (`STIGMER_PROXY_ENDPOINT`) — those are independent axes covered in [Execution location vs transport](#execution-location-vs-transport).

| Run mode | Selector | Topology | Used by |
|----------|----------|----------|---------|
| Static | `STIGMER_RUNNER_MODE` unset (default) | One Worker polling one task queue; blocks until shutdown | CLI daemon, cloud deployments |
| Manager | `STIGMER_RUNNER_MODE=manager` | Shared Temporal connection; dynamic per-session / per-execution Workers; stdin/stdout JSON IPC | Desktop app |

### Static mode

Static mode creates a single Temporal Worker that polls one task queue and runs until it receives `SIGTERM` / `SIGINT`. This is the right mode when the set of work is fixed at startup (a daemon or a pod dedicated to a queue).

As a library:

```ts
import { createStigmerRunner } from "@stigmer/runner";

const runner = await createStigmerRunner({
  taskQueue: "stigmer_runner",
  temporalAddress: "localhost:7233",
  stigmerEndpoint: "http://localhost:7234",
});

process.on("SIGTERM", () => runner.shutdown());
await runner.start(); // blocks until shutdown
```

The `stigmer-runner` CLI runs this mode by default, reading its configuration from the environment.

### Manager mode

Manager mode keeps a single shared Temporal connection and a single set of activities, then spins Workers up and down on demand — one per session (`session:{sessionId}`) and one per workflow execution (`wfexec:{executionId}`). This is what the desktop app needs: it adds and removes Workers as the user opens and closes sessions, without restarting the process.

As a library:

```ts
import { createStigmerRunnerManager } from "@stigmer/runner";

const manager = await createStigmerRunnerManager({
  temporalAddress: "localhost:7233",
  stigmerEndpoint: "http://localhost:7234",
});

await manager.addSession("ses_abc123");
// ... later
await manager.removeSession("ses_abc123");
await manager.shutdown();
```

As a subprocess, the host launches `stigmer-runner` with `STIGMER_RUNNER_MODE=manager` and drives it over a line-delimited JSON protocol on stdin/stdout (`addSession`, `removeSession`, `addWorkflowExecution`, `updateToken`, `shutdown`). The protocol surface is intentionally small and is specified in detail elsewhere — see [Related documentation](#related-documentation).

### A note for embedders: OpenTelemetry

When you embed the runner as a **library** (`createStigmerRunner` / `createStigmerRunnerManager`), the factory does **not** initialize OpenTelemetry — tracing and metrics mutate global state, which the embedding process should own. The factory still wires the Temporal OTel interceptor internally when `OTEL_EXPORTER_OTLP_ENDPOINT` is set, but you must initialize the tracer/meter providers yourself if you want spans and metrics exported. The `stigmer-runner` CLI initializes OTel for you in static mode.

## Execution location vs transport

Two settings are easy to conflate but are deliberately independent:

- **`MODE` — execution location.** Where the agent runs and whose filesystem it sees. `local` allows local-path workspaces on the host filesystem; `cloud` runs in a server-provisioned sandbox (git-only).
- **`STIGMER_PROXY_ENDPOINT` — transport.** How credentials and artifacts move. When set, the runner routes Cursor SDK traffic through the Stigmer proxy and pushes artifacts through it, instead of talking to providers and storage directly.

These are orthogonal. The **desktop runner** is the canonical case where they diverge: it executes **locally** (`MODE=local`, so local-path workspaces work) yet still routes Cursor traffic and artifact uploads **through the proxy**. Coupling the two — forcing "proxy implies cloud" — is exactly what previously broke local-path sessions, which is why the env path (`MODE`) and both library factories (`executionMode`) treat them separately.

> **Library factories — `executionMode`.** Both `createStigmerRunner` and `createStigmerRunnerManager` accept an optional `executionMode: "local" | "cloud"` that sets execution location independently of proxy transport. When omitted, the static `createStigmerRunner` derives it for backward compatibility (`proxy ⇒ cloud`, otherwise `local`); the manager defaults to `local`. Set `executionMode: "local"` together with `proxyEndpoint` to express the desktop case — local execution with proxy transport.

### Credential modes

The transport setting drives two credential modes:

- **Direct mode** (local / OSS): you provide `CURSOR_API_KEY` directly (for the Cursor harness); `STIGMER_TOKEN` is optional because a local Stigmer server has no auth. `STIGMER_PROXY_ENDPOINT` is unset.
- **Proxy mode** (cloud / managed runners): `STIGMER_PROXY_ENDPOINT` and `STIGMER_TOKEN` are required. You do not supply `CURSOR_API_KEY` — the proxy validates your token and injects the real Cursor key upstream. The runner sets `CURSOR_BACKEND_URL` / `CURSOR_API_BASE_URL` to the proxy endpoint automatically; these are runner-managed, not configuration you set.

## Required infrastructure

| Component | When | Purpose |
|-----------|------|---------|
| Temporal | Always | The runner is a Temporal Worker. It needs a reachable Temporal frontend and a namespace. You may set these explicitly (`TEMPORAL_SERVICE_ADDRESS`, `TEMPORAL_NAMESPACE`), but when a token is present the runner self-discovers them from the control plane at boot — see the env reference below. |
| Stigmer backend | Always | The control plane (`STIGMER_BACKEND_ENDPOINT`) for status updates, blueprints, and (local) artifact serving. |
| Stigmer proxy + token | Proxy/cloud only | The proxy (`STIGMER_PROXY_ENDPOINT`) brokers Cursor credentials and artifact storage; `STIGMER_TOKEN` authenticates to it. |

In local/direct mode, only Temporal and the Stigmer backend are required, and both default to localhost.

## The stale-build guard

The runner runs from compiled `dist/` output. A stale `dist/` — source changed but not rebuilt — silently runs old code, which has historically cost hours of debugging (structured-output failures, naming mismatches, env-resolution regressions).

To prevent this, `npm run build` writes `dist/.build-fingerprint`: a JSON file with a SHA-256 hash of all `src/**/*.ts` files (excluding `node_modules` and `__tests__`), plus a build timestamp and file count. At startup, `checkBuildFreshness()` recomputes the hash and compares it. On mismatch, the runner prints a clear error and exits with code `78`:

```
!!! STALE RUNNER BUILD — REFUSING TO START !!!
    dist/ was built at <timestamp> (hash <hash>)
    src/ has changed since (current hash <hash>)

    Run 'make build-runner' or 'make desktop-dev' to rebuild.
```

The check is skipped gracefully when the fingerprint file is absent — for example under `tsx` (`npm run start`), in CI, or on a first build — so it never blocks development workflows that run from source.

## Environment variable reference

All configuration is environment-driven. Names and defaults below are verified against `src/config.ts`, `src/shared/artifact-storage.ts`, `src/claimcheck/config.ts`, `src/otel.ts`, and the LLM/registry activities. "Applies to" indicates the run mode, execution location, or credential mode a variable is relevant to.

### Core configuration

| Variable | Applies to | Required | Default | Purpose |
|----------|-----------|----------|---------|---------|
| `STIGMER_RUNNER_MODE` | All | No | `static` | Selects the run mode. Set to `manager` for dynamic per-session/per-execution Workers; any other value (or unset) means static mode. |
| `MODE` | All | No | `local` | Execution location: `local` (host filesystem, local-path workspaces) or `cloud` (server-provisioned sandbox, git-only). Independent of `STIGMER_PROXY_ENDPOINT`. |
| `STIGMER_TASK_QUEUE` | Static mode | No | `stigmer_runner` | Temporal task queue the static Worker polls. (Legacy alias: `TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE`.) Unused in manager mode, where each Worker derives its own queue. |
| `TEMPORAL_SERVICE_ADDRESS` | All | No | _(discovered)_ | Address of the Temporal frontend. **Resolution order:** an explicit value always wins; otherwise, if `STIGMER_TOKEN` is set, the runner discovers it from the control plane at boot (`getRunnerBootstrapConfig`); otherwise it falls back to `localhost:7233`. Discovery failure aborts startup with an actionable error (no silent fallback). |
| `TEMPORAL_NAMESPACE` | All | No | `default` | Temporal namespace. |
| `STIGMER_BACKEND_ENDPOINT` | All | In cloud mode | `http://localhost:7234` (local) | Stigmer backend endpoint for status, blueprints, and local artifact serving. A bare `host:port` is normalized to `http://` (or `https://` for port `443`). |
| `STIGMER_TOKEN` | Cloud or proxy mode | Yes (cloud/proxy) | _(none)_ | Auth token for the Stigmer backend / proxy. Required when `MODE=cloud` or `STIGMER_PROXY_ENDPOINT` is set; optional in local/direct mode. |
| `CURSOR_API_KEY` | Direct mode | Yes (Cursor harness, direct) | _(empty)_ | Cursor API key for direct mode. In proxy mode it is not required — the proxy injects the real key; the runner falls back to `STIGMER_TOKEN` for the SDK transport credential. |
| `STIGMER_PROXY_ENDPOINT` | Proxy/cloud | No | _(none)_ | Stigmer proxy endpoint. When set, activates proxy transport: Cursor SDK traffic and artifact uploads are routed through the proxy. |
| `WORKSPACE_ROOT_DIR` | All | No | `~/.stigmer/workspaces/runner` (fallback) | Root directory for agent workspaces. If unset, the runner warns and creates an isolated fallback directory — it never falls back to the process working directory. |
| `TEMPORAL_MAX_CONCURRENCY` | All | No | `5` | Maximum concurrent Temporal activity executions (per session Worker in manager mode). |
| `STIGMER_CHECKPOINTER_TYPE` | All | No | `memory` (local), `http` (cloud) | LangGraph checkpointer backend for agent state: `memory` or `http`. |
| `STIGMER_CHECKPOINTER_PROXY_ENDPOINT` | `http` checkpointer | No | value of `STIGMER_PROXY_ENDPOINT` | Endpoint for the HTTP checkpointer; falls back to the proxy endpoint. |
| `STIGMER_PRIMARY_MODEL` | All | No | `gpt-4.1` | Default LLM model identifier. |
| `STIGMER_CURSOR_CLOUD_MODE_ENABLED` | All | No | `false` | When `true`, enables Cursor cloud (workspace-less) execution mode for the Cursor harness. |
| `STIGMER_IDLE_TIMEOUT_SECONDS` | All | No | _(none)_ | **Reserved.** Parsed from the environment but not currently honored by the runtime — no component reads it today. Documented for completeness; setting it has no effect. |

### Artifact storage

| Variable | Applies to | Required | Default | Purpose |
|----------|-----------|----------|---------|---------|
| `ARTIFACT_STORAGE_TYPE` | All | No | `proxy` if `STIGMER_PROXY_ENDPOINT` is set, else `local` | Selects the artifact backend: `local` (filesystem, served by the Stigmer backend) or `proxy` (presigned URLs via the proxy). An explicit value always wins. Storage follows transport, not execution location. |
| `LOCAL_ARTIFACT_PATH` | Local storage | No | `/var/stigmer/artifacts` | Filesystem path for the local artifact backend. |
| `LOCAL_ARTIFACT_SERVE_URL` | Local storage | No | `http://localhost:7235` | Base URL the local backend uses to construct artifact download URLs. |

### Claim-check (large Temporal payloads)

The claim-check codec offloads oversized Temporal payloads to artifact storage and passes a reference instead.

| Variable | Applies to | Required | Default | Purpose |
|----------|-----------|----------|---------|---------|
| `CLAIMCHECK_ENABLED` | All | No | `false` | Enables the claim-check payload codec. When disabled, payloads pass through unchanged. |
| `CLAIMCHECK_THRESHOLD_BYTES` | Claim-check | No | `131072` (128 KB) | Payload size at or above which the codec offloads to artifact storage. |
| `CLAIMCHECK_COMPRESSION_ENABLED` | Claim-check | No | `true` | Compresses offloaded payloads. Only the literal value `false` disables it. |
| `CLAIMCHECK_KEY_PREFIX` | Claim-check | No | `claimcheck/` | Key prefix for offloaded payloads in artifact storage. |

### Credentials and providers

| Variable | Applies to | Required | Default | Purpose |
|----------|-----------|----------|---------|---------|
| `OPENAI_API_KEY` | Direct mode (native/OpenAI) | When using OpenAI directly | _(empty)_ | OpenAI API key for the native harness in direct mode. Not needed in proxy mode. |
| `ANTHROPIC_API_KEY` | Direct mode (native/Anthropic) | When using Anthropic directly | _(empty)_ | Anthropic API key for the native harness in direct mode. Not needed in proxy mode. |
| `STIGMER_LLM_REQUEST_TIMEOUT_MS` | Native harness | No | `0` (no timeout) | Per-request timeout for native LLM calls, in milliseconds. `0` or unset means no explicit timeout. |
| `STIGMER_CLOUD_API_URL` | All | No | `https://api.stigmer.ai` | Base URL for the Stigmer cloud API used to fetch model pricing and the model registry. |
| `STIGMER_AUTH_TOKEN` | Pricing/registry fetch | No | value of `STIGMER_TOKEN` | Fallback bearer token for model-pricing and model-registry requests when `STIGMER_TOKEN` is not set. |
| `GITHUB_TOKEN` | Deep-agent git writeback | When writing back to GitHub | _(none)_ | Token used by the deep-agent harness for git writeback operations. |

### Observability

| Variable | Applies to | Required | Default | Purpose |
|----------|-----------|----------|---------|---------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | All | No | _(none)_ | OTLP/gRPC endpoint for traces and metrics. When unset, OpenTelemetry is disabled with zero overhead. See [the embedder note](#a-note-for-embedders-opentelemetry) on who initializes OTel. |

### Advanced and debug

These tune internal behavior or support testing. Most operators never set them.

| Variable | Default | Purpose |
|----------|---------|---------|
| `STREAMING_MIN_INTERVAL_MS` | `500` | Minimum time between streaming status updates (rate limit). |
| `STREAMING_MAX_INTERVAL_MS` | `5000` | Maximum time before a forced keepalive status update. Clamped up to the min if set lower. |
| `STREAMING_BURST_THRESHOLD` | `50` | Event count that triggers an immediate status update (burst protection). |
| `LANGGRAPH_STREAM_EVENTS_VERSION` | `v3` | Selects the LangGraph streaming events version; `v2` opts into the older path. |
| `SKIP_MCP_CONNECT_BACKFILL` | `false` | When `true`, skips MCP Connect backfill. |
| `STIGMER_MCP_PUBLIC_ENDPOINT` | _(none)_ | Public endpoint injected as `STIGMER_SERVER_ADDRESS` into MCP server environments that request it. |
| `CURSOR_EVENT_RECORD_DIR` | _(none)_ | Directory to record Cursor harness events (debugging/fixtures). |
| `V2_EVENT_RECORD_DIR` | _(none)_ | Directory to record deep-agent v2 streaming events. |
| `V3_EVENT_RECORD_DIR` | _(none)_ | Directory to record deep-agent v3 streaming events. |
| `RECORD_FIXTURES` | `0` | When `1`, records HTTP fixtures for replay-based tests. |

## Related documentation

- **[Manager-mode IPC protocol](https://stigmer.ai/docs/guides/runners/ipc-protocol)** — the line-delimited JSON command/response contract and its versioned handshake (current protocol version `1`). A short pointer also lives at [`docs/ipc-protocol.md`](docs/ipc-protocol.md); the code definition is [`src/ipc-protocol.ts`](src/ipc-protocol.ts).
- **[Embedding integration guide](https://stigmer.ai/docs/guides/runners/embedding)** — building a desktop client (local execution) and a web client (cloud execution), including the per-audience configuration each one passes.
- **SDK `RunnerAdapter` and `executionTarget`** — the local-execution surfaces in `@stigmer/react` and `@stigmer/sdk`. The [embedding guide](https://stigmer.ai/docs/guides/runners/embedding) covers them today; a dedicated SDK reference is forthcoming.
- **Public API** — `src/index.ts` exports `createStigmerRunner` and `createStigmerRunnerManager` with typed options and inline examples.
