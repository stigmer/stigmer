# Next Task: 20260516.01.harness-cost-economics

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260516.01.harness-cost-economics

**Description**: Implement the cost optimization roadmap from the Cursor-vs-Native deep research: Anthropic prompt caching, billing architecture improvements, user-facing harness documentation, Cursor context trimming, and local-vs-cloud benchmarking.
**Goal**: Reduce per-execution cost and latency across both harnesses, give users clear guidance on harness selection, and make billing accurate across multiple usage sources.
**Tech Stack**: Go, TypeScript, Java, Protobuf
**Components**: backend/services/agent-runner (native caching), backend/services/cursor-runner (billing emission, context trimming), stigmer-cloud billing handler, test/integration benchmarks, user-facing docs

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260516.01.harness-cost-economics/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260516.01.harness-cost-economics/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260516.01.harness-cost-economics/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260516.01.harness-cost-economics/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260516.01.harness-cost-economics/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260516.01.harness-cost-economics/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260516.01.harness-cost-economics/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260516.01.harness-cost-economics/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260516.01.harness-cost-economics/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260516.01.harness-cost-economics/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260516.01.harness-cost-economics/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260516.01.harness-cost-economics/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260516.01.harness-cost-economics/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-05-16 12:29
**Current Task**: WI-1, WI-2, WI-4 Complete; WI-3, WI-5 remain
**Status**: In Progress
**Last Session**: 2026-05-17 (Session 03) — WI-2 (Resolved Model Capture) completed

## Session Progress (2026-05-17, Session 03)

- Completed WI-2 (Billing Architecture — resolved model capture):
  - Cursor runner captures `RunResult.model?.id` from SDK and sends as `resolvedModel`
  - Config model now goes to `requestedModel` (proper semantic split)
  - Server-side pricing fallback: retries with `requestedModel` when `resolvedModel` not in registry
  - Fallback records marked `COST_CALCULATION_STATUS_ESTIMATED` (no proto changes)
  - Extracted `buildTurnBillingInput` as exported pure function for testability
  - Model divergence logging when SDK reports a different model than configured
  - 8 new cursor-runner tests, 7 new stigmer-cloud handler tests
  - All 430 cursor-runner tests pass, all stigmer-cloud billing tests pass
  - Scoped down from original plan: skipped `vendor_billed_cost_micros` (no Cursor SDK billing data source yet)

## Previous Sessions

### Session 02 (2026-05-17)
- Completed WI-4 (Cursor Context Trimming)
- Made response rules conditional, omitted single-dir workspace context
- Tightened session memory budgets, lowered continuation prompt ceiling
- 19 new prompt-builder unit tests; all 422 cursor-runner tests pass

### Session 01 (2026-05-17)
- Completed WI-1 (Anthropic Prompt Caching) — discovered caching was already implemented, validated it
- Fixed CostCapMiddleware pricing accuracy (4-bucket formula with cache_creation_price)
- Confirmed 97-100% cache hit rates on system prompt + tool definitions (~10.8k tokens)

## Next Steps

1. **Run benchmarks**: `make benchmark-cost` with API keys to capture before/after token measurements (instrumentation from WI-4 is in place)
2. **Pick next work item**: WI-5 (Benchmark local vs cloud) or WI-3 (User-facing documentation)
3. WI-3 (Documentation) should come last per sequencing — it synthesizes findings from all other work items
4. WI-5 is an experiment comparing Cursor local vs cloud runtimes

## Context for Resume

- The original plan (T01_0_plan.md) has 5 work items; WI-1, WI-2, WI-4 are done
- WI-2 changes span two repos: `stigmer` (cursor-runner) and `stigmer-cloud` (billing handler)
- WI-2 scoping decisions: skipped `vendor_billed_cost_micros` (Cursor SDK has no per-call billing data), skipped reconciliation design
- `RunResult.model?.id` in production: unknown what "default" auto-select returns — need real execution data
- Benchmark results from WI-1: `test/integration/.test-output-benchmark/benchmark-results/2026-05-17-062943.json`
- Prompt-size instrumentation is live from WI-4
- Proto namespace conflict still needs fix (separate PR): move `sdk_acceptance_test.go` to its own Go module

## Quick Commands

After loading context:
- "Pick the next work item" - Choose between WI-3, WI-5
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
