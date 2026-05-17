# Seedpack Workflow Integration Tests

**Date**: May 17, 2026

## Summary

Added end-to-end integration tests for the three seedpack workflows (content-review-pipeline, support-ticket-triage, research-and-summarize). This required building a YAML-to-proto loader in the test harness, extending the fixture deployer with runtime environment variable support, and writing test cases that handle human-in-the-loop approval gates programmatically.

## Problem Statement

The seedpack workflows serve as reference implementations shipped with every Stigmer server, but had zero integration test coverage. There was no way to verify that changes to the workflow engine, proto definitions, or seedpack YAML didn't break these production-visible workflows.

### Pain Points

- Seedpack workflows could silently break without any test signal
- No existing mechanism to load workflow YAML files from disk into integration tests (all existing tests build protos programmatically)
- No way to pass runtime environment variables through the `DeployAndExecute` test helper
- Human-input gates in workflows required a polling mechanism to detect when the gate was reached before submitting approval

## Solution

Built three harness extensions and a comprehensive test file that exercises all three seedpack workflows through the real execution pipeline (Java service, Temporal, workflow-runner, LLM providers).

## Implementation Details

### YAML-to-Proto Loader (`harness/seedpack_loader.go`)

Ported the `parseWorkflowYAML` function from the MCP server into the test harness. The function reads YAML from disk, maps task kind string names to proto enum values, and uses `protojson.Unmarshal` to produce a typed `*workflowv1.Workflow` proto. Provides three entry points:

- `LoadSeedpackWorkflow(filename)` — loads from `seedpack/workflows/` by filename
- `LoadWorkflowFromYAML(path)` — loads from any absolute path
- `ParseWorkflowYAML(yamlContent)` — parses a YAML string directly

### Runtime Env Support (`fixture.go`)

Added `DeployAndExecuteWithEnv` to `FixtureDeployer`, which sets `RuntimeEnv` on the `WorkflowExecutionSpec`. This allows seedpack workflows to receive their required inputs (TOPIC, TICKET_DESCRIPTION, SOURCE_MATERIAL, etc.) at execution time.

### Approval Gate Polling (`assertions.go`)

Added `WaitForTaskWaitingApproval` to `ExecutionWaiter`, which polls until a named task reaches `WORKFLOW_TASK_WAITING_APPROVAL` status. Unlike the existing HITL tests that use `time.Sleep(3s)` (sufficient when the gate is the first task), seedpack workflows have LLM calls before the human_input gate, making arrival time unpredictable.

### Test Cases (`workflow_seedpack_test.go`)

| Test | Workflow | Task Kinds Exercised | API Keys |
|------|----------|---------------------|----------|
| `LoadAll` | All three | YAML parsing only | None |
| `ContentReviewPipeline` | content-review-pipeline | llm_call, human_input, transform | ANTHROPIC |
| `SupportTicketTriage` | support-ticket-triage | llm_call, switch_case, human_input, transform | OPENAI |
| `ResearchAndSummarize` | research-and-summarize | llm_call, fork, transform, human_input | Both |

The triage test handles non-deterministic LLM routing — the severity classification determines whether the human_input gate fires (critical path) or the workflow completes automatically (non-critical path).

## Benefits

- Seedpack workflows now have automated regression coverage
- Any proto, engine, or YAML change that breaks a seedpack workflow will be caught
- The YAML loader and env support are reusable for future seedpack workflows
- The `WaitForTaskWaitingApproval` helper benefits any test with unpredictable gate timing

## Impact

- **Test harness**: 3 new public APIs (`LoadSeedpackWorkflow`, `DeployAndExecuteWithEnv`, `WaitForTaskWaitingApproval`)
- **Test coverage**: 4 new test functions covering all 3 seedpack workflows
- **Files**: 2 new, 2 modified (all in `test/integration/`)

## Related Work

- Integration test gap analysis (Session 32) — identified seedpack coverage as a gap
- Seedpack workflow addition (Session 32) — the workflows being tested
- HITL integration tests (Session 8) — pattern for human_input approval via gRPC API

---

**Status**: Production Ready
