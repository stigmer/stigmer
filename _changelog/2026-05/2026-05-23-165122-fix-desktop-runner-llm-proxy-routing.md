# Fix Desktop Runner LLM Proxy Routing for Cloud-Edition Servers

**Date**: May 23, 2026

## Summary

Fixed the desktop app's embedded runner to route LLM calls through the Stigmer proxy when connected to a cloud-edition server, eliminating the need for a direct `ANTHROPIC_API_KEY` in the shell environment. The server's self-reported deployment mode (via `getServerInfo()` RPC) is now the source of truth for proxy activation — not URL heuristics.

## Problem Statement

When running `make desktop-dev` connected to a locally-running cloud-edition Java service, agent executions failed with:

```
[ExecuteDeepAgent] Failed for execution ...: [Error] Anthropic API key not found
```

The error originated from `@langchain/anthropic`'s `ChatAnthropic` constructor, which requires either a direct API key or a proxy-routed base URL.

### Pain Points

- Desktop runner never passed `STIGMER_PROXY_ENDPOINT` to the spawned Node.js process, even when the server was cloud-edition
- The entire proxy plumbing existed end-to-end (Rust spawn layer, runner config, LLM model construction, proxy routing utilities) but the desktop frontend never triggered it
- Users had to export `ANTHROPIC_API_KEY` in their shell before launching the desktop app — defeating the purpose of the cloud proxy architecture

## Solution

Thread the server-reported deployment mode from `App.tsx` through the `EmbeddedRunnerProvider` to the runner config. When the server reports cloud edition, derive the proxy endpoint from the API URL (same Java service hosts both gRPC and the `LlmProxyController`). The runner then activates proxy mode via `STIGMER_PROXY_ENDPOINT`, routing LLM calls through `{endpoint}/v1/proxy/llm/{provider}` with the user's auth token as Bearer authorization.

Critical design constraint: `MODE` is intentionally NOT set to `"cloud"`. The runner stays in local mode for workspace provisioning, attachment injection, and checkpointer behavior — only LLM routing changes.

## Implementation Details

- `EmbeddedRunnerContext.tsx`: Added `proxyEndpoint` prop to `EmbeddedRunnerProvider`
- `useEmbeddedRunner.ts`: Added `UseEmbeddedRunnerOptions` interface with optional `proxyEndpoint`; uses a `useRef` pattern so the lazily-called `ensureRunning()` always reads the latest value without stale closures; `getRunnerConfig()` now includes the proxy endpoint in the IPC config
- `App.tsx`: Derives `runnerProxyEndpoint = deploymentMode === "cloud" ? BASE_URL : undefined` and passes to the provider
- No changes to `runner.rs` (already forwards `STIGMER_PROXY_ENDPOINT`), `config.ts`, or `setup.ts`

## Benefits

- Cloud-connected desktop dev works without `ANTHROPIC_API_KEY` in the environment
- Server is the source of truth for mode detection — works identically whether the cloud service runs at `localhost:9090` or `api.stigmer.ai`
- No MODE override means workspace provisioning, memory checkpointer, and local artifact storage all remain functional for desktop
- Ref pattern handles async deployment mode resolution gracefully

## Impact

- **Desktop app developers** connecting to cloud-edition services no longer need to manage provider API keys locally
- **LLM proxy billing** — requests now flow through the proxy's attribution pipeline (Bearer token → org → billing)
- **Zero backend changes** — the fix is entirely in the desktop frontend's runner config wiring

## Related Work

- `2026-05-23-160521-fix-desktop-dev-runner-build-and-sidecar-cleanup.md` — prerequisite fix that established the current runner build + symlink pipeline
- `2026-05-23-145540-fix-workflow-agent-call-env-forwarding-and-idempotency.md` — related runner env forwarding fixes

---

**Status**: ✅ Production Ready
**Timeline**: 1 session
