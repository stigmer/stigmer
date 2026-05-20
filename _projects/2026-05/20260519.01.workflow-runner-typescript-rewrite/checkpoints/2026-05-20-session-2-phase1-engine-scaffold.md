# Session 2: Phase 1 — Core Workflow Engine Scaffold

**Date**: 2026-05-20
**Duration**: ~30 minutes
**Commit**: da74c607b

## Accomplishments

- Built the complete workflow execution kernel in `src/workflow-engine/` (15 files, 3,147 LOC)
- Ran DD-W01 sandbox spike: confirmed jq-wasm cannot run in Temporal workflow sandbox
- Designed local activity batch evaluation pattern as the expression architecture
- All 12 golden YAMLs parse correctly through our loader
- 119 new tests, 928 total passing, `tsc --noEmit` clean

## Decisions Made

1. **jq-wasm activity-side**: Emscripten-compiled WASM uses `require("fs")`, `require("path")`, `require("crypto")` — all blocked by Temporal sandbox. Expression evaluation runs in local activities.
2. **Own types, no CNCF SDK for parsing**: Direct YAML → own WorkflowModel types via js-yaml. Avoids strict validation issues and sandbox complications.
3. **`do` in Phase 1**: It IS the task iteration loop — can't execute anything without it. `for` deferred.

## Architecture

```
Activity side (full Node.js):
  loader.ts → loadWorkflowFromYaml(yaml) → WorkflowModel

Workflow sandbox (deterministic):
  executeDoTasks(tasks, input, state, doc, evaluateExpressions)
    → TaskFactory → SetTask | SwitchTask | DoTask(recursive)
    → flow directives (then/end/goto)
    → output/export processing

Expression evaluation (local activity):
  evaluateExpressionBatch(expressions, input, stateVars) → results
  Uses jq-wasm for evaluation, variable binding via __body__/__vars__ wrapping
```

## Key Code Changes

| File | LOC | Purpose |
|------|-----|---------|
| types.ts | 428 | WorkflowModel, 13-variant TaskDef union, TaskBuilder interface |
| loader.ts | 322 | YAML parsing, DSL validation, task discrimination |
| expression.ts | 252 | jq-wasm evaluation, tree traversal, uuid preprocessing |
| do-executor.ts | 243 | Sequential task execution, flow control |
| tasks/set.ts | 138 | State mutation via expression evaluation |
| tasks/switch.ts | 102 | Conditional branching |
| state.ts | 69 | WorkflowState implementation |
| task-factory.ts | 67 | Type-switch dispatch factory |
| 7 test files | 1,526 | 119 tests |

## Learnings

- jq-wasm variable injection works via expression wrapping: `.__vars__.["$context"] as $context | .__body__ | <expr>`
- Set task expressions in Go evaluate with null jq input (`.` is null) — must use `$data`, `$context` etc.
- The Go engine is NOT a graph walker — it's an interpreter over an ordered task list with name-based jumps
- `structuredClone` is available in Node 20+ and works well for deep cloning in the sandbox

## Next Session Plan

1. Phase 2: Add `for` task (iteration with state isolation, `$data.item` binding)
2. Phase 3: Wire expression evaluation as a Temporal local activity
3. Phase 4: Start external call tasks (call:http is the most used in golden YAMLs)
