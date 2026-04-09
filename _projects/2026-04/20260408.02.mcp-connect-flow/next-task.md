# Next Task: 20260408.02.mcp-connect-flow

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: Streamline MCP Server Connect Flow

**Description**: Replace the two-step Discover + Generate Policies flow with a single Connect button. Move tool approvals from spec to status (system-generated), introduce pinned_tool_approvals in spec for manual overrides, add structured-output LLM classifier, and streamline authorization with can_connect FGA permission.

**Goal**: Unify MCP server setup into a single Connect action that discovers tools and classifies approval policies via a lightweight structured-output LLM call. Eliminate the deep agent session overhead for policy generation. Enable first-time-use backfill in the Graphton pipeline.

**Tech Stack**: Protobuf, Python/LangChain (agent-runner), Java/Spring (stigmer-cloud), TypeScript/React (SDK), OpenFGA

## Task Summary (4 phases + follow-up)

| Task | Name | Scope | Status |
|------|------|-------|--------|
| T01 | Proto Model + FGA + Codegen | stigmer OSS + stigmer-cloud | **COMPLETE** |
| T02 | Python Classifier + Connect Workflow + Graphton Backfill | agent-runner | **COMPLETE** |
| T03 | Java Handlers + Auth Wiring + FGA Deploy | stigmer-cloud | **COMPLETE** |
| T04 | React SDK + UI Redesign + Cleanup | stigmer OSS sdk/react | **COMPLETE** |
| T05 | Docs, Demos, and Site Updates | stigmer OSS docs/site | **COMPLETE** |

## Current State
- **Status**: ALL TASKS COMPLETE (T01–T05)
- **Last Session**: April 9, 2026 (Session 5) — docs/demos/site fully updated
- **Active Task**: None — project complete

## Session Progress (2026-04-09, Session 5)

### What was accomplished
- **T05: Documentation, Demos, and Site Updates** (stigmer OSS docs + site)
  - Ran `make codegen` — full pipeline from protos through stubs, all SDKs, and SDK docs
  - Fixed broken fixture data in `mcp-server-detail/index.tsx` and `preview-configs.ts`
  - Created new `connect-playback` demo (6-step unified Connect flow)
  - Deleted old `discover-capabilities-playback` and `generate-policies-playback` demos
  - Merged connect-tools-tour from 6 beats to 5 (combined discover + policies into single "connected" beat)
  - Updated demo wiring: exports, MDX component map, scenario registry
  - Removed stale narration manifests and audio files for deleted demos
  - Rewrote `connect-tools.mdx` tutorial — merged Discover + Generate steps into single Connect step
  - Updated `concepts/tools.mdx`, `concepts/approval-flows.mdx`, `vocabulary.md` for new field names
  - Fixed JSDoc in `McpToolSelector.tsx` and `McpServerConfigPanel.tsx`
  - Fixed `apis/.../mcpserver/docs/overview.md` YAML example
  - Regenerated SDK docs to pick up all source fixes
  - Verified: site builds cleanly, zero stale references remain

### Key decisions made
- New `connect-playback` demo replaces both old playback demos
- Connect-tools-tour merged to 5 beats (policies tab shown as the combined result)
- Approval flows concepts page now explains two-tier model (auto-classified + pinned)
- Tutorial keeps policies callout minimal — two-tier detail deferred to concepts page

### Files modified (55 files, +147 −1591 lines)
- **docs/**: 5 hand-written pages, 2 auto-generated SDK docs
- **site/src/**: 7 modified files, 4 deleted files, 2 new files
- **sdk/react/src/**: 2 JSDoc fixes
- **apis/**: 1 overview.md update
- **site/public/demos/**: 6 narration files deleted

## Remaining Follow-Up

1. **Narration regeneration**: Run `make generate-narration` to create audio for the new `connect-playback` and updated `connect-tools-tour` demos
2. **stigmer-cloud uncommitted change**: `McpServerConnectHandler.java` has a pending change (separate repo)

## Context for Resume
- T05 plan file: `/Users/suresh/.cursor/plans/mcp_docs_and_demos_update_b577450a.plan.md`
- T04 plan file: `/Users/suresh/.cursor/plans/t04_react_sdk_connect_18636d2f.plan.md`
- T02 plan file: `/Users/suresh/.cursor/plans/t02_connect_workflow_56354de5.plan.md`
- T03 plan file: `/Users/suresh/.cursor/plans/t03_java_connect_handler_2c7830b8.plan.md`
- T01 plan file: `/Users/suresh/.cursor/plans/t01_proto_fga_codegen_69f35673.plan.md`
- The full connect flow is now wired end-to-end: Proto → Python classifier → Java handler → React SDK → Docs + Demos
- FGA model is deployed to production with `can_connect: viewer`
- The old `DiscoverMcpServerWorkflow` is retained in Python for in-flight backward compat

## Essential Files to Review

### 1. Latest Checkpoint
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260408.02.mcp-connect-flow/checkpoints/2026-04-09-session-5.md
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
