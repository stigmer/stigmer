# Next Task: 20260408.02.mcp-connect-flow

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: Streamline MCP Server Connect Flow

**Description**: Replace the two-step Discover + Generate Policies flow with a single Connect button. Move tool approvals from spec to status (system-generated), introduce pinned_tool_approvals in spec for manual overrides, add structured-output LLM classifier, and streamline authorization with can_connect and can_update_mcp_server_status FGA permissions.

**Goal**: Unify MCP server setup into a single Connect action that discovers tools and classifies approval policies via a lightweight structured-output LLM call. Eliminate the deep agent session overhead for policy generation. Enable first-time-use backfill in the Graphton pipeline.

**Tech Stack**: Protobuf, Python/LangChain (agent-runner), Java/Spring (stigmer-cloud), TypeScript/React (SDK), OpenFGA

## Task Summary (4 phases)

| Task | Name | Scope | Status |
|------|------|-------|--------|
| T01 | Proto Model + FGA + Codegen | stigmer OSS + stigmer-cloud | **COMPLETE** |
| T02 | Python Classifier + Connect Workflow + Graphton Backfill | agent-runner | **NEXT** (unblocked) |
| T03 | Java Handlers + Auth Wiring | stigmer-cloud | PENDING (unblocked) |
| T04 | React SDK + UI Redesign + Cleanup | stigmer OSS sdk/react | PENDING (unblocked) |

## Current State
- **Status**: T01 complete, ready for T02
- **Last Session**: April 9, 2026 — T01 fully executed
- **Active Task**: None — T01 finished, T02 next

## Session Progress (2026-04-09)

### What was accomplished
- **Proto changes**: All 4 MCP server protos updated (spec, status, command, io)
  - Deleted `default_tool_approvals` from spec, added `pinned_tool_approvals`
  - Added `tool_approvals` to status, deleted `DiscoverySource` enum and `discovered_by` field
  - Deleted `updateDiscoveredCapabilities` RPC entirely, renamed `discoverCapabilities` → `connect`
  - Deleted `UpdateDiscoveredCapabilitiesInput`, renamed `DiscoverCapabilitiesInput` → `ConnectInput`
- **IAM**: Added `can_connect = 22` to `IamPermission` enum
- **FGA**: Added `can_connect: viewer` in `mcp_server.fga` (stigmer-cloud)
- **Codegen**: Ran `make protos` — regenerated Go, TypeScript, Python, Java stubs + SDK clients
- **Go backend**: New `connect.go` handler, deleted old handlers, updated controller/apply/server/downstream client
- **Shared lib**: Removed `DiscoverySource` param from `mcpdiscovery.Discover()`
- **CLI**: Rewrote `discover.go` to call `Connect` RPC with `runtime_env` instead of local discovery + push
- **React SDK**: Fixed compilation errors (`defaultToolApprovals` → `pinnedToolApprovals`, `discoverCapabilities` → `connect`)
- **Docs/tests/seedpack**: Updated all downstream references, regenerated SDK docs
- **Validation**: `make check` passes (1447 tests, 0 failures)

### Key decisions made
- **`updateDiscoveredCapabilities` deleted entirely** (revised from original plan which renamed it to `observeMcpServerStatus`). Only the `connect` RPC remains.
- **CLI `discover` now delegates to backend** via `Connect` RPC with `runtime_env` populated from local env vars. DryRun still uses local discovery.
- **`SetDiscoveryDependencies` → `SetConnectDependencies`** on the controller.

### Files modified
- 127 files changed, 3333 insertions, 6207 deletions (net reduction)
- Spans: apis/, backend/, client-apps/cli/, sdk/ (go, ts, python, java, react), docs/, tools/, seedpack/, test/

## Next Steps

1. **T02: Python Classifier + Connect Workflow + Graphton Backfill** (agent-runner)
   - Implement structured-output LLM classifier for tool approval policies
   - Update `DiscoverMcpServerWorkflow` to return tool approvals alongside capabilities
   - Add Graphton backfill: detect empty status on first agent execution, auto-call connect
   - Update `approval_policy.py` to read from `status.tool_approvals` instead of `spec.default_tool_approvals`

2. **T03: Java Handlers + Auth Wiring** (stigmer-cloud)
   - Delete `McpServerUpdateDiscoveredCapabilitiesHandler.java`
   - Rename `McpServerDiscoverCapabilitiesHandler.java` → `McpServerConnectHandler.java`
   - Update `UpsertMcpServerBatchActivityImpl.java` to reference `pinned_tool_approvals`

3. **T04: React SDK + UI Redesign + Cleanup** (stigmer OSS sdk/react)
   - Full rewrite of `useDiscoverCapabilities` hook to `useConnect`
   - Update `useMcpServerSetup` to read `status.tool_approvals`
   - Single "Connect" button UI

## Context for Resume
- The revised plan file is at: `/Users/suresh/.cursor/plans/t01_proto_fga_codegen_69f35673.plan.md`
- The `updateDiscoveredCapabilities` RPC was deleted entirely (not renamed). This is a deviation from the original T01 plan.
- The agent-runner Python worker (`discover_mcp_server.py`) still references `discoverCapabilities` — this is T02 scope.
- React `useDiscoverCapabilities.ts` was minimally updated for compilation but needs a full rewrite in T04.
- stigmer-cloud FGA change (`can_connect: viewer`) is uncommitted in a separate repo.

## Essential Files to Review

### 1. Latest Checkpoint
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260408.02.mcp-connect-flow/checkpoints/2026-04-09-session-1.md
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
- "Show project status" — Get overview of progress
- "Create checkpoint" — Save current progress

## Planning Chat Reference

This project was planned in: [MCP Connect Flow Plan](f3cf3713-b08a-417f-a2d8-546e4250180e)

---

*This file provides direct paths to all project resources for quick context loading.*
