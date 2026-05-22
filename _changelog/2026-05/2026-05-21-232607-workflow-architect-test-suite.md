# Workflow Architect Complete Test Suite

**Date**: May 21, 2026

## Summary

Added comprehensive test coverage for the Workflow Architect agent-powered generate/refine/diagnose pipeline. This fills a significant gap where the entire Refine, Generate, and Diagnose UI surface had zero unit tests, zero component tests, and zero E2E tests — with only 5 Go integration tests providing any coverage. The suite adds 98 test cases across 10 new files spanning 5 layers: pure utility tests, behavior hook tests, component render tests, Playwright E2E, and Go integration enhancements.

## Problem Statement

The Workflow Architect is a core platform capability that powers the "Refine with AI" panel in the workflow editor, the "Generate Workflow" dialog, and the "AI Diagnosis" repair card. After the unified runner migration removed the old `refineWorkflow` / `generateWorkflowFromPrompt` / `diagnoseWorkflowExecution` RPCs and replaced them with agent-powered flows, the only test coverage was 5 Go integration tests in `workflow_architect_test.go`.

### Pain Points

- Zero React SDK unit tests for `useRefineWorkflowFlow`, `useWorkflowArchitectFlow`, `useDiagnoseExecutionFlow`, `extractWorkflowYaml`, or `computeUnifiedDiff`
- Zero component render tests for `WorkflowRefinePanel`, `WorkflowArchitectDialog`, `WorkflowRepairCard`
- Zero Playwright E2E tests for the Refine button/panel in the workflow editor
- The existing `GenerateAndApply` Go test used a hardcoded proto instead of agent-generated YAML
- The harness `workflowArchitectEnabledTools` list was "kept in sync manually" with the seedpack — no automated drift detection
- A bug in `WorkflowRepairCard` "Try Again" flow was undiscovered (reset doesn't re-trigger autoStart)

## Solution

Implemented a 5-layer test pyramid following existing SDK conventions:

- **Layer A**: Pure utility tests (Vitest, zero mocks) for `extractWorkflowYaml` and `computeUnifiedDiff`
- **Layer B**: Behavior hook tests (Vitest, `vi.mock` dependency hooks) for all 3 flow hooks
- **Layer C**: Component render tests (Vitest, `vi.mock` composed hooks) for all 3 UI components
- **Layer D**: Playwright interactive E2E for the workflow editor Refine panel
- **Layer E**: Go integration test enhancements including RefineAndApply round-trip, DiagnoseAndRepair validation, and automated seedpack drift detection

## Implementation Details

### New Files (10)

| File | Layer | Tests |
|------|-------|-------|
| `sdk/react/src/workflow/__tests__/extract-workflow-yaml.test.ts` | A | 12 |
| `sdk/react/src/workflow/__tests__/workflow-yaml-diff.test.ts` | A | 9 |
| `sdk/react/src/workflow/__tests__/useRefineWorkflowFlow.test.tsx` | B | 14 |
| `sdk/react/src/workflow/__tests__/useWorkflowArchitectFlow.test.tsx` | B | 12 |
| `sdk/react/src/workflow/__tests__/useDiagnoseExecutionFlow.test.tsx` | B | 13 |
| `sdk/react/src/workflow/__tests__/WorkflowRefinePanel.test.tsx` | C | 10 |
| `sdk/react/src/workflow/__tests__/WorkflowArchitectDialog.test.tsx` | C | 9 |
| `sdk/react/src/workflow/__tests__/WorkflowRepairCard.test.tsx` | C | 10 |
| `test/e2e/tests/interactive/workflow-editor-refine.spec.ts` | D | 6 |
| *(3 tests added to existing `workflow_architect_test.go`)* | E | 3 |

### Modified Files (2)

- `test/integration/workflow_architect_test.go` — 3 new test functions
- `test/integration/harness/workflow_architect_helpers.go` — `loadWorkflowArchitectEnabledTools`, `LoadWorkflowArchitectEnabledTools`, `WorkflowArchitectEnabledTools` functions

### Key Design Decisions

- **Hook tests mock dependency hooks, not gRPC transports** — follows existing `useNewSessionFlow.test.tsx` pattern
- **Component tests mock the composed behavior hook** — keeps UI tests focused on rendering, not hook internals
- **Playwright tests use interactive tier with `testWorkflow` fixture** — API-seeded data, no reliance on pre-existing workflows
- **SeedpackSync test is offline** — runs in default `make test` (300s, no provider credentials), catches enabled_tools drift automatically

## Benefits

- 98 new test cases covering all 3 Workflow Architect operating modes (generate, refine, diagnose)
- Full phase machine coverage: all 6 `RefinePhase`, 7 `ArchitectPhase`, and 6 `DiagnosePhase` states tested
- Automated seedpack drift detection replaces manual sync
- Bug documented: `WorkflowRepairCard` "Try Again" leaves card in idle state after `autoStartedRef` was set

## Impact

- **SDK consumers**: React SDK workflow components now have the same test coverage standard as session/execution components
- **CI pipeline**: New tests run automatically via `vitest run` (SDK), `make test-e2e-interactive` (Playwright), `make test-workflow-architect` (Go integration)
- **Developer confidence**: Refactoring the architect hooks or components will catch regressions immediately

## Related Work

- Workflow Architect agent: `seedpack/agents/workflow-architect.yaml`
- Agent-powered workflow generation project: `_projects/2026-05/20260515.01.sp.agent-powered-workflow-generation`
- Pre-deploy integration test expansion: `_projects/2026-05/20260521.01.pre-deploy-integration-test-expansion`

---

**Status**: ✅ Production Ready
**Timeline**: Single session
