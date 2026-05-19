# Task T01: Validation Spike — jq + gRPC + CNCF SDK (Phase 0, Hard Gate)

**Created**: 2026-05-19
**Status**: PENDING REVIEW
**Type**: Research Spike / PoC Validation

⚠️ **This plan requires your review before execution**

## Objective

Validate the three highest-risk TypeScript dependencies for the workflow-runner rewrite via working PoC code. This is a **hard gate** — if any critical capability fails, the project is reconsidered.

## Background

Deep Research (ChatGPT) assessed the TypeScript rewrite at **70% confidence**. The three areas flagged as highest risk are:

1. **jq expression evaluation** — Zigflow uses jq pervasively (~200+ expressions across tasks). `node-jq` shells out to jq binary. Need to validate: correctness, performance, edge cases.
2. **Dynamic gRPC invocation** — `@grpc/proto-loader` can load protos at runtime. Need to validate: nested packages, reflection-free invocation, error handling.
3. **CNCF Serverless Workflow SDK** — `@serverlessworkflow/sdk` exists. Need to validate: can parse our actual golden YAML files, model matches what Zigflow expects, custom task types (call_llm, call_agent) handled.

## Sub-Tasks

### T01a: jq Expression Validation

**Goal**: Extract real jq expressions from golden test YAMLs and Go source, run them through `node-jq` in TypeScript, verify identical output.

**Steps**:
1. Extract all unique jq expressions from the 12 golden YAML test files
2. Extract jq expressions from Go source (`pkg/utils/runtime_expressions.go`, task builders)
3. Create a PoC TypeScript script that:
   - Loads sample JSON state objects
   - Runs each extracted jq expression via `node-jq`
   - Compares output to expected values
4. Benchmark: measure latency per call (target: <20ms for simple expressions)
5. Test edge cases: string interpolation (`${ ... }`), nested paths, try-catch in jq, reduce, custom functions
6. Assess: can we batch expressions? Is there a long-running jq process option?

**Pass criteria**: 95%+ of extracted expressions produce correct output. Performance is acceptable (<20ms per call for typical expressions).

### T01b: Dynamic gRPC Invocation Validation

**Goal**: Validate that `@grpc/proto-loader` + `@grpc/grpc-js` can replicate what Go's `grpcurl` does.

**Steps**:
1. Take a sample .proto file used by the workflow-runner's `call_grpc` task
2. Create a PoC that dynamically loads the proto, creates a client, and invokes a method
3. Test: nested packages, repeated fields, enum handling
4. Verify error handling (connection refused, method not found, timeout)
5. Compare behavior to Go's grpcurl library

**Pass criteria**: Dynamic invocation works for all proto patterns used in our workflows. Error handling is equivalent.

### T01c: CNCF Serverless Workflow SDK Validation

**Goal**: Validate that `@serverlessworkflow/sdk` can parse our actual workflow YAML files and expose a usable model.

**Steps**:
1. Install `@serverlessworkflow/sdk` (latest)
2. Feed it the 12 golden test YAML files — verify all parse successfully
3. Traverse the parsed model: verify task types, structure, metadata are accessible
4. Test custom extensions: our `call_llm` and `call_agent` use `CallFunction` with custom call types — verify these are preserved
5. Test serialization round-trip: parse → modify → serialize → parse again
6. Assess: does the SDK's validation match what our Go code validates?

**Pass criteria**: All 12 golden YAMLs parse correctly. Custom call types are accessible. Model provides sufficient structure for building a task executor.

### T01d: Gate Decision

After T01a-c, write a gate decision document:
- **GO**: All three capabilities validated, proceed to Phase 1
- **CONDITIONAL GO**: Minor issues found with documented workarounds, proceed with caveats
- **NO-GO**: Critical capability missing, reassess approach (fall back to Option B)

## Technical Approach

Create a PoC project at `_projects/2026-05/20260519.01.workflow-runner-typescript-rewrite/poc/`:

```
poc/
├── package.json
├── tsconfig.json
├── src/
│   ├── t01a-jq-validation.ts
│   ├── t01b-grpc-validation.ts
│   ├── t01c-cncf-sdk-validation.ts
│   └── fixtures/
│       ├── jq-expressions.json     (extracted from golden YAMLs)
│       ├── sample-state.json       (representative workflow state)
│       └── sample.proto            (from workflow-runner tests)
└── results/
    ├── jq-benchmark.md
    ├── grpc-results.md
    └── sdk-results.md
```

## Dependencies

- Node.js 20+
- `node-jq` (npm)
- `@grpc/proto-loader` + `@grpc/grpc-js` (npm)
- `@serverlessworkflow/sdk` (npm)
- Access to golden test YAML files at `backend/services/workflow-runner/test/golden/`

## Estimated Effort

- T01a (jq): 1-2 sessions
- T01b (gRPC): 1 session
- T01c (CNCF SDK): 1 session
- T01d (gate decision): document findings

**Total**: 2-3 days

## Relationship to Unified Runner Migration

This project is a **follow-on** to `20260518.01.unified-runner-migration`. It assumes:
- Unified runner Phase 1-2 is complete (runner scaffold exists)
- The new unified runner at `backend/services/runner/` handles ExecuteDeepAgent and ExecuteCursor
- This project adds ExecuteServerlessWorkflow to that same runner

If this spike passes, the full migration phases are:

| Phase | Name | Est. Weeks | Status |
|-------|------|-----------|--------|
| 0 | Validation Spike (T01) — jq, gRPC, CNCF SDK | 0.5 | THIS TASK |
| 1 | Core Engine Scaffold — YAML parsing, task graph builder | 2-3 | Blocked on Phase 0 |
| 2 | Simple Task Types — set, switch, foreach, parallel, do | 3-4 | Blocked on Phase 1 |
| 3 | Expression Engine — jq integration, runtime expressions | 1-2 | Blocked on Phase 1 |
| 4 | External Call Tasks — call_http, call_grpc, call_llm, call_agent | 3-4 | Blocked on Phase 2 |
| 5 | Advanced Tasks — try/catch, wait/listen, emit_event, notification, human_input | 2-3 | Blocked on Phase 2 |
| 6 | Supporting Infrastructure — claimcheck, heartbeat, interceptors, OTel | 2-3 | Blocked on Phase 4 |
| 7 | Integration Testing — 12 golden YAMLs, regression suite | 3-4 | Blocked on Phase 5 |
| 8 | Deployment & Cutover — Docker, CI, gradual rollout | 2-3 | Blocked on Phase 7 |
| 9 | Cleanup — Delete Go workflow-runner, update CI | 1 | Blocked on Phase 8 |

**Total estimated: 20-28 weeks** (AI-assisted, ~4-6 months)

## Key References

- **Deep Research report**: `_projects/2026-05/20260518.01.unified-runner-migration/research.workflow-runner-typescript-rewrite-feasibility/04.report.gpt.md`
- **Go workflow-runner source**: `backend/services/workflow-runner/`
- **Golden test YAMLs**: `backend/services/workflow-runner/test/golden/`
- **Zigflow engine core**: `backend/services/workflow-runner/pkg/zigflow/`
- **Runtime expressions (jq)**: `backend/services/workflow-runner/pkg/utils/runtime_expressions.go`
- **Unified runner migration project**: `_projects/2026-05/20260518.01.unified-runner-migration/`

## Review Process

**What happens next**:
1. **You review this plan** - Consider the spike approach and pass criteria
2. **Provide feedback** - Concerns, changes, or approval
3. **I'll revise if needed** - Update based on your feedback
4. **You approve** - Execution begins
5. **Spike runs** - PoC code written and validated in a Cursor session

**Please consider**:
- Are the pass criteria appropriate?
- Should any additional capabilities be spiked?
- Is the phased roadmap (post-spike) reasonable?
- Any concerns about the jq subprocess approach?
