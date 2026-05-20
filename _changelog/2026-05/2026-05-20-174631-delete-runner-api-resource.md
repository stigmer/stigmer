# Delete Runner API Resource from OSS Repo

**Date**: May 20, 2026

## Summary

Completely removed the Runner API resource from the Stigmer OSS repository — 6 proto definitions, all generated stubs across 4 languages, the Go server controller package, TS heartbeat client, SDK clients, React hooks/UI, CLI commands, desktop app pages, and workflow-runner heartbeat. 463 files changed, 70,356 lines deleted. The Runner concept no longer exists in the OSS codebase.

## Problem Statement

The Runner API resource was critically overengineered — a full CRUD API with bidi command stream, 6-phase lifecycle state machine, heartbeat protocol, launch tokens, and `stigmer://` deep links — all duplicating what Temporal provides natively. This created a barrier for customer integration (nobody wants to manage a Runner just to execute an agent) and added unnecessary complexity to every part of the system.

### Pain Points

- Customers not integrating due to Runner management complexity
- 6-phase lifecycle (PENDING → STARTING → READY → BUSY → STOPPED → FAILED) that Temporal handles natively via worker liveness
- Bidi gRPC stream for heartbeats — Temporal already knows if a worker is alive
- Launch token handshake for browser-to-CLI flow — overbuilt for the use case
- Desktop users forced to understand "Runners" to use the app
- Runner-scoped task queues creating unnecessary coupling between sessions and infrastructure

## Solution

Clean deletion with no backward compatibility. The Runner API resource is entirely gone. Activity routing temporarily uses a hardcoded default queue (`agent_execution_runner`), which T04 will replace with per-session Temporal task queue routing.

## Implementation Details

Executed as 7 phased commits on a feature branch:

1. **Proto deletion**: 6 source files, cross-references cleaned in session/agentexecution/apiresourcekind protos, `RunnerUsageSummary` renamed to `StreamingUsageSummary`
2. **Go server**: `pkg/domain/runner/` deleted (19 production files + tests), deregistered from `server.go`
3. **Session/dispatch**: `resolve_runner.go` + `wait_for_runner_ready.go` deleted, dispatch simplified to hardcoded fallback queue, `RunnerID` removed from workflow input
4. **TS runner**: `heartbeat.ts` deleted, `runnerId` removed from config, heartbeat removed from boot sequence
5. **SDK/React/MCP**: React runner directory (17 files), MCP runner gen, usage type renames across session hooks
6. **CLI/workflow-runner**: Runner command package (18 files), daemon stream handling, embedded proto copies, heartbeat package
7. **Desktop**: Runner pages (6), hooks (7), deep link handler, Tauri IPC commands, sidecar process manager

## Benefits

- **Simpler mental model**: Sessions dispatch work to queues. No Runner entity to create, register, heartbeat, or manage.
- **70,000 lines of dead code removed**: Reduces maintenance burden, test surface, and onboarding complexity.
- **Unblocks NPM package**: `createStigmerRunner()` factory can now be built on a clean foundation without Runner API coupling.
- **Desktop app simplified**: No more "Runners" page, no sidecar management, no launch tokens.
- **CLI simplified**: `stigmer up` starts the server directly — no Runner registration dance.

## Impact

- **OSS repo**: Runner concept fully removed. All builds pass (Go, TypeScript, proto lint).
- **Cloud repo (stigmer-cloud)**: Not yet affected — T05 handles the Java control plane deletion separately.
- **Existing users**: Breaking change. `stigmer up runner`, `stigmer list runners`, `stigmer down runner` no longer exist. Desktop `/runners` page is gone.
- **SDK consumers**: `runner` exports removed from `@stigmer/react`. `useNewSessionFlow` no longer has runner selection.

## Related Work

- Research report: `_projects/2026-05/20260518.01.unified-runner-migration/research.control-plane-runner-architecture-review/04.report.gemini.md`
- T01 audit: `_projects/2026-05/20260520.01.runner-architecture-simplification/tasks/T01_inventory-and-impact-audit.md`
- Next: T03 (`createStigmerRunner()` factory), T04 (per-session task queue routing), T05 (Java control plane)

---

**Status**: ✅ Production Ready (on feature branch)
**Timeline**: Single session (~1 hour execution)
