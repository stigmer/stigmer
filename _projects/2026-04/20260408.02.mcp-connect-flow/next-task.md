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
| T04 | React SDK + UI Redesign + Cleanup | stigmer OSS sdk/react | **COMPLETE** |

## Current State
- **Status**: ALL PHASES COMPLETE (T01 + T02 + T03 + T04)
- **Last Session**: April 9, 2026 (Session 4) — T04 fully implemented
- **Active Task**: None — project complete

## Session Progress (2026-04-09, Session 4)

### What was accomplished
- **T04: React SDK + UI Redesign + Cleanup** (stigmer OSS sdk/react + client-apps/web)
  - **New: `useMcpServerConnect.ts`** — clean domain-aligned hook
    - `connect()`, `isConnecting`, `error`, `clearError`
    - Calls `stigmer.mcpServer.connect(input)` (same RPC as before, renamed API)
  - **Rewritten: `McpServerDetailView.tsx`** (1126 → 817 lines)
    - ConnectBar above tabs: single Connect/Reconnect button with credential gating
    - ToolsTabContent: pure read-only tool list (no action bar)
    - PoliciesTabContent: two visual groups — Pinned (pin icon) + Auto-classified (sparkle icon)
    - New icons: ConnectIcon, PinIcon, Spinner
    - Removed: `onPolicySessionCreated` prop, policy generation callbacks
  - **Deleted: 3 files, 551 lines removed**
    - `useDiscoverCapabilities.ts` (120 lines) — replaced by `useMcpServerConnect`
    - `useTriggerApprovalPolicySession.ts` (265 lines) — deep-agent policy generation eliminated
    - `ApprovalPolicyGeneratorPanel.tsx` (166 lines) — inline streaming panel removed
  - **Updated exports**: barrel exports in `index.ts` and `src/index.ts`
  - **Updated demo fixtures**: `discoverCapabilities` → `connect`, stale JSDoc cleanup
  - **Updated Console**: `McpServerDetailPage.tsx` — removed `onPolicySessionCreated` and `useSessionNavigation`

### Key decisions made
- **ConnectBar is internal** (not exported) — hook is the headless integration point
- **Full transparency in Policies tab** — both pinned and auto-classified shown, no deduplication
- **No deprecation path** — pre-1.0 platform, clean rename

### Files modified (T04 scope)
- **stigmer** repo: 1 new file, 5 modified files, 3 deleted files, +281 −914 lines
- **TypeScript**: `sdk/react` and `client-apps/web` both compile cleanly
- **ESLint**: `client-apps/web` passes

## Follow-Up Tasks

1. **Docs update**: `docs/sdk/react/mcp-server.mdx` references deleted hooks/components
2. **Site demos**: 3 demo scenario files use deleted proto constructs (`DiscoverySource`, `defaultToolApprovals`)
3. **Generated docs**: `sdk/react/typedoc-output.json` will regenerate on next build

## Context for Resume
- T04 plan file: `/Users/suresh/.cursor/plans/t04_react_sdk_connect_18636d2f.plan.md`
- T02 plan file: `/Users/suresh/.cursor/plans/t02_connect_workflow_56354de5.plan.md`
- T03 plan file: `/Users/suresh/.cursor/plans/t03_java_connect_handler_2c7830b8.plan.md`
- T01 plan file: `/Users/suresh/.cursor/plans/t01_proto_fga_codegen_69f35673.plan.md`
- The full connect flow is now wired end-to-end: Proto → Python classifier → Java handler → React SDK
- FGA model is deployed to production with `can_connect: viewer`
- The old `DiscoverMcpServerWorkflow` is retained in Python for in-flight backward compat

## Essential Files to Review

### 1. Latest Checkpoint
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260408.02.mcp-connect-flow/checkpoints/2026-04-09-session-4.md
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

## Planning Chat Reference

This project was planned in: [MCP Connect Flow Plan](f3cf3713-b08a-417f-a2d8-546e4250180e)

---

*This file provides direct paths to all project resources for quick context loading.*
