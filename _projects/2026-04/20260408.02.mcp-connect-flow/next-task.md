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
| T02 | Python Classifier + Connect Workflow + Graphton Backfill | agent-runner | **COMPLETE** |
| T03 | Java Handlers + Auth Wiring + FGA Deploy | stigmer-cloud | **COMPLETE** |
| T04 | React SDK + UI Redesign + Cleanup | stigmer OSS sdk/react | **NEXT** (unblocked) |

## Current State
- **Status**: T01 + T02 + T03 complete, ready for T04
- **Last Session**: April 9, 2026 (Session 3) — T02 fully implemented
- **Active Task**: None — T02 finished, T04 next

## Session Progress (2026-04-09, Session 3)

### What was accomplished
- **T02: Python Classifier + Connect Workflow + Graphton Backfill** (agent-runner + coordinated renames)
  - **New: `classify_tool_approvals.py`** — structured-output LLM classifier
    - Pydantic models: `ToolApprovalClassification`, `ClassifyToolApprovalsOutput`
    - Core `classify_tools()` function using `model.with_structured_output()` (first such usage in codebase)
    - Economy-tier model via `ModelRegistry.get_summarization_model()` (same pattern as session subject)
    - System prompt with classification rules (read-only → no approval, mutating → approval)
    - Temporal activity wrapper: `ClassifyToolApprovals`
  - **Updated: `discover_mcp_server.py`** — new `ConnectMcpServerWorkflow`
    - Chains two activities: `DiscoverMcpServerCapabilities` (300s) → `ClassifyToolApprovals` (60s)
    - New `ConnectMcpServerOutput` dataclass with `tools`, `resource_templates`, `tool_approvals`
    - Legacy `DiscoverMcpServerWorkflow` retained for in-flight backward compat
  - **Fixed: `approval_policy.py`** — broken field reference + 5-level chain
    - Fixed broken `server.spec.default_tool_approvals` → reads `pinned_tool_approvals` (spec) and `tool_approvals` (status)
    - Renamed `ApprovalConfig.default_tool_approvals` → split into `pinned_tool_approvals` + `status_tool_approvals`
    - New 5-level chain: `auto_approve_all` → `agent_override` → `pinned` → `status_classifier` → `platform_default`
    - Additive semantics: pinned and status can only ADD requirements, never exempt
  - **Extended: `mcp_server_client.py`** — command stub + `connect()` method
    - Added `McpServerCommandControllerStub` alongside existing query stub
    - New `connect()` method builds `ConnectInput` proto and calls the connect RPC
  - **Added: Graphton backfill in `setup.py`**
    - `_needs_backfill()`: checks `last_discovered_at` — triggers on never-discovered OR stale (>24h)
    - `_backfill_undiscovered_servers()`: calls connect RPC synchronously, replaces stale server in-memory
    - Non-fatal: logs warning on failure, continues without approval policies
    - `_extract_runtime_env_for_server()`: filters merged env vars to server's `env_spec` keys
  - **Updated: `worker.py`** — registered `ConnectMcpServerWorkflow` + `classify_tool_approvals` activity
  - **Coordinated workflow name rename** across three repos:
    - Python: new `CONNECT_WORKFLOW_NAME = "stigmer/mcp-server/connect"`
    - Go `connect.go`: `"stigmer/mcp-server/discover"` → `"stigmer/mcp-server/connect"`
    - Java `McpServerConnectHandler.java`: same rename
  - **Updated: `tool_event.py`** — caller updated for new `resolve_tool_approval` signature
  - **Updated: 311 tests** — all passing, new tests for pinned vs status layers

### Key decisions made
- **Additive pinned semantics**: Both `pinned_tool_approvals` and `status.tool_approvals` only ADD approval requirements (union). Neither can exempt a tool. Exemptions happen at agent level via `ToolApprovalOverride.requires_approval = false`.
- **Synchronous backfill**: First agent execution blocks during setup while connect completes (~15-45s). Subsequent executions within 24h are instant. Agent execution does NOT fail if backfill fails.
- **24-hour staleness threshold**: Backfill triggers not just on never-discovered servers but also when `last_discovered_at` is older than 24 hours. Keeps tools and approval policies fresh without manual intervention.
- **`last_discovered_at` as backfill signal**: More reliable than checking empty tools list (an MCP server could legitimately have zero tools).

### Files modified (T02 scope)
- **stigmer** repo: 1 new file, 7 modified files, +713 −379 lines
- **stigmer-cloud** repo: 1 modified file (workflow name rename), +2 −3 lines
- **Tests**: 1453 passed, 10 skipped — all green

## Next Steps

1. **T04: React SDK + UI Redesign + Cleanup** (stigmer OSS sdk/react)
   - Full rewrite of `useDiscoverCapabilities` hook to `useMcpServerConnect`
   - Update `useMcpServerSetup` to read `status.tool_approvals`
   - Single "Connect" button UI with ConnectBar component
   - Delete `useTriggerApprovalPolicySession`, `ApprovalPolicyGeneratorPanel`

## Context for Resume
- T02 plan file: `/Users/suresh/.cursor/plans/t02_connect_workflow_56354de5.plan.md`
- T03 plan file: `/Users/suresh/.cursor/plans/t03_java_connect_handler_2c7830b8.plan.md`
- T01 plan file: `/Users/suresh/.cursor/plans/t01_proto_fga_codegen_69f35673.plan.md`
- The workflow name rename is now complete across all three repos (Python, Go, Java) — `"stigmer/mcp-server/connect"`.
- The old `DiscoverMcpServerWorkflow` (`"stigmer/mcp-server/discover"`) is retained in Python for in-flight backward compat.
- `approval_policy.py` now implements the full 5-level chain — the broken `default_tool_approvals` reference is fixed.
- Graphton backfill triggers on never-discovered OR stale (>24h) MCP servers.
- React `useDiscoverCapabilities.ts` was minimally updated for compilation but needs a full rewrite in T04.
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
4. [ ] Continue with T04 (React SDK: UI redesign + connect hook rewrite)

## Quick Commands

- "Continue with T04" — Start the React SDK UI redesign and connect hook rewrite
- "Show project status" — Get overview of progress
- "Create checkpoint" — Save current progress

## Planning Chat Reference

This project was planned in: [MCP Connect Flow Plan](f3cf3713-b08a-417f-a2d8-546e4250180e)

---

*This file provides direct paths to all project resources for quick context loading.*
