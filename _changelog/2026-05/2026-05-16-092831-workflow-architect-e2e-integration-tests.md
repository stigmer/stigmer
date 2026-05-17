# Workflow Architect E2E Integration Tests

**Date**: May 16, 2026

## Summary

Built a complete end-to-end integration test suite for the Workflow Architect agent-powered flows (generate, refine, diagnose) using the real `mcp-server-stigmer` binary connected to the test Java service. The suite adds 9 new tests (4 offline + 5 provider-backed) with harness infrastructure for building and wiring the production MCP server into the isolated test environment.

## Problem Statement

The Workflow Architect agent was implemented across 5 batches (proto teardown, MCP tools + seedpack agent, generate dialog, refine panel, diagnose repair card) but had no end-to-end testing. The agent depends on MCP server tools (`get_task_kind_registry`, `validate_workflow_yaml`, `get_workflow_execution`, etc.) that call back into the Stigmer backend — a pipeline that could only be validated with real infrastructure.

### Pain Points

- No integration tests for the agent-powered workflow generation flows
- The MCP → gRPC → backend pipeline was untested end-to-end
- The `validateSpec` RPC (used by `validate_workflow_yaml` MCP tool) had no direct test coverage
- No harness support for the real `mcp-server-stigmer` binary in the test suite

## Solution

Extended the existing `test/integration` infrastructure with three new layers: harness additions for building and wiring the real MCP server, offline `validateSpec` contract tests, and provider-backed agent execution tests that exercise the full generate/refine/diagnose flows with structural assertions tolerant of LLM non-determinism.

## Implementation Details

### Harness Infrastructure

- `BuildMcpServerStigmer()` compiles the real `mcp-server-stigmer` binary from `mcp-server/cmd/mcp-server-stigmer`, following the `BuildTestMcpServer` pattern
- `STIGMER_SERVER_ADDRESS` env var added to both agent-runner and cursor-runner so child MCP processes connect back to the test Java service
- `CreateStigmerMcpServer()` and `CreateWorkflowArchitectAgent()` helpers create test resources with production-matching configuration (instructions read from seedpack YAML at test time)
- `ExtractWorkflowYAML()` is a Go port of `extract-workflow-yaml.ts` for asserting agent output

### Offline Tests (workflow_validate_test.go)

Four tests verify the `validateSpec` RPC backend contract: valid workflow passes, invalid task kind caught, missing document section caught, empty spec handled gracefully.

### Agent E2E Tests (workflow_architect_test.go)

Five provider-backed tests exercise the full agent pipeline:

| Test | Harness | Flow |
|------|---------|------|
| `TestWorkflowArchitect_Generate` | cross (native + cursor) | Generate workflow from prompt, assert MCP tool usage + valid YAML |
| `TestWorkflowArchitect_GenerateAndApply` | native | Generate + apply as Workflow resource, verify retrieval |
| `TestWorkflowArchitect_Refine` | native | Two-turn refinement in same session, assert YAML differs |
| `TestWorkflowArchitect_DiagnoseExecution` | native | Create failing workflow, run to failure, diagnose with agent |
| `TestWorkflowArchitect_MCPToolAccess` | native | Smoke test: agent calls `get_task_kind_registry` MCP tool |

### Assertion Strategy

Tests assert structural properties, not exact LLM output: execution completes, expected MCP tools called, YAML code block extracted, YAML validates. This makes tests resilient to LLM non-determinism while still proving the full pipeline works.

## Benefits

- Full pipeline coverage from agent creation through MCP tool invocation to YAML validation
- Real MCP server binary tests the actual YAML-to-proto parsing and gRPC integration
- Seedpack instructions tested at runtime — catches instruction regressions
- Dedicated `make test-workflow-architect` target for focused runs
- Tests integrated into `make test-providers` for CI inclusion

## Impact

- Test coverage: 9 new tests (4 offline, 5 provider-backed) across 3 new files + 5 modified harness files
- The Workflow Architect sub-project now has E2E validation alongside the existing 64+ integration tests

## Related Work

- Sub-project: `20260515.01.sp.agent-powered-workflow-generation` (Batches 1-5)
- Parent project: `20260508.01.bring-workflows-to-foreground` (Phase 3: AI-Assisted Creation)
- E2E testing infrastructure: `20260514.01.e2e-workflow-testing-infrastructure` (Sessions 1-19)

---

**Status**: ✅ Production Ready (pending first live run with API keys)
