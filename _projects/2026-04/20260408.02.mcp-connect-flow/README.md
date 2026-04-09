# Project: 20260408.02.mcp-connect-flow

## Overview

Replace the two-step "Discover tools + Generate Policies" flow with a single "Connect" button. Move tool approvals from `spec` to `status` (system-generated), introduce `pinned_tool_approvals` in `spec` for manual overrides, add a structured-output LLM classifier, and streamline authorization with `can_connect` and `can_update_mcp_server_status` FGA permissions.

**Created**: 2026-04-08
**Status**: Active

## Primary Goal

Unify MCP server setup into a single Connect action that discovers tools and classifies approval policies via a lightweight structured-output LLM call. Eliminate the deep agent session overhead for policy generation. Enable first-time-use backfill in the Graphton pipeline.

## Timeline

**Target Completion**: 1 week (4 substantial tasks)

## Technology Stack

Protobuf, Python/LangChain (agent-runner), Java/Spring (stigmer-cloud), TypeScript/React (SDK), OpenFGA

## Task Structure

| Task | Name | Scope | Status |
|------|------|-------|--------|
| [T01](tasks/T01_0_plan.md) | Proto Model + FGA + Codegen | stigmer OSS + stigmer-cloud | CURRENT |
| [T02](tasks/T02_0_plan.md) | Python Classifier + Connect Workflow + Graphton Backfill | agent-runner | PENDING |
| [T03](tasks/T03_0_plan.md) | Java Handlers + Auth Wiring | stigmer-cloud | PENDING |
| [T04](tasks/T04_0_plan.md) | React SDK + UI Redesign + Cleanup | stigmer OSS sdk/react | PENDING |

## Dependencies

- MCP marketplace catalog work (Session 4-5) committed (done)
- T02, T03, T04 all depend on T01 (proto changes + codegen)

## Success Criteria

1. Single Connect button in UI discovers tools + classifies approvals in one flow
2. `status.tool_approvals` populated by classifier, `spec.pinned_tool_approvals` for manual overrides
3. Graphton first-time-use backfill works for MCP servers never explicitly Connected
4. `can_connect` and `can_update_mcp_server_status` FGA permissions enforced
5. Deep agent policy generation code deleted

## Known Risks

1. `with_structured_output` is first usage in codebase -- model compatibility needs verification
2. Economy-tier model reliability for structured classification
3. Proto field removal cascades into generated code across 4 languages

## How to Resume

Drag `next-task.md` into chat to resume.

## Project Structure

- **`tasks/`** - Detailed task plans and execution logs
- **`checkpoints/`** - Milestone summaries
- **`design-decisions/`** - Architectural choices
- **`coding-guidelines/`** - Project standards
- **`wrong-assumptions/`** - Corrected misconceptions
- **`dont-dos/`** - Anti-patterns to avoid

## Planning Chat

This project was planned in: [MCP Connect Flow Plan](f3cf3713-b08a-417f-a2d8-546e4250180e)
