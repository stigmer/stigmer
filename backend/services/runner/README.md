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

Requires a Node.js whose built-in `node:sqlite` is available unflagged — `>= 22.13` in the 22.x line, and `>= 23.4` after that (23.0–23.3 lack it). The durable local checkpointer depends on it, and the runner probes for it at boot (`src/preflight.ts`), refusing to start with an actionable error rather than crashing on the import.

### The slim embedding artifact

The plain `dist/` resolves its dependencies from `node_modules` at runtime — ~508 MB unpacked, which is unshippable inside a desktop app ([#170](https://github.com/stigmer/stigmer/issues/170)). For embedding, build the **slim artifact**:

```bash
make build-runner-slim          # or: npm run build:slim
```

This produces `dist-slim/`: a tree-shaken esbuild bundle of the whole runner (`main.js`), a build-time-prebuilt Temporal workflow bundle, and a staged `node_modules` containing only the packages that genuinely cannot be bundled (the platform-pruned Temporal native bridge, `@cursor/sdk` and its native binaries, `jq-wasm`) — **~85 MB per platform**. `node dist-slim/main.js` accepts the same modes, environment variables, and IPC protocol as `dist/main.js`. See `scripts/bundle-slim.mjs` for the full layout, `scripts/verify-slim-artifact.mjs` for the boot verification that gates releases, and the [embedding guide](https://stigmer.ai/docs/guides/runners/embedding) for how apps stage it.

> **Why the slim bundle is CommonJS, not ESM.** The runner's auth correctness depends on a deliberate module **load order**: it installs the fetch + HTTP/2 interceptors first, then lazily loads `@cursor/sdk` and `@connectrpc/connect-node` (via dynamic `import()`) so the interceptors are in place before those packages capture `globalThis.fetch` / snapshot the `node:http2` ESM facade. An **ESM** esbuild bundle destroys this — it hoists every external `import` to the top of the output and evaluates them before any code runs, freezing the `node:http2` facade and capturing the original `fetch` before install, which silently breaks proxy auth on the authenticated path (this was the regression in [#170](https://github.com/stigmer/stigmer/issues/170)). A **CJS** bundle preserves the source's lazy evaluation order, so the dynamic-import boundary keeps both interceptors correct. The meta `package.json` deliberately omits `"type": "module"` so `node main.js` runs as CommonJS — do **not** add it back, and do not flip `format` to `"esm"` in `bundle-slim.mjs`. The boot guard `assertHttp2ConnectPatched()` plus the authenticated check in `verify-slim-artifact.mjs` fail loudly if this is ever reverted.

The slim build is also published to npm as `@stigmer/runner-slim` (with per-platform `@stigmer/runner-slim-<platform>` support packages) alongside the full `@stigmer/runner` package on every release.

## Run modes

The runner has three **run modes**, selected at boot by two environment variables (`src/main.ts`): `STIGMER_RUNNER_MODE=manager` selects manager mode; otherwise a set `STIGMER_POOL_MEMBER_ID` selects pool mode; otherwise the runner is static. Do not confuse the run mode (process topology) with the execution location (`MODE=local|cloud`) or the transport (`STIGMER_PROXY_ENDPOINT`) — those are independent axes covered in [Execution location vs transport](#execution-location-vs-transport).

| Run mode | Selector | Topology | Used by |
|----------|----------|----------|---------|
| Static | Neither of the two below (default) | One Worker polling one task queue; blocks until shutdown | CLI daemon, cloud deployments |
| Manager | `STIGMER_RUNNER_MODE=manager` | Shared Temporal connection; dynamic per-session / per-execution Workers; stdin/stdout JSON IPC | Desktop app |
| Pool | `STIGMER_POOL_MEMBER_ID` set, and `STIGMER_RUNNER_MODE` not `manager` | A warm-pool sandbox: boots the runner manager, then serves what its injected credential says — a blank member polls its `sandbox:{memberId}` control queue for a claim, a claimed member that restarted goes straight to its session's queue (`src/pool-member.ts`) | Hosted cloud sandboxes |

### Static mode

Static mode creates a single Temporal Worker that polls one task queue and runs until it receives `SIGTERM` / `SIGINT`. This is the right mode when the set of work is fixed at startup (a daemon or a pod dedicated to a queue).

On a signal it drains the worker, releases the harnesses, closes its Temporal connection and flushes telemetry, and the process then exits on its own, normally within milliseconds. As the CLI entry (`stigmer-runner`, and the cloud's pool members, which end the same way), a process still alive 5 s after that is made to exit, with one log line naming the resources that kept it alive (`src/exit-backstop.ts`). That line means a leaked handle to fix, not a slow shutdown to tune.

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

### The attach entry (a sandbox that waits to be attached)

`dist/attach/main.js` is a second entry, for sandbox platforms that snapshot a started sandbox once and start every later sandbox from that snapshot (Agent Substrate's golden snapshot). It is not a run mode of the runner: it starts a small waiter (`src/attach/waiter.ts`) that loads none of the runner's machinery (Node built-ins, the runner's secret-name list and claim reader, and the codecs' `connection` subpath: 13 modules, pinned by `src/attach/__tests__/import-graph.test.ts` and `scripts/verify-attach-boot.mjs`), answers `GET /readyz`, and waits for one `POST /attach` carrying the task queue to serve and the runner's secrets. The first accepted push starts the runner, `dist/main.js` in static mode, with the sandbox's environment plus that queue and those secrets, exactly the environment a sandbox pod gives it at start; the waiter then supervises it as a restart policy would. A later push for the same queue (a driver pushes on every wakeup) may only rotate `STIGMER_TOKEN`, for a token of the same `token_type` and, when the first named a session, the same session; every other secret must be the first push's. A push that arrives while a crashed runner waits out its restart delay starts it at once. A restart uses the latest pushed token, not the one the live runner renewed, so a composition whose tokens are renewed also pushes the renewed token while the sandbox runs. Every refusal answers `{"error", "code"}`, and the code is stable (`PushRefusalCode` in `src/attach/push.ts`): `secrets_changed`, for one, tells a driver that the runner must start fresh to take new secrets. A snapshot therefore never holds a runner or a credential. It must not: every clone of one snapshot shares the snapshotted process's random state, so a runner in the snapshot would give unrelated sessions the same keys and identifiers (the waiter's header has the measurement).

A push is accepted only for the queue whose sandbox name (`sbx-<code>-<12 hex>`, the server's own derivation) is this sandbox's, may set only the runner's secret variables, and must carry an unexpired JWT or no token (`src/attach/push.ts`). Who can reach the waiter is the driver's to restrict: on Agent Substrate, its router reaches every actor, so no actor's egress policy may reach the router. The sandbox's own processes reach it over loopback too, which is why a later push can change nothing but the token. The first accepted push is not authenticated and fixes the sandbox's queue and secrets for its life: a sandbox whose first push did not come from its driver cannot be repaired, only replaced. Non-secret connection settings (the Temporal server's CA, a client certificate, the server name) belong in the sandbox's own environment, not in a push. The waiter holds port 80 by default; an agent's own servers inside the sandbox use other ports.

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

- **Direct mode** (local / OSS): you provide `CURSOR_API_KEY` directly (for the Cursor harness); `STIGMER_TOKEN` is optional against a trusted-local server, which verifies no credential, and is the runner's own API key against a self-hosted server with sign-in on (the run's per-run credential arrives with each dispatch; see `src/shared/run-credential.ts`). `STIGMER_PROXY_ENDPOINT` is unset.
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

All configuration is environment-driven. Every variable the runner's source reads is named here, except the few `src/__tests__/readme-environment.test.ts` lists as deliberate exceptions, each with its reason (the operating system's home directory, a backend value not yet supported); the test fails when any other name appears nowhere in this file, so a new setting cannot land undocumented. That its row says the right thing is read in review. Defaults are checked by hand against the module each row cites or that reads the variable. "Applies to" indicates the run mode, execution location, or credential mode a variable is relevant to.

### Core configuration

| Variable | Applies to | Required | Default | Purpose |
|----------|-----------|----------|---------|---------|
| `STIGMER_RUNNER_MODE` | All | No | `static` | Selects the run mode. Set to `manager` for dynamic per-session/per-execution Workers; any other value (or unset) means static mode, or pool mode when `STIGMER_POOL_MEMBER_ID` is set. |
| `STIGMER_POOL_MEMBER_ID` | Hosted sandboxes | No | _(none)_ | Selects pool mode (see [Run modes](#run-modes)): the sandbox's identity in the warm pool. Set by the hosted edition's sandbox provisioning; a self-hosted runner never sets it. |
| `STIGMER_ATTACH_PORT` | The attach entry | No | `80` | Port the attach waiter listens on (`src/attach/entry.ts`), 80 being the port a Substrate router reaches without a `CONNECT` tunnel. Not passed to the runner. |
| `STIGMER_SANDBOX_NAME_FILE` | The attach entry | No | `/run/ate/actor-name` | File holding this sandbox's name, read on every push because each clone of a snapshot has its own (a Substrate template projects it with an actor-metadata volume). A push for a queue whose sandbox name differs is refused. Not passed to the runner. |
| `MODE` | All | No | `local` | Execution location: `local` (host filesystem, local-path workspaces) or `cloud` (server-provisioned sandbox, git-only). Independent of `STIGMER_PROXY_ENDPOINT`. Also the default for the two guards below. |
| `STIGMER_WEB_FETCH_ALLOW_PRIVATE` | All (native `web_fetch`) | No | follows `MODE`: strict in `cloud`, relaxed in `local` | The `web_fetch` address guard's override. `true` lets the agent fetch loopback and private-network addresses on any runner (link-local, which holds the cloud metadata endpoint, stays refused); `false` refuses them on a local runner too. For embedders whose execution location and network differ; managed cloud deployments never set it. See `src/tools/url-guard.ts`. |
| `STIGMER_MCP_ALLOW_STDIO` | All | No | follows `MODE`: forbidden in `cloud`, allowed in `local` | The MCP transport guard's override. `true` lets a cloud runner start stdio MCP servers, which download a package and run it as a subprocess holding the execution's secrets; `false` forbids them on a local runner too. For rolling the policy back without a redeploy; managed cloud deployments never set it. See `src/shared/mcp-transport-guard.ts`. |
| `STIGMER_TASK_QUEUE` | Static mode | No | `stigmer_runner` | Temporal task queue the static Worker polls. (Legacy alias: `TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE`.) Unused in manager mode, where each Worker derives its own queue. |
| `TEMPORAL_SERVICE_ADDRESS` | All | No | _(discovered)_ | Address of the Temporal frontend. **Resolution order:** an explicit value always wins; otherwise, if `STIGMER_TOKEN` is set, the runner discovers it from the control plane at boot (`getRunnerBootstrapConfig`); otherwise it falls back to `localhost:7233`. Discovery failure aborts startup with an actionable error (no silent fallback). |
| `TEMPORAL_NAMESPACE` | All | No | `default` | Temporal namespace. |
| `STIGMER_TEMPORAL_API_KEY` | All | No | — | Temporal frontend API key (Temporal Cloud, or a frontend with an authorizer); implies TLS. Taken into the credential store at boot, so agent tools never see it. |
| `STIGMER_TEMPORAL_TLS` | All | No | — | `true` or `1`: TLS to the frontend against the system's trusted roots. A CA, a client certificate or an API key implies it. |
| `STIGMER_TEMPORAL_TLS_SERVER_NAME` | All | No | — | Host-name (SNI) override for the frontend's certificate. |
| `STIGMER_TEMPORAL_TLS_SERVER_CA_CERT_DATA` / `_PATH` | All | No | — | The frontend's CA, as PEM text or a file path (one form, not both). |
| `STIGMER_TEMPORAL_TLS_CLIENT_CERT_DATA` / `_PATH`, `STIGMER_TEMPORAL_TLS_CLIENT_KEY_DATA` / `_PATH` | All | No | — | Mutual TLS: the client certificate and its key, both or neither (half a pair stops the boot). The key's `_DATA` form is taken into the credential store; a `_PATH` key is a file the agent's tools can read, so prefer `_DATA`. These are Stigmer's own names: Temporal's `TEMPORAL_API_KEY` and `TEMPORAL_TLS_*` belong to the user's own Temporal work and are never read. |
| `STIGMER_BACKEND_ENDPOINT` | All | In cloud mode | `http://localhost:7234` (local) | Stigmer backend endpoint for status, blueprints, and local artifact serving. A bare `host:port` is normalized to `http://` (or `https://` for port `443`). |
| `STIGMER_TOKEN` | Cloud or proxy mode | Yes (cloud/proxy) | _(none)_ | Auth token for the Stigmer backend / proxy. Required when `MODE=cloud` or `STIGMER_PROXY_ENDPOINT` is set; optional in local/direct mode. |
| `CURSOR_API_KEY` | Direct mode | Yes (Cursor harness, direct) | _(empty)_ | Cursor API key for direct mode. In proxy mode it is not required — the proxy injects the real key, and the SDK transport presents the current `STIGMER_TOKEN` (read per turn, so a rotated token is honoured). |
| `STIGMER_PROXY_ENDPOINT` | Proxy/cloud | No | _(none)_ | Stigmer proxy endpoint. When set, activates proxy transport: Cursor SDK traffic and artifact uploads are routed through the proxy. |
| `WORKSPACE_ROOT_DIR` | All | No | `~/.stigmer/workspaces/runner` (fallback) | Root directory for agent workspaces. If unset, the runner warns and creates an isolated fallback directory — it never falls back to the process working directory. |
| `TEMPORAL_MAX_CONCURRENCY` | All | No | `5` | Maximum concurrent Temporal activity executions (per session Worker in manager mode). |
| `STIGMER_CHECKPOINTER_TYPE` | All | No | `sqlite` (local), `http` (cloud) | LangGraph checkpointer backend for the native harness's agent state: `sqlite` (a durable per-session file under the platform dir, so a paused or interrupted run resumes across invocations), `http` (the proxy-backed saver), or `memory` (ephemeral; test runs only — a paused run cannot resume on it). |
| `STIGMER_CHECKPOINTER_PROXY_ENDPOINT` | `http` checkpointer | No | value of `STIGMER_PROXY_ENDPOINT` | Endpoint for the HTTP checkpointer; falls back to the proxy endpoint. |
| `STIGMER_PRIMARY_MODEL` | All | No | `gpt-4.1` | Default LLM model identifier. |
| `STIGMER_CURSOR_CLOUD_MODE_ENABLED` | All | No | `false` | When `true`, enables Cursor cloud (workspace-less) execution mode for the Cursor harness. |
| `STIGMER_IDLE_TIMEOUT_SECONDS` | All | No | _(none)_ | **Reserved.** Parsed from the environment but not currently honored by the runtime — no component reads it today. Documented for completeness; setting it has no effect. |

### Artifact storage

| Variable | Applies to | Required | Default | Purpose |
|----------|-----------|----------|---------|---------|
| `ARTIFACT_STORAGE_TYPE` | All | No | `proxy` if `STIGMER_ARTIFACT_PROXY_ENDPOINT` or `STIGMER_PROXY_ENDPOINT` is set, else `local` | Selects the artifact backend: `local` (filesystem, served by the Stigmer backend), `proxy` (presigned URLs via the proxy), or `none` (storage deliberately disabled: artifact features are refused rather than stored). An explicit value always wins. Storage follows transport, not execution location (`src/shared/artifact-storage.ts`). |
| `STIGMER_ARTIFACT_PROXY_ENDPOINT` | Proxy storage | No | value of `STIGMER_PROXY_ENDPOINT` | Endpoint the proxy artifact store presigns against, when artifact traffic must reach a different host than LLM traffic (the checkpointer-override pattern). |
| `LOCAL_ARTIFACT_PATH` | Local storage | No | `~/.stigmer/data/artifacts` | Filesystem root of the local artifact store. **Must equal the stigmer-server's `ARTIFACT_LOCAL_BASE_PATH`** — in local mode the server writes an artifact to `<ARTIFACT_LOCAL_BASE_PATH>/<key>` and the runner reads it from `<LOCAL_ARTIFACT_PATH>/<key>`, so a mismatch makes every storage-key attachment and offload fail to resolve. The defaults align out of the box; the CLI local daemon sets both explicitly. |
| `LOCAL_ARTIFACT_SERVE_URL` | Local storage | No | `http://localhost:7235` | Base URL of the server's artifact HTTP file server (its `ARTIFACT_HTTP_PORT`, default `GRPC_PORT + 1`, or an ephemeral port the server's boot log names when `GRPC_PORT` is 0). Used for blob downloads; the runner's own read-back goes straight to disk. |

### Payload encryption (Temporal history at rest)

The encryption codec encrypts every Temporal payload the runner produces (AES-256-GCM), so decrypted execution-context secrets never rest in workflow history or the Temporal UI. Payloads the runner did not encrypt (orchestrator inputs, signals, pre-rollout histories) pass through untouched. A key without its id — or a malformed key — fails the boot rather than silently running plaintext.

Keys come from two sources with strict precedence: the env vars below (the operator's explicit choice — self-hosted deployments and cloud sandboxes), or, when the env is silent, server-managed per-identity keys delivered by `getRunnerBootstrapConfig` (desktop-class runners on cloud; held in memory only, re-fetched each boot). See `src/encryption/config.ts`.

| Variable | Applies to | Required | Default | Purpose |
|----------|-----------|----------|---------|---------|
| `STIGMER_PAYLOAD_ENCRYPTION_KEY` | All | No | _(unset — encryption off)_ | Base64-encoded 32-byte AES-256 key. Setting it enables the codec. |
| `STIGMER_PAYLOAD_ENCRYPTION_KEY_ID` | Payload encryption | With the key | _(none)_ | Identifier stamped on every encrypted payload so rotation can tell keys apart. Required when the key is set. |
| `STIGMER_PAYLOAD_ENCRYPTION_SECONDARY_KEY` | Payload encryption | No | _(unset)_ | Decrypt-only key accepted during rotation windows (payloads written under the previous key stay readable). |
| `STIGMER_PAYLOAD_ENCRYPTION_SECONDARY_KEY_ID` | Payload encryption | With the secondary key | _(none)_ | Key id of the secondary key. |

### Claim-check (large Temporal payloads)

The claim-check codec offloads oversized Temporal payloads to artifact storage and passes a reference instead. When payload encryption is enabled, encryption runs first, so offloaded blobs are ciphertext.

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
| `ANTHROPIC_BASE_URL` | Direct mode (native/Anthropic, `public` backend) | No | _(empty: api.anthropic.com)_ | The address of an LLM gateway in front of Anthropic (the API root, without `/v1`). A value that is not an http(s) URL stops the runner at startup; ignored, with a warning, under the proxy or a non-`public` backend. |
| `STIGMER_LLM_REQUEST_TIMEOUT_MS` | Native harness | No | `0` (no timeout) | Per-request timeout for native LLM calls, in milliseconds. `0` or unset means no explicit timeout. |
| `STIGMER_CLOUD_API_URL` | All | No | _(unset)_ | Explicit override for the origin serving `/v1/proxy/model-registry` (model resolution and pricing). When unset, fetches go to `STIGMER_PROXY_ENDPOINT` (proxy mode) or `STIGMER_BACKEND_ENDPOINT` (direct/local mode — the local stigmer-server serves the registry). |
| `STIGMER_AUTH_TOKEN` | Pricing/registry fetch | No | value of `STIGMER_TOKEN` | Fallback bearer token for model-pricing and model-registry requests when `STIGMER_TOKEN` is not set. |
| `GITHUB_TOKEN` | Deep-agent git writeback | When writing back to GitHub | _(none)_ | Token used by the deep-agent harness for git writeback operations. |
| `STIGMER_RUNNER_HITL_SECRET` | All | No | _(a random secret per process)_ | Master secret the per-execution approval fingerprint keys derive from (`src/shared/fingerprint-secret.ts`). Set it to keep a pending approval valid across runner restarts and replicas; without it a restart re-keys, so a pending approval is asked again (never silently accepted). Taken into the credential store at boot, so agent tools never see it. |

### Model backends

Where the native harness's models are served when the runner talks to providers directly. Under `STIGMER_PROXY_ENDPOINT` the proxy owns provider routing, and the runner warns that a non-`public` backend is ignored. The [model backends guide](https://stigmer.ai/docs/guides/runners/model-backends) is the one explanation of each backend, its credentials and its errors; the rows below index what the runner reads.

| Variable | Applies to | Required | Default | Purpose |
|----------|-----------|----------|---------|---------|
| `STIGMER_ANTHROPIC_BACKEND` | Anthropic models | No | `public` | Where Anthropic models are served: `public` (Anthropic's API), `vertex`, `bedrock` or `foundry`. An unknown value stops the runner at startup. |
| `CLOUD_ML_REGION` | `vertex` | Yes (vertex) | _(none)_ | The Vertex AI region, or `global`. Credentials come from Application Default Credentials. |
| `AWS_REGION` | `bedrock` | Yes (bedrock) | _(none)_ | The Bedrock region; the runner never assumes one. |
| `AWS_BEARER_TOKEN_BEDROCK` | `bedrock` | No | _(the AWS credential chain)_ | A Bedrock API key, instead of the AWS chain (environment keys, IAM role / IRSA). Taken into the credential store at boot. |
| `STIGMER_BEDROCK_INFERENCE_PREFIX` | `bedrock` | No | _(none)_ | The inference-profile geography (`us`, `eu`, `global`, …) for models Bedrock serves only through a profile. |
| `STIGMER_BEDROCK_MODEL_MAP` | `bedrock` | No | _(none)_ | Overrides, `canonical=bedrockId` pairs separated by commas; consulted before the built-in mapping. A malformed value stops the runner at startup. |
| `ANTHROPIC_FOUNDRY_RESOURCE` | `foundry` | One of the two | _(none)_ | The Microsoft Foundry resource name. |
| `ANTHROPIC_FOUNDRY_BASE_URL` | `foundry` | One of the two | _(none)_ | A full Foundry endpoint, instead of the resource name. |
| `ANTHROPIC_FOUNDRY_API_KEY` | `foundry` | No | _(a Microsoft Entra ID token)_ | A Foundry API key, instead of the runner's Azure identity. Taken into the credential store at boot. |
| `STIGMER_FOUNDRY_DEPLOYMENT_MAP` | `foundry` | No | _(none)_ | Custom deployment names, `canonical=deployment` pairs separated by commas. A malformed value stops the runner at startup. |

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
| `STIGMER_PROGRESS_CAPTURE_MIN_INTERVAL_MS` | `2000` | Minimum time between two mid-run captures of the "N files changed so far" strip. Each capture stages the working tree with git (git workspaces) or reads the touched files (other workspaces), so this bounds that cost however often status is written. Read once at startup; a non-numeric or negative value keeps the default, and `0` captures on every status write. |
| `CURSOR_STREAM_STALL_TIMEOUT_MS` | `180000` (3 min) | **Parsed but not yet honoured** ([#1731](https://github.com/stigmer/stigmer/issues/1731)): `loadConfig` reads it, but no boot path passes it to the runner, so the default always applies to `stigmer-runner`. The bound it names: how long an engine may report no activity before the run is cancelled and the execution fails with a stall error, for every harness (the name is the Cursor harness's, its first user). Embedders set it through the `cursorStreamStallTimeoutMs` option. |
| `CURSOR_AGENT_RESOLVE_TIMEOUT_MS` | `120000` (2 min) | **Parsed but not yet honoured**, as above; embedders use the `agentResolveTimeoutMs` option. The bound it names: the Cursor SDK's agent create or resume, which has no timeout of its own; on expiry the execution fails with a transport diagnosis instead of hanging until Temporal's heartbeat timeout. |
| `STIGMER_CURSOR_AGENT_CACHE_TTL_MS` | `1800000` (30 min) | How long an idle Cursor agent stays parked between turns, holding its MCP subprocesses, before it is closed. A non-positive or non-numeric value keeps the default. |
| `WORKSPACE_LOCK_TIMEOUT_MS` | `900000` (15 min) | **Parsed but not yet honoured**, as above; embedders use the `workspaceLockTimeoutMs` option. The bound it names: how long a turn waits for another session's lock on the same workspace before the execution fails with "workspace is in use by another session" (`src/shared/workspace/workspace-lock.ts`). |
| `STIGMER_MCP_BRIDGE_ENDPOINT` | _(none)_ | The MCP bridge the runner's own attachments (channel messaging, conversation participation) connect to, as `https://…`. Unset selects the local shape: a spawned `stigmer mcp-server` stdio child against the local backend. |
| `STIGMER_WORKFLOW_BUNDLE` | _(discovered)_ | An explicit path to the pre-built Temporal workflow bundle, for tests and for embedders that stage it elsewhere (`src/workflow-source.ts`). A path that does not exist stops the boot. |
| `SKIP_MCP_CONNECT_BACKFILL` | `false` | When `true`, skips MCP Connect backfill. |
| `STIGMER_MCP_PUBLIC_ENDPOINT` | _(none)_ | The server's public endpoint. A server that provisions this runner's sandbox sets it from its own configuration (`STIGMER_SANDBOX_MCP_PUBLIC_ENDPOINT`). Fills `STIGMER_SERVER_ADDRESS` (as `host:port`) for MCP servers that declare it and carry no value; without it, only stdio servers are filled, from `STIGMER_BACKEND_ENDPOINT`. A value already present is never overridden. |
| `CURSOR_EVENT_RECORD_DIR` | _(none)_ | Directory to record Cursor harness events (debugging/fixtures). |
| `V3_EVENT_RECORD_DIR` | _(none)_ | Directory to record deep-agent harness events (debugging/fixtures). |
| `RECORD_FIXTURES` | `0` | When `1`, records HTTP fixtures for replay-based tests. |

## Related documentation

- **[Manager-mode IPC protocol](https://stigmer.ai/docs/guides/runners/ipc-protocol)** — the line-delimited JSON command/response contract and its versioned handshake (current protocol version `1`). A short pointer also lives at [`docs/ipc-protocol.md`](docs/ipc-protocol.md); the code definition is [`src/ipc-protocol.ts`](src/ipc-protocol.ts).
- **[Embedding integration guide](https://stigmer.ai/docs/guides/runners/embedding)** — building a desktop client (local execution) and a web client (cloud execution), including the per-audience configuration each one passes.
- **SDK `RunnerAdapter` and `executionTarget`** — the local-execution surfaces in `@stigmer/react` and `@stigmer/sdk`. The [embedding guide](https://stigmer.ai/docs/guides/runners/embedding) covers them today; a dedicated SDK reference is forthcoming.
- **Public API** — `src/index.ts` exports `createStigmerRunner` and `createStigmerRunnerManager` with typed options and inline examples.
- **[Adding a harness](src/harness/README.md)** — the turn runtime, the adapter contract, the contract kit, and the checklist of files inside and outside the runner a new harness touches.
