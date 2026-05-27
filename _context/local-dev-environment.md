# Context: Local Development Environment

I am testing the Stigmer desktop app locally. The setup spans two repos and several processes. Use this context to understand the running environment when I describe issues, ask for changes, or share logs.

---

## Repositories

| Repo | Path | Purpose |
|------|------|---------|
| **stigmer** (OSS) | `~/scm/github.com/stigmer/stigmer` | Desktop app (Tauri + Vite + React), TypeScript runner, CLI, SDKs |
| **stigmer-cloud** | `~/scm/github.com/stigmer/stigmer-cloud` | Java backend service (`stigmer-service`), built with Bazel |

---

## Architecture

```
Desktop App (Tauri + Vite)            Caddy (:9090)                Java Service
┌──────────────────────┐         ┌──────────────────────┐    ┌─────────────────────┐
│  React Frontend      │────────▶│  /v1/proxy/*  → :8081│───▶│  Tomcat REST :8081  │
│  (Vite HMR :5173)    │         │  gRPC-Web     → :9091│───▶│  gRPC server :8080  │
│                      │         │  native gRPC  → :8080│    │                     │
│  Embedded Runner     │         └──────────────────────┘    │  Temporal worker    │
│  (Node.js worker)    │                                     │  MongoDB, Redis,    │
└──────────────────────┘                                     │  OpenFGA, R2        │
                                                             └─────────────────────┘
```

---

## Component 1: Java Service (stigmer-cloud)

**What:** The `stigmer-service` Spring Boot application — the control plane.

**How to run:** `bazel run //backend/services/stigmer-service:stigmer_service_app` from the `stigmer-cloud` repo root.

**Configuration:** Reads `backend/services/stigmer-service/.env` (generated via `bazel run //backend/services/stigmer-service:dot_env_local`). Spring Boot loads it as a properties file:

```yaml
spring:
  config:
    import: optional:file:backend/services/stigmer-service/.env[.properties]
```

**Ports exposed:**

| Port | Protocol | Purpose |
|------|----------|---------|
| 8080 | gRPC (h2c) | Primary API — all resource CRUD, execution lifecycle, IAM |
| 8081 | HTTP (Tomcat) | REST endpoints — LLM proxy (`/v1/proxy/*`), Stripe webhooks |

**Infrastructure it connects to (all production-hosted):**

| Service | Host | Notes |
|---------|------|-------|
| MongoDB | `stigmer-prod-mongo-database.planton.live:27017` | Database: `stigmer` |
| Redis | `stigmer-prod-redis.planton.live:6379` | Session cache, pub/sub |
| Temporal | `stigmer-prod-temporal-frontend.planton.live:7233` | Workflow orchestration |
| OpenFGA | `stigmer-prod-fga.planton.live` | Fine-grained authorization |
| Auth0 | `stigmer-prod.us.auth0.com` | Authentication |
| Cloudflare R2 | `074755a78d8e8f77c119a90a125e8a06.r2.cloudflarestorage.com` | Object storage (payloads, artifacts, skills) |

**Key env vars set:** `ENV=local`, local Temporal task queues (`local_workflow_execution_stigmer`, `local_agent_execution_stigmer`, `local_stigmer_runner`), LLM proxy keys for OpenAI/Anthropic/Cursor, Stripe keys, encryption keys.

---

## Component 2: Desktop App (stigmer repo)

**What:** Tauri v2 desktop app with a React (Vite) frontend and an embedded TypeScript runner.

**How to run:** `make desktop-dev` from the `stigmer` repo root.

**What `make desktop-dev` does (in order):**

1. Kills existing desktop dev processes (Tauri, Vite, Caddy, grpcwebproxy)
2. Clears Vite dependency cache (`node_modules/.vite`)
3. `npm install` for the desktop workspace
4. Builds the TypeScript runner (`backend/services/runner` → `dist/`)
5. Sets up runner symlink: `src-tauri/resources/runner` → `../../../../backend/services/runner`
6. Starts **grpcwebproxy** on `:9091` (translates gRPC-Web → native gRPC on `:8080`)
7. Starts **Caddy** on `:9090` as a reverse proxy (see routing table below)
8. Runs `npm run tauri dev` (Tauri + Vite hot-reload on `:5173`)

**Caddy routing (`:9090`):**

| Match | Target | Transport |
|-------|--------|-----------|
| `/v1/proxy/*` | `localhost:8081` | HTTP |
| `Content-Type: application/grpc*` (not grpc-web) | `localhost:8080` | h2c (native gRPC) |
| Everything else (gRPC-Web, fallback) | `localhost:9091` | HTTP (grpcwebproxy) |

**Desktop `.env.development`:**

```
VITE_STIGMER_API_URL=http://localhost:9090
VITE_STIGMER_SIDECAR_ENDPOINT=localhost:9090
VITE_STIGMER_FORCE_AUTH=true
VITE_STIGMER_CONSOLE_URL=https://app.stigmer.ai
VITE_STIGMER_TEMPORAL_ADDRESS=stigmer-prod-temporal-frontend.planton.live:7233
```

Authentication uses Auth0 production (`VITE_STIGMER_FORCE_AUTH=true`).

---

## Component 3: Embedded Runner

The desktop app spawns a local **TypeScript runner** as a Node.js child process (`node resources/runner/dist/main.js`). This runner registers as a Temporal worker and picks up activities from local-prefixed task queues:

- `local_workflow_execution_stigmer`
- `local_agent_execution_stigmer`
- `local_stigmer_runner`

The runner connects to the same production Temporal cluster as the Java service. It receives workflow/agent execution tasks and executes them locally (LLM calls, MCP server orchestration, tool execution).

When code changes are made in `backend/services/runner/`, the next `make desktop-dev` rebuilds the runner automatically. If the Tauri app is restarted without `make desktop-dev`, the runner binary may be stale.

---

## Prerequisites

| Tool | Purpose | Install |
|------|---------|---------|
| Caddy | Local reverse proxy | `brew install caddy` |
| grpcwebproxy | gRPC-Web translation | Go binary, must be on `PATH` |
| Node.js 23+ | Runner, Vite, npm workspaces | `brew install node` |
| Rust toolchain | Tauri native shell | `rustup` |
| Bazel | Build stigmer-cloud Java service | `bazelisk` or `bazel` |

---

## Common Patterns

**Restarting just the desktop app** (no runner rebuild): Kill the Tauri process, then `npm run tauri dev -w desktop` from the repo root. The symlinked runner dist will be used as-is.

**Rebuilding just the runner**: `make build-runner` from the repo root, then restart Tauri.

**Full restart**: `make desktop-dev` (kills everything, rebuilds runner, restarts all proxies and Tauri).

**Viewing Java service logs**: The Java service runs in the terminal where `bazel run` was executed. Look for `[stigmer-service]` log prefix.

**Viewing runner logs**: Runner output appears in the Tauri dev console (stdout of the Node.js child process).
