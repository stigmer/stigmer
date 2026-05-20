# Next Task: 20260520.01.runner-architecture-simplification

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260520.01.runner-architecture-simplification

**Description**: Eliminate the overengineered Runner API resource (CRUD, bidi stream, 6-phase lifecycle, launch tokens) and replace it with a simple @stigmer/runner NPM package using per-session Temporal task queue routing. No backward compatibility — delete the Runner API entirely.
**Goal**: Single @stigmer/runner NPM package with a createStigmerRunner() factory function that uses per-session Temporal task queues. Runner API protos deleted. Control plane routes executions via session-derived task queues instead of runner IDs. Desktop app embeds the runner automatically. Cloud sandbox boots with session ID. Customers can npm install and integrate in minutes.
**Tech Stack**: TypeScript/Node.js, Temporal TypeScript SDK, Protobuf/gRPC (deletion), Java Spring Boot (stigmer-service control plane changes), Vitest
**Components**: apis/ai/stigmer/agentic/runner (DELETED), backend/services/runner (refactored), stigmer-cloud/stigmer-service Runner controllers and DB (DELETE pending), session routing in stigmer-service, desktop app runner lifecycle (DELETED), Electron IPC for filesystem browsing

## Current Status

**Created**: 2026-05-20
**Current Task**: T03 Complete — T04 ready to start
**Status**: `createStigmerRunner()` factory scaffolded, `@stigmer/runner` is now a library-first package

## Session Progress (2026-05-20, Session 3)

### What was accomplished
- **Completed T03: Scaffold `createStigmerRunner()` factory**
  - Created `src/runner.ts` with `createStigmerRunner()`, `StigmerRunnerOptions`, `StigmerRunner`
  - Created `src/index.ts` public API barrel
  - Slimmed `main.ts` from 124 lines to 75 lines (thin CLI entry delegating to factory)
  - Updated `package.json` with dual exports (`.` for library, `./cli` for binary)
  - Fixed activity registration gap: `RunScript`, `RunShell`, `CallLlm` now registered
  - 9 new tests, all passing. `tsc --noEmit` clean. 1367/1368 tests pass (1 pre-existing failure)

### Key changes
1. **`src/runner.ts`** (~250 lines): Factory with typed options, internal fetch interceptor handling, `Promise.all` activity imports, `Config` mapping, Temporal worker creation, `{start, shutdown}` handle
2. **`src/index.ts`** (~20 lines): Public API barrel re-exporting factory + types
3. **`src/main.ts`** (75 lines, down from 124): Thin CLI entry — `loadConfig()` → map to options → `createStigmerRunner()` → signal handlers → `runner.start()`
4. **`package.json`**: `main` → `./src/index.ts`, dual `exports` (`.` + `./cli`), updated `publishConfig`
5. **Bug fix**: 3 missing activity registrations (`RunScript`, `RunShell`, `CallLlm`)

### Decisions made
- `StigmerRunnerOptions` does NOT expose `mode` — derived from `proxyEndpoint` presence
- OTel is NOT part of the factory — consumer responsibility (avoids global state mutation)
- Fetch interceptor handled internally by the factory (not a two-step setup)
- `Config` interface unchanged — factory maps `StigmerRunnerOptions` → `Config` via private function
- `idleTimeoutSeconds` set to `null` in factory (not exposed — was unused anyway)

### Surprises discovered
- `RunScript`/`RunShell` (from `run-command.ts`) and `CallLlm` (from `call-llm.ts`) were implemented but never registered in `main.ts` — the workflow-runner-typescript-rewrite added these activities and wired `proxyActivities` for them, but forgot to add the factories to `main.ts`. Fixed in the factory.
- `idle-watchdog.ts` is just activity concurrency tracking (`activityStarted`/`activityFinished`), not process idle shutdown as the T01 plan assumed. No changes needed.
- `call-function.test.ts` has a pre-existing failure (stale assertion expecting "Phase 4b" in error message — the message changed when call:agent was implemented). Not related to T03.

## Session Progress (2026-05-20, Session 2)

### What was accomplished
- **Completed T02: Full Runner API removal from the OSS repo**
  - 463 files changed, 70,356 lines deleted, 3,621 lines inserted
  - 7 phased commits executed (proto deletion → Go server → dispatch → TS runner → SDK/React → CLI → desktop)
  - All builds verified: `buf lint`, Go (`stigmer-server`, `workflow-runner`, CLI), TypeScript (`runner` service)
  - All dispatch tests pass with simplified routing

### Key changes
1. **Proto deletion**: 6 runner proto files deleted, `RunnerUsageSummary` renamed to `StreamingUsageSummary`, `runner = 46` enum removed from `api_resource_kind.proto`, `runner_id` removed from session and execution protos
2. **Go server**: Entire `pkg/domain/runner/` package deleted (19 files), session `resolve_runner.go` deleted, dispatch simplified to hardcoded `agent_execution_runner` queue, `WaitForRunnerReady` activity deleted
3. **TS runner**: `heartbeat.ts` deleted, `runnerId` removed from config, heartbeat boot removed from `main.ts`
4. **SDK/React**: Runner hooks/components deleted (17 files), `useNewSessionFlow` cleaned of runner selection, usage type renamed
5. **CLI**: Runner command package deleted (18 files), `stigmer up` simplified to start server directly, `stigmer down runner`/`stigmer list runners` removed
6. **Desktop**: Runner pages, hooks, deep link handler, Tauri IPC commands, sidecar all deleted (19 files deleted, 6 modified)
7. **Workflow-runner**: Heartbeat package deleted, `STIGMER_RUNNER_ID` removed from config

### Decisions made
- `RunnerUsageSummary` → `StreamingUsageSummary` (not `ExecutionUsageSummary` due to collision with existing message in `io.proto`)
- No `reserved` directive on deleted enum value 46 — clean break
- Dispatch temporarily uses hardcoded `agent_execution_runner` queue — T04 replaces with per-session routing
- `stigmer up` now starts the server (no runner start concept)

## Next Steps

1. **T04: Per-session task queue routing** — replace `DefaultActivityTaskQueue` constant in `dispatch.go` with session-derived queue naming. Design decision needed: queue naming convention (`session:{id}` vs `stigmer/session/{id}`) and desktop multi-session handling.
2. **T05: Java control plane refactor** — delete Runner domain in `stigmer-cloud`, add session-based dispatch (HIGH risk, depends on T02 being merged to update buf module)
3. **T06: Desktop app refactor** — embed runner, remove Runner UI/launch tokens (depends on T03 + T04)

## Context for Resume

- Branch: `feat/unified-runner-migration`
- T03 files: `src/runner.ts` (factory), `src/index.ts` (barrel), `src/__tests__/runner.test.ts` (tests)
- The factory registers all 16 activity types (14 original + 3 newly registered)
- `main.ts` now delegates to `createStigmerRunner()` — it's a thin CLI entry
- `package.json` has dual exports: `.` (library) and `./cli` (binary)
- All builds pass: `tsc --noEmit`, 1367/1368 Vitest tests
- Research report: `_projects/2026-05/20260518.01.unified-runner-migration/research.control-plane-runner-architecture-review/04.report.gemini.md`
- Audit report: `tasks/T01_inventory-and-impact-audit.md`

## Quick Commands

After loading context:
- "Start T04 — per-session task queue routing" - Begin session-based dispatch
- "Show project status" - Get overview of progress
- "Commit and push" - Commit changes

---

*This file provides direct paths to all project resources for quick context loading.*
