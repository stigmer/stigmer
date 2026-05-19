# Next Task: 20260519.01.workflow-runner-typescript-rewrite

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260519.01.workflow-runner-typescript-rewrite

**Description**: Rewrite the Go-based workflow-runner (Zigflow/CNCF Serverless Workflow engine) in TypeScript and merge it into the unified TypeScript runner, eliminating Go from the runner execution tier entirely.
**Goal**: Single TypeScript runner service that handles all three execution types: ExecuteDeepAgent, ExecuteCursor, and ExecuteServerlessWorkflow. Go workflow-runner deleted after validated cutover. All 12 golden YAML workflows passing identically in TypeScript.
**Tech Stack**: TypeScript/Node.js, Temporal TypeScript SDK, @serverlessworkflow/sdk (CNCF), node-jq, @grpc/proto-loader, @grpc/grpc-js, Ajv (JSON Schema), openai/anthropic SDKs, @aws-sdk/client-s3, @opentelemetry/api, Vitest

## Current Status

**Created**: 2026-05-19
**Current Task**: T01 — Validation Spike (Phase 0, Hard Gate)
**Status**: COMPLETE — CONDITIONAL GO
**Last Session**: 2026-05-19, Session 1

## Session Progress (2026-05-19, Session 1)

### Accomplishments
- Completed Phase 0 validation spike (T01a, T01b, T01c, T01d)
- **T01a (jq)**: Validated both `jq-wasm` (0.66ms avg, 92.6% pass) and `node-jq` (2.85ms avg, 100% pass). jq-wasm recommended as primary engine.
- **T01b (gRPC)**: Validated `@grpc/proto-loader` + `@grpc/grpc-js` for dynamic invocation. 7/7 tests passed (nested messages, enums, error handling).
- **T01c (CNCF SDK)**: Validated `@serverlessworkflow/sdk@1.0.1`. All 12 golden YAMLs parse via constructor hydration (skip strict validation). Custom CallFunction extensions preserved. Expression detection trivial to implement.
- **T01d (Gate)**: Wrote gate decision document — CONDITIONAL GO at ~85% confidence (up from 70%).

### Key Decisions
- **jq-wasm is the recommended jq engine** — in-process WASM, sub-millisecond latency, no binary dependency
- **CNCF SDK works with a workaround** — use `new Workflow(parsed)` instead of `Workflow.deserialize()` to avoid strict schema validation rejecting `document.description`
- **Expression detection is manual** — SDK doesn't provide `isStrictExpr`/`sanitizeExpr`, but they're trivial (5 lines each)
- **Custom `call:` extensions are first-class** — call:llm, call:agent, etc. preserved via CallFunction

### Key Findings
- Go uses `gojq` (in-process), not subprocess — TypeScript can match with jq-wasm
- Go uses `grpcurl` library — TypeScript matches with `@grpc/proto-loader`
- Go uses `sdk-go/v3` for YAML parsing — TypeScript matches with `@serverlessworkflow/sdk@1.0.1`
- Two separate jq evaluation paths exist: runtime expressions (with state variables) and transform (raw input)
- `uuid()` is the only custom jq function — pre-processing workaround is trivial

### Files Created
- `_projects/2026-05/20260519.01.workflow-runner-typescript-rewrite/poc/` — full PoC project
  - `src/t01a-jq-validation.ts` — jq expression evaluation tests
  - `src/t01b-grpc-validation.ts` — dynamic gRPC invocation tests
  - `src/t01c-cncf-sdk-validation.ts` — CNCF SDK parsing tests
  - `src/fixtures/jq-expressions.json` — 27 test cases extracted from golden YAMLs
  - `src/fixtures/sample-state.json` — representative workflow state
  - `src/fixtures/sample.proto` — test proto for gRPC validation
  - `results/jq-results.md` — T01a detailed results
  - `results/grpc-results.md` — T01b detailed results
  - `results/sdk-results.md` — T01c detailed results
  - `results/gate-decision.md` — T01d gate decision (CONDITIONAL GO)

## Next Steps

1. **Phase 1: Core Engine Scaffold** — YAML parsing, task graph builder, basic expression evaluation
   - Blocked on unified-runner-migration Phase 2 (shared MCP/checkpointer/status)
   - Can start engine design work independently
2. Create design decision documents for the three conditions identified in the gate decision
3. Review gate decision with stakeholder before proceeding

## Context for Resume

- The PoC code at `poc/` is throwaway — it validated feasibility, not production patterns
- The unified runner at `backend/services/runner/` already has ExecuteCursor ported; this project adds ExecuteServerlessWorkflow
- The Go workflow-runner at `backend/services/workflow-runner/` (~19K lines, 22 packages) is the reference implementation
- Key condition: CNCF SDK must be used without strict validation (constructor hydration path)

## Prior Research

Deep Research (ChatGPT) assessed the rewrite at **~70% confidence**. Key findings:
- CNCF Serverless Workflow TypeScript SDK exists and is actively maintained
- Temporal TypeScript SDK has full parity with Go
- jq is the #1 risk — no native TS implementation, must use `node-jq` (subprocess to real jq binary)
- Dynamic gRPC via `@grpc/proto-loader` is ready
- JSON Schema validation (Ajv) supports Draft 2020-12

Full report: `_projects/2026-05/20260518.01.unified-runner-migration/research.workflow-runner-typescript-rewrite-feasibility/04.report.gpt.md`

## Migration Phases (Full Roadmap)

| Phase | Name | Est. Weeks | Status |
|-------|------|-----------|--------|
| 0 | Validation Spike (T01) — jq, gRPC, CNCF SDK | 0.5 | COMPLETE (CONDITIONAL GO) |
| 1 | Core Engine Scaffold — YAML parsing, task graph builder | 2-3 | Blocked on Phase 0 (now unblocked) |
| 2 | Simple Task Types — set, switch, foreach, parallel, do | 3-4 | Blocked on Phase 1 |
| 3 | Expression Engine — jq integration, runtime expressions | 1-2 | Blocked on Phase 1 |
| 4 | External Call Tasks — call_http, call_grpc, call_llm, call_agent | 3-4 | Blocked on Phase 2 |
| 5 | Advanced Tasks — try/catch, wait/listen, emit_event, notification, human_input | 2-3 | Blocked on Phase 2 |
| 6 | Supporting Infrastructure — claimcheck, heartbeat, interceptors, OTel | 2-3 | Blocked on Phase 4 |
| 7 | Integration Testing — 12 golden YAMLs, regression suite | 3-4 | Blocked on Phase 5 |
| 8 | Deployment & Cutover — Docker, CI, gradual rollout | 2-3 | Blocked on Phase 7 |
| 9 | Cleanup — Delete Go workflow-runner, update CI | 1 | Blocked on Phase 8 |

## Key References

- **Go workflow-runner**: `backend/services/workflow-runner/` (~19K lines, 22 packages)
- **Zigflow engine core**: `backend/services/workflow-runner/pkg/zigflow/` (~12.7K lines)
- **Golden test YAMLs**: `backend/services/workflow-runner/test/golden/` (12 canonical workflows)
- **Runtime expressions**: `backend/services/workflow-runner/pkg/utils/runtime_expressions.go`
- **Unified runner project**: `_projects/2026-05/20260518.01.unified-runner-migration/`
- **PoC results**: `_projects/2026-05/20260519.01.workflow-runner-typescript-rewrite/poc/results/`

---

*This file provides direct paths to all project resources for quick context loading.*
