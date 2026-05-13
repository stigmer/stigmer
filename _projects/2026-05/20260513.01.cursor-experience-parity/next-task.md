# Next Task: 20260513.01.cursor-experience-parity

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260513.01.cursor-experience-parity

**Description**: Implement usage tracking, context window visibility, chat summarization, and Cursor-like UX features based on deep research findings from three ChatGPT Deep Research reports.
**Goal**: Close the UX gap between Stigmer and Cursor IDE for early adopters: fix $0.00 usage for Cursor sessions, add context window telemetry, implement active chat summarization, and add Plan/Ask mode.
**Tech Stack**: TypeScript (cursor-runner), Java (stigmer-service), Python (agent-runner), Protobuf (protos), React (SDK)
**Components**: cursor-runner, agent-runner, stigmer-service, React SDK, protos (session/execution/billing), Planton usage dashboard

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260513.01.cursor-experience-parity/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260513.01.cursor-experience-parity/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260513.01.cursor-experience-parity/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260513.01.cursor-experience-parity/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260513.01.cursor-experience-parity/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260513.01.cursor-experience-parity/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260513.01.cursor-experience-parity/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260513.01.cursor-experience-parity/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260513.01.cursor-experience-parity/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260513.01.cursor-experience-parity/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260513.01.cursor-experience-parity/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260513.01.cursor-experience-parity/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260513.01.cursor-experience-parity/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current State

- **Status**: In Progress
- **Last Session**: May 13, 2026 — Usage MVP: Stop Showing $0.00
- **Active Task**: Phase 1 Usage MVP implemented (uncommitted). Needs commit, push, deployment verification.
- **Branch**: `feat/bring-workflows-to-foreground`

## Session Progress (May 13, 2026 — Session 3: Usage MVP)

### Diagnostic Findings

- Confirmed Cursor SDK returns usage via `onDelta` (`turn-ended.usage`) with real token counts (10K+ input)
- Discovered Cursor SDK streaming bypasses `globalThis.fetch` — proxy CANNOT observe main agent turns
- MongoDB investigation: 47 records exist, all `harness: "native"`, `customer_billable_amount_micros: 0`
- 14 records from Cursor sessions are MCP classifier sidecar calls, not main agent turns
- Deep Research report confirms: runner-reported usage is DISPLAY_ONLY, needs Admin API reconciliation for billing authority

### Three Root Causes Fixed

1. **Cursor turns not captured**: Empty `onDelta` handler filled — `UsageAccumulator` captures turn-ended usage, computes provisional cost, streams to execution status
2. **Harness always "native"**: Added `harness` field to `RecordLlmCallUsageInput`, proxy controllers pass their identity
3. **Billable always $0**: `customer_billable_amount_micros` now written back to MongoDB after debit. Backfilled 47 existing records.

### Changes (uncommitted)

**stigmer OSS**: 3 proto files + generated stubs, 1 new TS file (`usage-accumulator.ts`), 2 modified TS files, research folder
**stigmer-cloud**: 5 Java files modified (proxy + billing layers)

### Previous Sessions

- **Session 2** (`e090a92b7`): Server-reported deployment mode (getServerInfo RPC)
- **Session 1** (`2ba7abaf9`): Web-desktop feature parity fixes

## Next Steps

1. Commit and push OSS changes (create PR)
2. Commit and push cloud changes (create linked PR)
3. Deploy and verify end-to-end in prod
4. Plan Phase 2: Context window visibility OR Admin API reconciliation (from research report phases)

## Context for Resume

- `RunnerUsageSummary` is field 20 on `AgentExecutionStatus`, defined in `usage.proto`
- `useSessionUsage` hook falls back to `runner_usage` from execution status when server report is empty
- Trust model: runner usage = DISPLAY_ONLY, proxy usage = BILLING_AUTHORITY, future Admin API = PROVIDER_SETTLED
- Deep Research report at `research.runner-usage-tamper-resistance/04.report.gpt.md` recommends phased approach: estimated now, reconciliation soon, signed receipts later
- Cloud Java changes in stigmer-cloud must be committed separately

## Quick Commands

After loading context:
- "Commit OSS changes" — Create PR for stigmer repo
- "Commit cloud changes" — Create PR for stigmer-cloud repo
- "Plan Phase 2" — Begin context window visibility
- "Plan reconciliation" — Begin Cursor Admin API reconciliation

---

*This file provides direct paths to all project resources for quick context loading.*
