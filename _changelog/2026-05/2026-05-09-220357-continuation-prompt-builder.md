# Continuation Prompt Builder (Task 2b)

**Date**: May 9, 2026

## Summary

Built the continuation prompt builder module for the Cursor harness durability layer. When a Cursor agent expires, is unreachable, or runs in LOCAL mode (where native context is unreliable), these prompts give a fresh agent the full context of prior conversation — decisions made, files changed, failures to avoid, and the current user intent.

## Problem Statement

Cursor local agents do not reliably retain conversation context across `Agent.send()` calls. When an agent expires or the local store lookup fails, the fresh replacement agent starts with zero context. This makes multi-turn conversations feel broken — the agent repeats work, forgets decisions, and retries failed approaches.

### Pain Points

- Fresh agents have no knowledge of prior conversation turns
- Decisions made in earlier turns are lost, causing contradictory behavior
- Failed approaches get retried because the agent doesn't know what already broke
- HITL delayed approvals (arriving hours/days later) have no context for the fresh agent to evaluate whether the approved action is still appropriate

## Solution

Two new prompt builders that construct complete, context-rich prompts from persisted `SessionMemory`:

1. **Normal continuation** — used on every subsequent execution in LOCAL mode. Agent identity (instructions, skills, workspace) + durable memory (summary, decisions, failures, changed files, recent turns, tool observations) + user message.

2. **HITL continuation** — used when a fresh agent handles a reinvocation after delayed human approval. Includes the proposed tool action, agent's original rationale, deny-time git state, and approval decision. Instructs the agent to confirm/revise/refuse based on current workspace state.

## Implementation Details

### New: `continuation-prompt.ts` (538 lines)

- `buildContinuationPrompt()` — complete normal continuation prompt
- `buildHitlContinuationPrompt()` — HITL reinvocation prompt with confirm/revise/refuse protocol
- `extractAgentRationale()` — heuristic extraction of agent's "why" from last AI message (500 char cap)
- `getGitBranch()` / `getGitHeadSha()` — best-effort git state capture for deny-time diagnostics
- Progressive token budget enforcement: 8k token ceiling with truncation priority (turns → observations → summary)

### Modified: `prompt-builder.ts`

- Exported 7 internal formatting helpers (`formatInstructions`, `formatSkillsSection`, etc.) for reuse by continuation-prompt.ts without duplication

### Modified: `execute-cursor.ts` (Phase 12)

- Added HITL diagnostic capture at tool-deny time: `agentRationale`, `branchAtDeny`, `headShaAtDeny` populated on every `PendingApproval`
- Parallel git state capture via `Promise.all` (two fast `git rev-parse` calls)

### New: `continuation-prompt.test.ts` (564 lines, 50 tests)

- 16 tests for normal continuation (section presence, empty memory, skills, formatting)
- 19 tests for HITL continuation (approval details, diagnostics, memory subset, multiple approvals)
- 4 tests for token budget enforcement (progressive truncation, ceiling compliance)
- 5 tests for agent rationale extraction (short/long, empty, multiple messages)
- 6 tests for git utilities (real repo, non-git dir, non-existent dir)

## Benefits

- Fresh agents resume seamlessly with full context of prior work
- Decisions are explicitly preserved across agent evictions
- Failed approaches are never retried (listed in `<failed_attempts>`)
- HITL delayed approvals get intelligent re-evaluation (not blind execution)
- Token budget prevents prompt bloat even after many turns

## Impact

- **cursor-runner service**: New module, one modified activity, one modified adapter
- **User experience**: Multi-turn Cursor sessions will survive agent eviction without visible context loss (once Task 3 wires the prompt selection)
- **HITL safety**: Delayed approvals cannot cause blind execution of stale actions

## Related Work

- Task 2a: Session Memory Extraction Layer (prerequisite — provides `SessionMemory` data)
- Task 3: Graceful Resume-or-Create (next — wires prompt selection into execution flow)
- Task 5: Proto/Data Model Updates (prerequisite — `SessionMemory`, `PendingApproval` HITL fields)
- HITL research: `research.hitl-continuation-after-long-idle/04.report.gpt.md`

---

**Status**: ✅ Production Ready (pending Task 3 integration)
**Timeline**: 1 session
