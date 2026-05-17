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
**Current Task**: WI-1 Complete, ready for WI-2 or WI-4
**Status**: In Progress
**Last Session**: 2026-05-17 — WI-1 (Prompt Caching) validated and completed

## Session Progress (2026-05-17)

- Completed WI-1 (Anthropic Prompt Caching) — discovered caching was already implemented, validated it, fixed CostCapMiddleware pricing accuracy
- Ran `make benchmark-cost` — confirmed 97-100% cache hit rates on system prompt + tool definitions (~10.8k tokens)
- Confirmed Layer 3 (automatic conversation caching via top-level `cache_control`) is the correct Anthropic API mechanism
- Added `cache_creation_price_per_million` to CostCapMiddleware 4-bucket formula
- Found proto namespace conflict blocking benchmarks (workaround: `GOLANG_PROTOBUF_REGISTRATION_CONFLICT=warn`)

## Next Steps

1. Pick next work item: WI-2 (Billing Architecture) or WI-4 (Cursor Context Trimming) — both are independent
2. WI-2 spans two repos (stigmer + stigmer-cloud), involves proto changes
3. WI-4 is contained in the cursor-runner, involves auditing context overhead
4. WI-3 (Documentation) and WI-5 (Benchmark local vs cloud) come last per the sequencing in T01_0_plan.md

## Context for Resume

- The original plan (T01_0_plan.md) has 5 work items; WI-1 is done
- Benchmark results are in `test/integration/.test-output-benchmark/benchmark-results/2026-05-17-062943.json`
- Session checkpoint: `checkpoints/2026-05-17-session-01.md`
- Proto namespace conflict needs a proper fix (separate PR): move `sdk_acceptance_test.go` to its own Go module

## Quick Commands

After loading context:
- "Pick the next work item" - Choose between WI-2, WI-4
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
