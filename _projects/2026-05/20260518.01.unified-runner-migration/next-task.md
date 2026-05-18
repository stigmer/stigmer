# Next Task: 20260518.01.unified-runner-migration

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260518.01.unified-runner-migration

**Description**: Migrate Python agent-runner and TypeScript cursor-runner into a single unified TypeScript runner service (backend/services/runner/), eliminating Python from the agent execution path and creating a common codebase for both LangGraph deep agents and Cursor SDK harnesses.
**Goal**: Single TypeScript runner service that handles ExecuteDeepAgent, ExecuteCursor, EnsureThread, DiscoverMcpServer, and ClassifyToolApprovals — with all shared infrastructure (MCP resolver, HITL, status builder) unified. Python agent-runner, cursor-runner, and graphton library deleted after validated cutover.
**Tech Stack**: TypeScript/Node.js, Temporal SDK, deepagents JS (npm), LangGraph JS, Connect-ES (gRPC), @bufbuild/protobuf, Vitest
**Components**: backend/services/agent-runner (Python, to be retired), backend/services/cursor-runner (TypeScript, to be retired), backend/libs/python/graphton (to be retired), backend/services/runner (NEW), backend/services/agent-runner/sandbox/Dockerfile.sandbox.full, .github/workflows/release.sandbox-cloud.yaml

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260518.01.unified-runner-migration/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260518.01.unified-runner-migration/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260518.01.unified-runner-migration/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260518.01.unified-runner-migration/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260518.01.unified-runner-migration/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260518.01.unified-runner-migration/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260518.01.unified-runner-migration/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260518.01.unified-runner-migration/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260518.01.unified-runner-migration/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260518.01.unified-runner-migration/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260518.01.unified-runner-migration/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260518.01.unified-runner-migration/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260518.01.unified-runner-migration/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-05-18 15:11
**Current Task**: T01 — Research Spike (Phase 0, Hard Gate)
**Status**: COMPLETE — all sub-tasks validated, gate decision: GO (awaiting developer approval to proceed to Phase 1)

## Session Progress (2026-05-18)

### What Was Accomplished
- Explored all three codebases in depth (graphton 37 modules, agent-runner 4 activities, cursor-runner 41K lines TS)
- Explored Temporal orchestration layer (Go workflow, queue dispatch, sandbox Dockerfile)
- Set up and ran ChatGPT Deep Research on JS ecosystem feasibility
- Completed T01a: classified all 37 graphton modules (NATIVE/CURSOR-RUNNER/REBUILD/NOT NEEDED)
- Completed T01b: validated LangGraph JS checkpointers (MemorySaver, MongoDBSaver, interrupt/resume)
- Completed T01c: built and ran PoC script — 4/4 tests pass (createDeepAgent, middleware, HITL, subagents)
- Wrote gate decision document recommending GO with Option A (DeepAgents JS + graphton-ts layer)

### Key Discoveries
- cursor-runner is 41K lines of mature TypeScript (not a thin wrapper) — huge head start for unified runner
- cursor-runner was hidden from Cursor search by `.cursorignore` with `*` wildcard
- DeepAgents JS middleware API: `wrapToolCall(request, handler)` not `(next, call, config)`
- HITL uses `interruptOn: { toolName: { allowedDecisions: ["approve","edit","reject"] } }` (object, not array)
- Allowed decisions enum: approve | edit | reject (not deny)
- 30% of graphton (13 modules, ~2,720 TS lines) needs rebuilding; 36% not needed; rest available

### Architectural Decision
- Option A: DeepAgents JS + graphton-ts compatibility layer (createStigmerAgentRunner wrapper)

## Next Steps
1. Approve gate decision (design-decisions/003-t01-gate-decision.md)
2. Start Phase 1: scaffold `backend/services/runner/` seeded from cursor-runner
3. Add deepagents, @langchain/langgraph, @langchain/anthropic dependencies
4. Register both ExecuteCursor and ExecuteDeepAgent activities

## Context for Resume
- Deep Research report is in `research.deepagents-js-langgraph-js-feasibility/04.report.gpt.md`
- PoC script at `poc/src/poc.ts` — run with `ANTHROPIC_API_KEY=... npx tsx src/poc.ts`
- The `interruptOn` PoC test passed validation but the agent didn't call the dangerous tool (used filesystem tools instead) — the mechanism is wired correctly but a more targeted HITL test should be part of Phase 3

## Migration Phases (Full Roadmap)

| Phase | Name | Est. Days | Status |
|-------|------|-----------|--------|
| 0 | Research Spike (T01) — deepagents JS + LangGraph JS feasibility | 1 | COMPLETE (4/4 PoC tests pass) |
| 1 | Service Scaffold — `backend/services/runner/` from cursor-runner seed | 2-3 | Blocked on Phase 0 |
| 2 | Core Shared Infrastructure — MCP, workspace, checkpointer, status | 3-4 | Blocked on Phase 1 |
| 3 | ExecuteDeepAgent Activity — the core migration | 5-7 | Blocked on Phase 2 |
| 4 | Supporting Activities — EnsureThread, MCP discovery, classify | 2-3 | Blocked on Phase 3 |
| 5 | Testing — port Python tests, integration, HITL e2e | 3-4 | Blocked on Phase 4 |
| 6 | Deployment — sandbox image, CI, cutover | 2-3 | Blocked on Phase 5 |
| 7 | Cleanup — delete Python/cursor-runner, graphton, update CI | 1-2 | Blocked on Phase 6 |

## Key References

- **Detailed plan**: [Cursor plan file](~/.cursor/plans/agent_runner_ts_migration_8d5d7690.plan.md)
- **Python agent-runner**: `backend/services/agent-runner/`
- **TypeScript cursor-runner**: `backend/services/cursor-runner/`
- **graphton library**: `backend/libs/python/graphton/`
- **Sandbox Dockerfile**: `backend/services/agent-runner/sandbox/Dockerfile.sandbox.full`
- **CI pipeline**: `.github/workflows/release.sandbox-cloud.yaml`

## Quick Commands

After loading context:
- "Continue with T01" - Resume the current task
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
