# Next Task: 20260430.01.cursor-harness

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260430.01.cursor-harness

**Description**: Integrate the Cursor TypeScript SDK as a premium execution harness alongside Stigmer's native harness within the runner daemon. Introduces the Harness concept to SessionSpec, a new TypeScript Temporal activity worker (ExecuteCursor), embedded Node.js runtime in the CLI, and unified cost/streaming/HITL adapters.
**Goal**: Enable Stigmer sessions to choose between native (standard) and Cursor (premium) execution harnesses. When a session uses the Cursor harness, executions are processed by a TypeScript worker wrapping the Cursor SDK, with full streaming, MCP integration, HITL approval, and unified billing.
**Tech Stack**: TypeScript (Cursor SDK, Temporal SDK), Go (workflow dispatch, CLI daemon), Protocol Buffers (session/execution protos), Node.js/Bun (embedded runtime)
**Components**: protos (session, agentexecution enums), CLI daemon (multi-worker management), Go workflow (dispatch by harness), new TypeScript cursor-runner service, embedded CLI packaging, SDK/React (session harness picker), cost/billing adapter

## Current State

- **Status**: COMPLETE — All tasks done (T01–T09) + gap assessment + automated tests + cloud availability fix + unified model selector + dev-mode startup delay fix + agent blueprint propagation + RUNNER_PHASE_STARTING lifecycle + cursor-runner enum crash fix + parallel bootstrap
- **Last Session**: May 1, 2026 — Session 18: Fix Cursor Runner Enum Crash and Parallelize Bootstrap
- **Active Task**: None — enum crash fixed and bootstrap parallelized
- **Branch**: `feat/cursor-harness`

## Session Progress (May 1, 2026 — Session 18)

### Fix Cursor Runner TypeScript Enum Crash and Parallelize Bootstrap

Fixed a runtime crash in the embedded cursor-runner caused by Node.js 22's strip-only TypeScript mode encountering `export enum` in proto stubs. Also parallelized the Python and Node.js bootstrap phases to reduce first-run startup latency.

**sync.sh (covers all deployment paths):**
- Added Step 2b: compiles proto stubs to JS via `tsc`, rewrites `package.json` exports to conditional exports (`types` → `.ts`, `import` → `dist/*.js`)
- Single change covers local dev (`make desktop-dev`), CI desktop (`release.desktop.yaml`), and CI CLI (`release.cli.yaml`)

**start.go (parallel bootstrap):**
- Added `cursorBootstrapOutcome` struct for channel-based result passing
- Restructured `startNativeRunner` to launch `BootstrapCursorRunnerRuntime` in a goroutine concurrently with `BootstrapPythonRuntime`
- Replaced `startCursorRunnerProcess` with `launchCursorRunnerProcess` (receives pre-completed bootstrap result)

## Next Steps

1. **Fix ApprovalAction enum bug** — correct `APPROVAL_ACTION_APPROVE`/`REJECT`/`ALWAYS_APPROVE` to `APPROVE`/`REJECT`/`ALWAYS_APPROVE` in `approval-state.ts` and `execute-cursor.ts`
2. **Implement env var resolution** for MCP server configs (${VAR_NAME} placeholders in stdio args and http headers)
3. **Implement cloud-mode attachment download** from artifact storage (currently only local mode)
4. **End-to-end validation**: Full blueprint propagation flow testing
5. Integration testing across the full flow (create session → execution → streaming → billing)
6. PR review and merge of `feat/cursor-harness` branch (stigmer OSS)
7. PR review and merge of CursorProxyController changes (stigmer-cloud)
8. Release

## Context for Resume

- All 135 cursor-runner tests pass; typecheck clean
- Blueprint propagation uses message-based instruction injection (not rules files) to avoid workspace pollution
- Skills use platform mount pattern: physical at `~/.stigmer/sessions/{id}/platform/`, symlinked from workspace `.stigmer/`
- MCP merge: session overrides agent by slug; skill refs: union deduplicated by slug
- Multi-workspace: resolved from `session.spec.workspaceEntries`, passed as `string[]` to Cursor SDK
- The `openai` native provider remains in `DISABLED_PROVIDERS` (only Cursor-served OpenAI models are visible)
- Node.js 22 strip-only mode cannot handle `export enum` — the embed path now pre-compiles proto stubs to JS via `sync.sh`
- The April 30 `import_extension=js` fix is a prerequisite for the enum crash fix (ensures correct import paths in compiled output)
- Daemon path (`daemon_process.go`) bootstrap is still sequential — parallelization deferred as a follow-up

## Essential Files to Review

### 1. Latest Checkpoint
```
_projects/2026-04/20260430.01.cursor-harness/checkpoints/2026-05-01-session-18.md
```

### 2. Previous Checkpoints
```
_projects/2026-04/20260430.01.cursor-harness/checkpoints/2026-05-01-session-17.md
_projects/2026-04/20260430.01.cursor-harness/checkpoints/2026-05-01-session-16.md
_projects/2026-04/20260430.01.cursor-harness/checkpoints/2026-05-01-session-15.md
```

### 4. Task Plan
```
_projects/2026-04/20260430.01.cursor-harness/tasks/T01_0_plan.md
```

### 5. Design Decisions
```
_projects/2026-04/20260430.01.cursor-harness/design-decisions/cursor-harness-analysis.md
_projects/2026-04/20260430.01.cursor-harness/design-decisions/hitl-cursor-hooks-approach.md
_projects/2026-04/20260430.01.cursor-harness/design-decisions/execution-interceptors-concept.md
_projects/2026-04/20260430.01.cursor-harness/design-decisions/cursor-cost-model.md
_projects/2026-04/20260430.01.cursor-harness/design-decisions/embedded-packaging-strategy.md
_projects/2026-04/20260430.01.cursor-harness/design-decisions/cursor-sdk-proxy-support.md
```

---

*This file provides direct paths to all project resources for quick context loading.*
