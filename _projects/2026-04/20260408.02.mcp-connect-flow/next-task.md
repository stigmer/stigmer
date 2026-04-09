# Next Task: 20260408.02.mcp-connect-flow

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: Streamline MCP Server Connect Flow

**Description**: Replace the two-step Discover + Generate Policies flow with a single Connect button. Move tool approvals from spec to status (system-generated), introduce pinned_tool_approvals in spec for manual overrides, add structured-output LLM classifier, and streamline authorization with can_connect FGA permission.

**Goal**: Unify MCP server setup into a single Connect action that discovers tools and classifies approval policies via a lightweight structured-output LLM call. Eliminate the deep agent session overhead for policy generation. Enable first-time-use backfill in the Graphton pipeline.

**Tech Stack**: Protobuf, Python/LangChain (agent-runner), Java/Spring (stigmer-cloud), TypeScript/React (SDK), OpenFGA

## Task Summary (4 phases)

| Task | Name | Scope | Status |
|------|------|-------|--------|
| T01 | Proto Model + FGA + Codegen | stigmer OSS + stigmer-cloud | **COMPLETE** |
| T02 | Python Classifier + Connect Workflow + Graphton Backfill | agent-runner | **NEXT** (unblocked) |
| T03 | Java Handlers + Auth Wiring + FGA Deploy | stigmer-cloud | **COMPLETE** |
| T04 | React SDK + UI Redesign + Cleanup | stigmer OSS sdk/react | PENDING (unblocked) |

## Current State
- **Status**: T01 + T03 complete, ready for T02 or T04
- **Last Session**: April 9, 2026 — T03 fully executed
- **Active Task**: None — T03 finished, T02 next

## Session Progress (2026-04-09, Session 2)

### What was accomplished
- **T03: Java Handlers + Auth Wiring + FGA Deploy** (stigmer-cloud)
  - Deleted `McpServerUpdateDiscoveredCapabilitiesHandler.java` — RPC was deleted in T01
  - Created `McpServerConnectHandler.java` replacing `McpServerDiscoverCapabilitiesHandler.java`:
    - Route: `connect` (was `discoverCapabilities`)
    - Input: `ConnectInput` (was `DiscoverCapabilitiesInput`)
    - Auth: `can_connect` (was `can_edit`)
    - Workflow name: kept as `"stigmer/mcp-server/discover"` for coordinated rename in T02
    - Removed `DiscoverySource.api` reference (deleted enum)
    - Added `status.tool_approvals` persistence from workflow output (forward-compatible with T02 classifier)
    - Renamed inner classes: `ExecuteConnectWorkflow`, `StoreConnectResults`
  - Updated `McpServerGrpcAutoController.java` javadoc references
  - Updated `CreateExecutionContextStep.java` javadoc references
  - Updated `UpsertMcpServerBatchActivityImpl.java`:
    - Replaced conditional `default_tool_approvals` merge with unconditional `pinned_tool_approvals` preservation
    - `pinned_tool_approvals` is user-owned; registry sync must never touch it
  - Applied FGA model to production (new model ID: `01KNRKV8VWQWD77KNJRCGHYVX7`)
  - Updated `openfga-config.yaml` and applied via `planton apply`

### Key decisions made
- **No `observeMcpServerStatus` RPC** — the T03 plan originally called for renaming the update handler to an observe handler with platform-level auth. Instead, the handler was deleted entirely. All status writes flow through the `connect` workflow's Temporal output. This eliminates a platform-level backdoor RPC and keeps status as system-derived.
- **Unconditional `pinned_tool_approvals` preservation** in `UpsertMcpServerBatchActivityImpl` — the old code conditionally merged `default_tool_approvals`, which implied the registry could provide them. `pinned_tool_approvals` are purely user-owned; the sync unconditionally preserves them from the existing record.
- **Workflow name kept as `"stigmer/mcp-server/discover"`** — the rename to `"stigmer/mcp-server/connect"` must be coordinated across Go (connect.go), Java (McpServerConnectHandler), and Python (discover_mcp_server.py) simultaneously. Deferred to T02.

### Files modified (T03 scope in stigmer-cloud)
- 5 handler/service files changed + 1 config file + 1 FGA model (already changed in T01)
- Net: 2 files deleted, 1 file created, 4 files modified

## Next Steps

1. **T02: Python Classifier + Connect Workflow + Graphton Backfill** (agent-runner)
   - Implement structured-output LLM classifier for tool approval policies
   - Update `DiscoverMcpServerWorkflow` to return tool approvals alongside capabilities
   - Add Graphton backfill: detect empty status on first agent execution, call `connect` RPC
   - Update `approval_policy.py` to read from `status.tool_approvals` instead of `spec.default_tool_approvals`
   - Coordinate workflow name rename: `"stigmer/mcp-server/discover"` → `"stigmer/mcp-server/connect"` across Go + Java + Python

2. **T04: React SDK + UI Redesign + Cleanup** (stigmer OSS sdk/react)
   - Full rewrite of `useDiscoverCapabilities` hook to `useMcpServerConnect`
   - Update `useMcpServerSetup` to read `status.tool_approvals`
   - Single "Connect" button UI with ConnectBar component
   - Delete `useTriggerApprovalPolicySession`, `ApprovalPolicyGeneratorPanel`

## Context for Resume
- T03 plan file: `/Users/suresh/.cursor/plans/t03_java_connect_handler_2c7830b8.plan.md`
- T01 plan file: `/Users/suresh/.cursor/plans/t01_proto_fga_codegen_69f35673.plan.md`
- The `updateDiscoveredCapabilities` RPC was deleted entirely (not renamed). No `observeMcpServerStatus` RPC exists.
- The agent-runner Python worker (`discover_mcp_server.py`) still uses workflow name `"stigmer/mcp-server/discover"` — this is T02 scope.
- React `useDiscoverCapabilities.ts` was minimally updated for compilation but needs a full rewrite in T04.
- stigmer-cloud changes (T01 stubs + T03 handlers + FGA config) are uncommitted.
- FGA model is deployed to production with `can_connect: viewer`.

## Essential Files to Review

### 1. Latest Checkpoint
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260408.02.mcp-connect-flow/checkpoints/2026-04-09-session-2.md
```

### 2. Task Plans
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260408.02.mcp-connect-flow/tasks/
```

### 3. Knowledge Folders
- **Design Decisions**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260408.02.mcp-connect-flow/design-decisions/`
- **Coding Guidelines**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260408.02.mcp-connect-flow/coding-guidelines/`
- **Wrong Assumptions**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260408.02.mcp-connect-flow/wrong-assumptions/`
- **Don't Dos**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260408.02.mcp-connect-flow/dont-dos/`

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint
2. [ ] Check current task status in `tasks/`
3. [ ] Review any design decisions, coding guidelines, wrong assumptions, don't dos
4. [ ] Continue with T02 (agent-runner: Python classifier + connect workflow)

## Quick Commands

- "Continue with T02" — Start the Python classifier and connect workflow changes
- "Continue with T04" — Start the React SDK UI redesign
- "Show project status" — Get overview of progress
- "Create checkpoint" — Save current progress

## Planning Chat Reference

This project was planned in: [MCP Connect Flow Plan](f3cf3713-b08a-417f-a2d8-546e4250180e)

---

*This file provides direct paths to all project resources for quick context loading.*
