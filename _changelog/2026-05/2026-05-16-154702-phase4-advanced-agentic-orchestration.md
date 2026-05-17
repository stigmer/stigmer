# Phase 4: Advanced Agentic Orchestration (T17)

**Date**: May 16, 2026

## Summary

Added three advanced orchestration capabilities to the workflow engine: `eval` (LLM-as-a-judge) task type for semantic quality assessment, `for_each` concurrency enhancement with bounded parallelism and error policies, and saga-style compensation for workflows with side effects. Five items from the original T17 scope were explicitly deferred with research-backed rationale.

## Problem Statement

Workflows lacked the ability to programmatically assess LLM output quality (only structural validation existed via `validate`), could not process collections in parallel (sequential-only `for_each`), and had no mechanism to undo completed tasks when later tasks fail within a `try_catch` scope.

### Pain Points

- No quality gate between `validate` (schema/rules) and `human_input` (manual review)
- `for_each` was sequential-only — batch LLM calls, parallel agent invocations, and data processing were artificially serialized
- Workflows with external side effects (HTTP calls, agent calls) had no compensation mechanism for saga-style rollback

## Solution

Three targeted additions, each following the established task builder and converter pipeline patterns. Research-driven scope: 3 built, 5 deferred (cache, code_execution, plan_and_execute, memory, agent_handoff — all with documented rationale).

## Implementation Details

### 1. `eval` Task Type (enum value 20)

Full vertical slice from proto to SDK:

- **Proto**: `EvalTaskConfig` with `EvalScoringMode` (pass_fail / numeric_score / multi_criteria), `EvalFailPolicy` (raise / branch / warn), `EvalCriterion` for weighted multi-axis evaluation
- **Go**: `task_builder_eval.go` + `task_builder_eval_activities.go` — judge prompt construction for 3 scoring modes, LLM call via existing `CallLlmActivities`, structured response parsing, threshold application, on_fail policy with `__stigmer_branch_override`
- **Pipeline**: `constants.go`, `task_builder.go`, `task_kind_mapping.go`, `unmarshal.go`, `task_converters.go`, `proto_to_yaml.go`
- **Registry**: Full descriptor in `task-kind-registry.json` with fields, groups, JSON Schema, output schema, YAML examples
- **SDK React**: Added to AI_KINDS categorization, validation pipeline, task labels, timeline renderer
- **Meta**: `eval.yaml` with 3 YAML examples covering all scoring modes
- **Tests**: 3 offline validation tests + 3 provider-backed execution tests

### 2. `for_each` Concurrency Enhancement

Extended existing task kind (backward compatible — all defaults preserve pre-T17 behavior):

- **Proto**: `max_parallelism` (int32), `batch_size` (int32), `ForEachErrorPolicy` enum (fail_fast / continue / skip)
- **Go**: Rewrote `task_builder_for.go` — sequential mode (default), parallel mode via `workflow.Go()` with channel-based semaphore, batch mode (chunked parallel), error aggregation per policy, result ordering preserved
- **Registry**: 3 new fields + "Concurrency" field group

### 3. Saga-Style Compensation

Workflow-level pattern via typed proto field (consistent with existing `export`/`flow` extensions):

- **Proto**: `repeated WorkflowTask compensate = 6` on `WorkflowTask`, `bool compensate = 3` on `CatchBlock`
- **Go**: `compensation.go` — `CompensationStack`, `CompensationEntry`, `RunReverse()`, `ExtractCompensationTasks()`, `CatchBlockWantsCompensation()`
- **Converter**: Compensation tasks carried through YAML pipeline via `metadata.__stigmer_compensate` (CNCF SDK model does not have native compensate field)

### Deferred Items (Research-Backed)

- **`cache`**: Should be execution policy on invocation tasks, not a visible step
- **`code_execution`**: Late-stage, governance-heavy, gravity well risk
- **`plan_and_execute`**: Contradicts "deterministic outer, autonomous inner" principle
- **`memory_recall`/`memory_write`**: Needs broader state/artifact model design
- **`agent_handoff`**: Better as `agent_call` config enrichment, not separate task kind

## Benefits

- Workflows can now gate progression on semantic quality (hallucination detection, relevance scoring, safety assessment)
- Batch processing workflows are no longer artificially serialized — bounded parallelism reduces total execution time
- Workflows with external side effects can declare compensation actions for saga-style rollback

## Impact

- 1 new proto file, 4 modified protos, stubs regenerated across Go/TS/Python
- 3 new Go files, 7 modified Go files in workflow-runner
- 6 modified React SDK files
- 1 new integration test file (6 tests), Makefile updated
- Task kind registry updated with eval descriptor + for_each concurrency fields
- Meta YAML added for eval task kind

## Related Work

- Phase 0-3 of Bring Workflows to Foreground (T02-T16)
- Agent-powered workflow generation sub-project (T16 rewrite)
- Research report: `_projects/2026-05/research.workflow-domain-foreground-strategy/04.report.gpt.md`

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~2 hours)
