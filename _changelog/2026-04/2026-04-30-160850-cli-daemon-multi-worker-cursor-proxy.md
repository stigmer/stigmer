# T05: CLI Daemon Multi-Worker Management + Cursor Proxy Architecture

**Date**: April 30, 2026

## Summary

Added cursor-runner as an optional second managed worker in both the CLI daemon (`stigmer up server`) and the standalone runner path (`stigmer up` / `stigmer up runner`). Resolved the critical proxy architecture question: `global.fetch` interception enables credential-free runners in cloud mode, maintaining full architectural parity with the LLM proxy pattern.

## Problem Statement

Stigmer's cursor harness (T03) created a TypeScript Temporal activity worker, and T04 wired the Go/Java workflow dispatch. But no CLI integration existed -- `stigmer up` only started the Python agent-runner. Two gaps needed resolution:

### Pain Points

- No way to start cursor-runner alongside agent-runner from the CLI
- No Node.js runtime management for TypeScript services
- Cursor SDK has no `baseURL` parameter, initially appearing to break the credential-free runner architecture
- Cloud-mode runners must only need `STIGMER_TOKEN` -- holding `CURSOR_API_KEY` directly would be an architectural regression

## Solution

### Multi-Worker Management

Extended both CLI runner paths (daemon and standalone) to optionally start cursor-runner alongside the Python agent-runner on the same Temporal task queue. Created a shared Node.js bootstrap package (`nodert`) and an embedded source locator package (`embedded/cursorrunner`) mirroring the existing Python agent-runner patterns.

### Cursor Proxy Architecture (Critical Finding)

Discovered that while the Cursor SDK has no `baseURL` parameter, proxy routing IS feasible via `global.fetch` interception -- the JavaScript-level equivalent of LangChain's `base_url`. The SDK uses `fetch()` internally (Node.js 20+), and Cursor explicitly documents enterprise proxy support with automatic SSE fallback.

## Implementation Details

### Fetch Interceptor (`src/proxy/fetch-interceptor.ts`)

Intercepts `global.fetch` before the Cursor SDK loads. For Cursor-bound requests (`*.cursor.sh`, `*.cursor.com`):
- Rewrites URL to route through `STIGMER_PROXY_ENDPOINT/v1/proxy/cursor/{host}/{path}`
- Replaces auth header with `STIGMER_TOKEN`

The interceptor is installed in `main.ts` before the dynamic import of `worker.ts` (which transitively imports `@cursor/sdk`), ensuring the SDK captures the intercepted fetch reference.

### Two Credential Modes (`config.ts`)

- **Direct mode** (local/OSS): `CURSOR_API_KEY` from user, no proxy
- **Proxy mode** (cloud): `STIGMER_PROXY_ENDPOINT` + `STIGMER_TOKEN`, no `CURSOR_API_KEY` needed

### CLI Integration

- `embedded/cursorrunner/` package: `SourceFS()`, `SourceDir()`, dev-mode repo walk-up, embed placeholder for T09
- `nodert/bootstrap.go`: `EnsureNodeAvailable()` (node >= 20), `EnsureDepsInstalled()` (npm install with staleness marker), `TsxArgs()` (tsx from node_modules)
- Daemon path (`daemon_process.go`): cursor-runner as optional managed component in `buildComponents`, PID/log/orphan cleanup
- Standalone path (`runner/start.go`): `startNativeRunner` starts both workers, SIGTERM propagation to both

### Optionality

Cursor harness is fully optional:
- **Local**: starts when `CURSOR_API_KEY` set AND Node.js >= 20 available
- **Cloud**: starts when `STIGMER_PROXY_ENDPOINT` set
- Non-fatal: bootstrap failures log a warning, agent-runner continues normally

## Benefits

- `stigmer up server` and `stigmer up runner` now support both harnesses
- Cloud runners remain credential-free (only `STIGMER_TOKEN`)
- Architecturally identical to the LLM proxy pattern
- Zero impact on users who don't use the Cursor harness

## Impact

- **CLI users**: Can run Cursor harness sessions from local dev environment
- **Platform operators**: Cloud deployment follows same proxy pattern as LLM providers
- **Architecture**: Credential-free runner property preserved for all harnesses

## Related Work

- [T03: Cursor Runner TypeScript Service](2026-04-30-144627-cursor-runner-typescript-service.md)
- [T04: Workflow Harness Dispatch](2026-04-30-152442-workflow-harness-dispatch.md)
- [T01: Proto Foundation](2026-04-30-130933-cursor-harness-proto-foundation.md)
- Separate task needed: `CursorProxyController` in stigmer-cloud (reverse proxy, same pattern as `LlmProxyController`)

---

**Status**: Production Ready (local mode). Cloud proxy controller is a separate task.
**Timeline**: Single session
