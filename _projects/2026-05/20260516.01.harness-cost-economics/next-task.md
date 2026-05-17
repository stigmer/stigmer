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
**Current Task**: All work items complete (WI-1 through WI-5)
**Status**: Complete
**Last Session**: 2026-05-17 (Session 05) — WI-3 (Billing Strategy + Documentation) completed

## Session Progress (2026-05-17, Session 05)

- Completed WI-3 (Billing Strategy + User-Facing Documentation):
  - **Strategic decision**: Moved from tiered markup (5 policies, 5-35%) to flat per-harness markup (20% native, 10% cursor)
  - **Design decision doc**: DD-001-flat-markup-strategy.md with competitive analysis, rationale, and future evolution path
  - **Migration**: U20260517_FlatMarkupBillingPolicies.java — deactivates v1 policies, seeds native-v2 (12000bp) and cursor-v2 (11000bp)
  - **BillingPolicyService fallback**: resolvePolicy() now falls back to costTier="default" when tier-specific policy not found
  - **Unit tests**: 5 new tests for fallback behavior (tier exists, tier missing, double-fallback prevention, full v2 resolution)
  - **docs/concepts/billing.mdx**: Replaced tiered markup examples with flat "20% native, 10% cursor" language + callout to optimization guide
  - **docs/guides/runners/cost-optimization.mdx**: New guide with harness economics, prompt caching math, decision matrix, practical tips
  - **docs/concepts/harnesses.mdx**: Expanded comparison table with commission, overhead, caching, and latency rows + cost considerations section

## Previous Session (2026-05-17, Session 04)

- Completed WI-5 (Benchmark — Cursor Local vs Cloud Runtime):
  - Verified stigmer-server persists `cursor_mode` on Session Create (proto.Clone preserves all spec fields)
  - Extended `CreateTestSession` with `SessionOption` functional options pattern (`WithCursorMode`, `WithWorkspaceEntries`)
  - Added `CursorMode` field to `BenchmarkResult` for cursor-mode-aware reporting
  - New `RunCursorModeBenchmark` helper: creates session with explicit CursorMode, runs prompt, collects usage
  - New `CompareCursorModes` comparison function: latency ratio, token delta, model match, cost ratio
  - New `CursorModeReport`/`CursorModeSummary` types with `WriteCursorModeReport` for persistence
  - Three new benchmark tests: Simple, MediumContext, Report (aggregate with JSON output)
  - New `make benchmark-cursor-modes` target (requires only CURSOR_API_KEY, sets STIGMER_CURSOR_CLOUD_MODE_ENABLED=true)
  - Cloud sessions use git repo workspace entries (stigmer repo main branch) to trigger CLOUD mode
  - No cursor-runner code changes — entirely test/benchmark infrastructure
  - All integration tests compile and vet clean

## Previous Sessions

### Session 03 (2026-05-17)
- Completed WI-2 (Billing Architecture — resolved model capture)
- Cursor runner captures `RunResult.model?.id` from SDK and sends as `resolvedModel`
- Config model now goes to `requestedModel` (proper semantic split)
- Server-side pricing fallback: retries with `requestedModel` when `resolvedModel` not in registry
- All 430 cursor-runner tests pass, all stigmer-cloud billing tests pass

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

All 5 work items are complete. Remaining operational tasks:

1. **Run cursor mode benchmarks**: `make benchmark-cursor-modes` with CURSOR_API_KEY to capture actual local vs cloud data
2. **Deploy migration**: Run U20260517_FlatMarkupBillingPolicies in staging/production to activate v2 policies
3. **Verify pricing page**: After migration, confirm `/api/v1/public/model-pricing` returns flat 20%/10% rates
4. **Create PRs**: One for stigmer (docs), one for stigmer-cloud (migration + service change)

## Context for Resume

- All 5 work items from T01_0_plan.md are complete
- WI-3 scope expanded: became a pricing strategy overhaul (flat markup) + documentation, not just a docs page
- Design decision DD-001 documents the rationale for 20%/10% flat rates
- Migration deactivates v1 tiered policies and seeds v2 flat policies with costTier="default"
- BillingPolicyService.resolvePolicy() now has a fallback: (harness, tier) → (harness, "default")
- The model registry retains `costTier` for analytics; it no longer drives markup differentiation
- WI-5 cloud sessions require git repo workspace entries and STIGMER_CURSOR_CLOUD_MODE_ENABLED=true on the cursor-runner
- WI-2 changes span two repos: `stigmer` (cursor-runner) and `stigmer-cloud` (billing handler)
- Proto namespace conflict still needs fix (separate PR): move `sdk_acceptance_test.go` to its own Go module

## Quick Commands

After loading context:
- "Pick the next work item" - WI-3 (documentation) is the only remaining item
- "Run cursor mode benchmarks" - `make benchmark-cursor-modes`
- "Run cost benchmarks" - `make benchmark-cost`
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress

---

*This file provides direct paths to all project resources for quick context loading.*
