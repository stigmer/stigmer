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
**Current Task**: T02 Complete — T03/T04 ready to start
**Status**: Runner API fully removed from OSS repo, execution ready for NPM package work

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

### Surprises discovered
- The `ExecutionUsageSummary` name was already taken in `agentexecution/v1/io.proto` — used `StreamingUsageSummary` instead
- CLI had 3 additional files (`up.go`, `down.go`, `list.go`, `status_cmd.go`) importing the runner package beyond what was found in the initial audit
- Workflow-runner's `task_builder_call_agent_activities.go` passed `STIGMER_RUNNER_ID` into session creation — needed parameter removal from `createSession` function signature

## Next Steps

1. **T03: Scaffold `createStigmerRunner()` factory** — extract from current `main.ts`, expose as library entry point with typed options
2. **T04: Per-session task queue routing** — replace `DefaultActivityTaskQueue` constant in `dispatch.go` with session-derived queue naming
3. **T05: Java control plane refactor** — delete Runner domain in `stigmer-cloud`, add session-based dispatch (HIGH risk, depends on T02 being merged to update buf module)

## Context for Resume

- Branch: `feat/unified-runner-migration` (changes not yet committed — run commit rule)
- 463 files changed (mostly deletions of runner code + regenerated stubs)
- All builds pass: `buf lint`, Go, TypeScript
- Research report that informed this project: `_projects/2026-05/20260518.01.unified-runner-migration/research.control-plane-runner-architecture-review/04.report.gemini.md`
- The audit report (`tasks/T01_inventory-and-impact-audit.md`) contains original file paths (most now deleted)

## Quick Commands

After loading context:
- "Start T03 — scaffold createStigmerRunner factory" - Begin NPM package refactor
- "Start T04 — per-session task queue routing" - Begin session-based dispatch
- "Show project status" - Get overview of progress
- "Commit and push" - Commit all T02 changes

---

*This file provides direct paths to all project resources for quick context loading.*
