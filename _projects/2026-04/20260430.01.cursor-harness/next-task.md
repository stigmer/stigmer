# Next Task: 20260430.01.cursor-harness

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260430.01.cursor-harness

**Description**: Integrate the Cursor TypeScript SDK as a premium execution harness alongside Stigmer's native harness within the runner daemon. Introduces the Harness concept to SessionSpec, a new TypeScript Temporal activity worker (ExecuteCursor), embedded Node.js runtime in the CLI, and unified cost/streaming/HITL adapters.
**Goal**: Enable Stigmer sessions to choose between native (standard) and Cursor (premium) execution harnesses. When a session uses the Cursor harness, executions are processed by a TypeScript worker wrapping the Cursor SDK, with full streaming, MCP integration, HITL approval, and unified billing.
**Tech Stack**: TypeScript (Cursor SDK, Temporal SDK), Go (workflow dispatch, CLI daemon), Protocol Buffers (session/execution protos), Node.js/Bun (embedded runtime)
**Components**: protos (session, agentexecution enums), CLI daemon (multi-worker management), Go workflow (dispatch by harness), new TypeScript cursor-runner service, embedded CLI packaging, SDK/React (session harness picker), cost/billing adapter

## Current State

- **Status**: COMPLETE — All tasks done (T01–T09) + gap assessment + automated tests + cloud availability fix + unified model selector + dev-mode startup delay fix + agent blueprint propagation
- **Last Session**: May 1, 2026 — Session 16: Agent Blueprint Propagation
- **Active Task**: None — blueprint propagation implemented
- **Branch**: `feat/cursor-harness`

## Session Progress (May 1, 2026 — Session 16)

### Agent Blueprint Propagation

Implemented full agent blueprint propagation for the Cursor Harness. Previously, the cursor-runner sent only the bare user message to the Cursor agent — no persona, instructions, MCP servers, skills, sub-agents, or workspace context was carried forward. This session closed that critical gap by replicating the Python agent-runner's full pipeline.

**New modules (4 files):**
- `blueprint-resolver.ts` — resolves agent chain (execution → session → agentInstance → agent), merges MCP + skills
- `prompt-builder.ts` — assembles enhanced prompt with instructions, skills, sub-agents, workspace context, response rules
- `skill-resolver.ts` — fetches skills via gRPC, writes to platform-managed `.stigmer/skills/` directory
- `attachment-resolver.ts` — copies attachments to `.stigmer/inputs/` platform directory

**Modified files (4 files):**
- `stigmer-client.ts` — added 7 new gRPC methods (Agent, AgentInstance, McpServer, Skill queries)
- `mcp-resolver.ts` — added `resolveMcpServers()` with full gRPC resolution pipeline
- `session-lifecycle.ts` — multi-workspace support (string[])
- `execute-cursor.ts` — full orchestration rewrite with 12 phases including blueprint resolution

**Verification:** TypeScript compilation clean (0 errors), 135 tests pass (8 files), no linter errors.

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

## Essential Files to Review

### 1. Latest Checkpoint
```
_projects/2026-04/20260430.01.cursor-harness/checkpoints/2026-05-01-session-16.md
```

### 2. Blueprint Propagation Plan
```
.cursor/plans/blueprint_propagation_gap_analysis_be91e880.plan.md
```

### 3. Previous Checkpoints
```
_projects/2026-04/20260430.01.cursor-harness/checkpoints/2026-05-01-session-15.md
_projects/2026-04/20260430.01.cursor-harness/checkpoints/2026-04-30-session-14.md
_projects/2026-04/20260430.01.cursor-harness/checkpoints/2026-04-30-session-12.md
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
