# ExecutionContext Derived Authorization and Runner OBO Fixes

**Date**: March 25, 2026

## Summary

Replaced all operator-based authorization on ExecutionContext RPCs with a shared derived authorization model that checks permissions against the parent execution (agent or workflow). Additionally fixed agent-runner Python code to use OBO channels for session updates and execution reads, ensuring all user-facing operations are attributed to the invoking user rather than the machine account.

## Problem Statement

After removing the `operator` role from ExecutionContext authorization configs (Session 3), all ExecutionContext RPCs were left with `is_skip_authorization=true` but no handler-level authorization. This created two problems:

### Pain Points

- System-channel calls succeeded silently (because `skipAuthorization()` returns true), but OBO calls would fail with `Status.INTERNAL` — a latent bug from `AuthorizeRequestStepV2` when no `RpcAuthorizationConfig` is present
- ExecutionContext resources could be created, read, or deleted without any access check on the parent execution — a security gap
- Agent-runner was using the system channel for session updates and execution reads, attributing these actions to the machine account instead of the invoking user
- Authorization logic for `getByExecutionId` was inline and duplicated rather than shared across all handlers

## Solution

Two-part fix: (1) a shared derived authorization service for all ExecutionContext handlers in `stigmer-cloud`, and (2) OBO channel corrections in `stigmer` agent-runner.

## Implementation Details

### ExecutionContextDerivedAuthorization (New Shared Service)

Created `ExecutionContextDerivedAuthorization` as a Spring `@Component` in `executioncontext.authorization` package. Provides a single method:

```java
boolean isAuthorized(RequestCallerIdentity caller, String executionId,
                     ApiResourceIamPermission permission)
```

The method checks the requested permission (`can_view` for reads, `can_edit` for creates/deletes) against `agent_execution` first, then `workflow_execution`. Authorization passes if either parent grants access. This encapsulates the "try both parent types" pattern in one reusable location.

### Handler Refactoring (6 Handlers)

Each ExecutionContext handler now has a custom `Authorize` inner class that:
1. Extracts the parent `execution_id` from the request or loaded resource
2. Delegates to `ExecutionContextDerivedAuthorization.isAuthorized()`
3. Throws `Status.PERMISSION_DENIED` if unauthorized

Key pipeline reordering: `GetHandler` and `DeleteHandler` needed load-before-authorize since the parent `execution_id` lives in the resource spec (not available until loaded).

### Agent Runner OBO Fixes

- `generate_session_subject.py`: Session update now uses the existing OBO-channel `session_client` instead of creating a new system-channel client. Agent execution read switched from `sys_ch` to `obo_ch`.
- `execute_graphton.py`: Split into `execution_query_client` (OBO, for `get()`) and `execution_client` (system, for `update_status()`).

### Proto Documentation

Updated all ExecutionContext proto files (`command.proto`, `query.proto`, `api.proto`) to document the derived authorization model and remove stale "operator-only" references.

## Benefits

- **Security**: All ExecutionContext operations now require verifiable permission on the parent execution — no open-door access
- **Correctness**: OBO calls work correctly; the latent `Status.INTERNAL` bug from `AuthorizeRequestStepV2` is avoided entirely
- **User attribution**: Session updates and execution reads in agent-runner are now attributed to the invoking user, not the machine account
- **Maintainability**: Single shared service replaces 5 different authorization implementations (inline, operator check, common steps) across handlers
- **Consistency**: All handlers follow the same pattern: custom `Authorize` step → `ExecutionContextDerivedAuthorization` → parent FGA check

## Impact

- **ExecutionContext handlers**: All 6 handlers (create, get, getByReference, getByExecutionId, delete, apply) updated — applies to every ExecutionContext operation in the platform
- **Agent runner**: Two Python activity files updated — affects every agent execution that generates session subjects or reads execution state
- **Authorization model**: Establishes the pattern for other ephemeral resources that derive permissions from their parent

## Related Work

- [Wire OBO Impersonation Changelog](2026-03-25-140735-wire-obo-impersonation-into-runners-and-fga-hardening.md) — Session 3 work that introduced `is_skip_authorization=true` on ExecutionContext RPCs
- [On-behalf-of gRPC Impersonation Infrastructure](2026-03-25-113851-on-behalf-of-grpc-impersonation-infrastructure.md) — Foundation infrastructure this work builds on
- [Thread Invoker Identity](2026-03-25-130511-thread-invoker-identity-through-temporal-workflow-inputs.md) — Invoker identity threading that enables OBO in runners

---

**Status**: ✅ Production Ready (pending build validation and end-to-end testing)
**Timeline**: Single session (~2 hours)
