# SDK Runner Abstraction: Hide Runner Lifecycle from Consumers

**Date**: May 22, 2026

## Summary

Introduced a `RunnerAdapter` interface across all four Stigmer SDKs (TypeScript/React, Go, Java, Python) that abstracts runner lifecycle management from consumers. When `executionTarget` is `"local"`, SDK hooks automatically call the adapter at session/execution creation and on terminal phase detection — the page code is identical across desktop, web, and customer apps.

## Problem Statement

The desktop app (and any local-execution consumer) had to manually call `addSession()` / `addWorkflowExecution()` / `removeWorkflowExecution()` from page-level code after creating sessions and executions via SDK hooks. This created tight coupling between UI pages and runner infrastructure that:

### Pain Points

- Platform builders embedding `@stigmer/react` would have no idea they needed to call runner methods manually
- Page code differed between desktop (local runner) and web (cloud) deployments
- Terminal phase cleanup was tied to page-level useEffects — navigating away before completion leaked workers
- The pattern violated the "automatic lifecycle" principle used by every modern SDK (Stripe, Clerk, Vercel AI SDK, Terraform)

## Solution

Adopted the industry-standard provider/adapter pattern:

1. **Single configuration point** — `RunnerAdapter` is passed once to `StigmerProvider` (React) or `WithRunnerAdapter()` (Go) / `Builder.runnerAdapter()` (Java) / `runner_adapter=` (Python)
2. **Interface, not implementation** — The SDK defines the contract; each environment provides its adapter
3. **Automatic lifecycle** — SDK hooks call the adapter internally, page code is unaware
4. **Transparent to call sites** — Hooks work identically regardless of which adapter (or none) is active

## Implementation Details

### New Files (11)

| File | Purpose |
|------|---------|
| `sdk/react/src/runner-adapter.ts` | RunnerAdapter interface + React context + `useRunnerAdapter` hook |
| `sdk/typescript/src/runner-adapter.ts` | Framework-agnostic interface (re-exported by @stigmer/react) |
| `sdk/go/runner_adapter.go` | Go RunnerAdapter interface |
| `sdk/java/.../RunnerAdapter.java` | Java RunnerAdapter interface |
| `sdk/python/src/stigmer/_runner_adapter.py` | Python RunnerAdapter Protocol |
| `client-apps/desktop/src/hooks/useTauriRunnerAdapter.ts` | Desktop adapter wrapping useEmbeddedRunner |
| `test/integration/sdk/runner_adapter_test.go` | Integration tests (session + workflow lifecycle) |
| Unit test files (4) | Per-SDK unit tests |

### Modified Files (15)

- **Provider wiring**: `StigmerProvider` accepts `runnerAdapter` prop, provides via context
- **Hook integration**: `useCreateSession` and `useRunWorkflowFlow` call adapter after create when LOCAL
- **Terminal detection**: `useWorkflowExecution` calls `adapter.onWorkflowExecutionTerminated()` on terminal phase
- **Desktop restructure**: `EmbeddedRunnerProvider` now wraps `StigmerProvider` via bridge component
- **Page cleanup**: Removed manual runner calls from WorkflowDetailPage, WorkflowExecutionDetailPage, SessionLauncher
- **All SDK barrels**: Export RunnerAdapter types

### Key Design Decisions

- **Error propagation**: Adapter errors propagate to the caller (session/execution already exists server-side)
- **No-op guard**: `if (adapter && resolvedTarget === "local")` — zero impact on cloud consumers
- **Idempotent terminate**: Uses `terminatedRef` to fire only once per execution ID
- **Async interface**: All adapter methods return Promise/error to support I/O-bound operations

## Benefits

- **Zero manual wiring for consumers**: Pages just call `create()` — runner lifecycle is invisible
- **Identical page code across environments**: Desktop, web, and customer apps share the same UI components
- **No leaked workers**: Terminal detection is in the SDK hook, not page-level effects
- **Type-safe across 4 languages**: Interface is defined consistently in TS, Go, Java, Python
- **Extensible**: Customers can implement `RunnerAdapter` for self-hosted runners

## Impact

- **Desktop app**: Provider tree restructured (EmbeddedRunnerProvider → RunnerAdapterBridge → StigmerProvider); 3 pages simplified
- **React SDK**: 2 new exports (`RunnerAdapter`, `useRunnerAdapter`); 3 hooks enhanced
- **All SDKs**: New interface available for adoption (Go CLI, Java/Python consumers)
- **Web app**: No changes needed — cloud consumers unaffected
- **Integration tests**: New test file validates adapter wiring with real server

## Related Work

- Follows the architecture rule DD-001 (build in @stigmer/react first)
- Follows DD-008 (StigmerProvider + useStigmer as the only IoC point)
- Prior work: `ExecutionTargetContext` pattern (mirrored for RunnerAdapterContext)
- Follow-up: Auto-wire adapter calls in Go SDK create methods (currently manual)

---

**Status**: ✅ Production Ready
**Timeline**: Single session implementation
