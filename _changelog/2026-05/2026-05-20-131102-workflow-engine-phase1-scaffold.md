# Workflow Engine Phase 1: Core Execution Scaffold

**Date**: May 20, 2026

## Summary

Built the core TypeScript workflow execution engine scaffold as Phase 1 of the Go Zigflow engine rewrite. The engine parses CNCF Serverless Workflow DSL 1.0.0 YAMLs, evaluates jq expressions via jq-wasm, and executes task sequences with state management, flow directives, and output/export processing. This is the foundation for replacing the Go `workflow-runner` (~19K lines) with TypeScript in the unified runner.

## Problem Statement

The Stigmer platform runs three execution engines across three languages: Python (agent-runner), Go (workflow-runner), and TypeScript (cursor-runner). The unified runner migration consolidates these into a single TypeScript service. Phase 1 tackles the hardest part: porting the Go Zigflow engine's core execution kernel — YAML parsing, jq expression evaluation, sequential task iteration, and flow control.

### Pain Points

- Go workflow-runner is ~19K lines across 22 packages — significant maintenance burden in a polyglot stack
- Three languages means three build systems, three CI pipelines, three sets of dependencies
- The workflow engine is the most complex piece to rewrite (jq evaluation, Temporal determinism constraints)

## Solution

Build a self-contained `workflow-engine/` module inside the existing TypeScript runner that implements the core execution kernel: parse YAML, evaluate expressions, build and execute task chains. Phase 1 delivers set, switch, and do (nested) task types — enough to prove the architecture and execute the simplest golden YAML workflows.

## Implementation Details

### Key Architectural Discovery: Sandbox Constraint

The jq-wasm library (Emscripten-compiled WebAssembly) cannot run inside the Temporal TypeScript workflow sandbox because its loader uses `require("fs")`, `require("path")`, and `require("crypto")`. The solution: expression evaluation runs in a Temporal local activity (same worker process, minimal overhead) with batch evaluation. This is actually superior to the Go approach (`workflow.SideEffect`) because activity results are first-class history events with built-in replay determinism.

### Modules Built

| Module | LOC | Purpose |
|--------|-----|---------|
| `types.ts` | 428 | WorkflowModel, 13-variant TaskDef discriminated union, TaskBuilder interface |
| `loader.ts` | 322 | YAML → WorkflowModel with DSL version validation, tested against all 12 golden YAMLs |
| `expression.ts` | 252 | jq-wasm evaluator, recursive tree traversal, uuid preprocessing, conditional checking |
| `do-executor.ts` | 243 | Sequential task executor with if-guards, output/export, flow directives (continue/end/goto) |
| `tasks/set.ts` | 138 | State mutation via batch expression evaluation |
| `tasks/switch.ts` | 102 | Conditional branching with flow directive emission |
| `state.ts` | 69 | WorkflowState: context/data/env/input/output with jq variable bindings |
| `task-factory.ts` | 67 | Type-switch dispatch factory |

### Testing

- 119 new tests across 7 test files
- All 12 golden YAMLs parse correctly
- Full runner suite: 928 tests passing, zero regressions
- `tsc --noEmit` clean

## Benefits

- **Single-language execution tier**: One step closer to eliminating Go from the runner
- **Proven architecture**: jq-wasm activity-side evaluation pattern handles the biggest risk
- **Comprehensive types**: 13-variant discriminated union covers all CNCF task types, enabling exhaustive type checking
- **Golden YAML compatibility**: Loader tested against all 12 canonical workflows

## Impact

- Backend: `backend/services/runner/src/workflow-engine/` — new module (15 files, 3,147 LOC)
- Dependencies: `jq-wasm`, `js-yaml`, `semver` added to runner
- No changes to existing runner code — zero merge conflict risk with parallel Tier 6 work

## Related Work

- [Unified Runner Migration](../_projects/2026-05/20260518.01.unified-runner-migration/) — parent project
- [Workflow Runner TS Rewrite](../_projects/2026-05/20260519.01.workflow-runner-typescript-rewrite/) — this project
- Phase 0 validation spike completed 2026-05-19 (jq-wasm, gRPC, CNCF SDK)

---

**Status**: In Progress (Phase 1 of 9 complete)
**Timeline**: Phase 1 completed in ~30 minutes of implementation time
