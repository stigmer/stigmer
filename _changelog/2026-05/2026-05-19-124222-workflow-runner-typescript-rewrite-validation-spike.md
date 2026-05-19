# Workflow Runner TypeScript Rewrite — Phase 0 Validation Spike Complete

**Date**: May 19, 2026

## Summary

Completed the Phase 0 validation spike for rewriting the Go-based workflow-runner (Zigflow/CNCF Serverless Workflow engine, ~19K lines) in TypeScript. All three highest-risk dependencies — jq expression evaluation, dynamic gRPC invocation, and CNCF Serverless Workflow SDK parsing — have been validated with working PoC code against real golden YAML files. Gate decision: **CONDITIONAL GO** at ~85% confidence (up from 70% pre-spike).

## Problem Statement

The Stigmer platform runs three separate execution engines in three languages: Python (agent-runner), TypeScript (cursor-runner), and Go (workflow-runner). The unified-runner-migration project is consolidating these into a single TypeScript runner. The workflow-runner is the last and largest (~19K lines of Go) — before committing to a 4-6 month rewrite, we needed to validate that the three most uncertain TypeScript dependencies could replicate what Go does.

### Pain Points

- No prior evidence that TypeScript could evaluate jq expressions with the same correctness and performance as Go's `gojq` library
- Dynamic gRPC invocation (loading protos at runtime, invoking RPCs without code generation) had not been tested in Node.js for our use case
- The CNCF Serverless Workflow TypeScript SDK had never been tested against our actual golden YAML files, which use Zigflow-specific extensions

## Solution

Built a standalone PoC project with three validation scripts that test each dependency against real golden YAML files and Go source patterns. Each script produces structured results and a pass/fail assessment.

## Implementation Details

**T01a — jq Expression Evaluation**: Evaluated two candidates (`jq-wasm` WASM in-process, `node-jq` subprocess). Extracted 27 test cases from 12 golden YAMLs covering path access, arithmetic, comparisons, object merges, pipe chains, context variables, and builtins. Both libraries passed — jq-wasm at 0.66ms avg latency (in-process, like Go's gojq), node-jq at 2.85ms (subprocess). Custom variable injection (`$context`, `$data`) works via expression wrapping.

**T01b — Dynamic gRPC Invocation**: Built a test gRPC server and validated `@grpc/proto-loader` + `@grpc/grpc-js` for dynamic proto loading, unary RPC with nested messages/enums/repeated fields, and error handling (NOT_FOUND, INVALID_ARGUMENT, UNAVAILABLE, method not found). 7/7 tests passed.

**T01c — CNCF Serverless Workflow SDK**: Validated `@serverlessworkflow/sdk@1.0.1` against all 12 golden YAMLs. Found that the SDK's strict Ajv validation rejects `document.description` (a Zigflow extension). Workaround: use constructor hydration (`new Workflow(parsed)`) instead of `Workflow.deserialize()`, which matches Go's approach. All 12 YAMLs parse, task types are distinguishable, custom CallFunction extensions (call:llm, call:agent, etc.) are preserved, and 33 expressions are accessible in the model.

## Benefits

- Confidence in the TypeScript rewrite increased from 70% to ~85%
- Three critical risk areas now have validated, documented workarounds
- The PoC code serves as a reference for Phase 1 implementation
- jq-wasm discovery (0.66ms vs Go's ~microsecond) proves in-process jq is feasible in TypeScript without external binary dependencies

## Impact

- Unblocks Phase 1 (Core Engine Scaffold) of the workflow-runner TypeScript rewrite
- Establishes the technology stack for the jq engine, gRPC client, and workflow model layer
- The three conditions documented in the gate decision will become design decisions in Phase 1

## Related Work

- Unified runner migration (`20260518.01.unified-runner-migration`) — prerequisite project, Phase 1 complete
- Workflow orchestration engine (`20260108.02.workflow-orchestration-engine`) — original Go implementation

---

**Status**: CONDITIONAL GO (proceed to Phase 1 with documented conditions)
**Timeline**: 1 session (~2 hours)
