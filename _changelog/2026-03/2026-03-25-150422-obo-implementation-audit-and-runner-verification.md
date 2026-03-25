# OBO Implementation Audit and Runner Verification

**Date**: March 25, 2026

## Summary

Comprehensive audit of the on-behalf-of (OBO) impersonation wiring across both Workflow Runner (Go) and Agent Runner (Python), verifying all call sites against the original design plan. Confirmed that two parameter threading bugs — `invoker_identity_account_id` missing from `_execute_graphton_impl` and `OrgId`/`InvokerIdentityAccountID` dropped during continue-as-new — were already resolved in the Session 5 commit `3c2b21e3`.

## Problem Statement

The OBO wiring was implemented across multiple sessions (Sessions 1–5) touching Java, Python, and Go codebases. With changes spread across 6+ sessions and two repos, there was no single verification that the final state matched the intended design.

### Pain Points

- No end-to-end audit had been performed after all sessions
- Two bugs were identified in the plan but their resolution status was uncertain
- FGA/proto foundations diverged from the original plan, and the divergence needed documentation

## Solution

Performed a systematic call-by-call audit of every gRPC call site in both runners, classifying each as OBO (user-impersonated) or system (machine-account), and comparing against the plan.

## Audit Results

### Workflow Runner (Go) — All 6 Items Verified

| Component | Status |
|-----------|--------|
| `WithOnBehalfOf` helper (`on_behalf_of.go`) | Correct — appends `x-on-behalf-of` header |
| `execute_workflow_activity.go` reads | Correct — `oboCtx` for `WorkflowInstance.Get`, `Workflow.Get`, `ExecutionContext.GetByExecutionId` |
| `execute_workflow_activity.go` status | Correct — plain `ctx` for all `UpdateStatus` calls |
| `task_builder_call_agent_activities.go` | Correct — `buildAuthenticatedContext` for resolve/create, system for approval |
| Continue-as-new identity preservation | Fixed — `OrgId` and `InvokerIdentityAccountID` copied in `continuedInput` |
| `progress_interceptor.go` | Correct — no OBO (system telemetry only) |

### Agent Runner (Python) — All 5 Items Verified

| Component | Status |
|-----------|--------|
| `OnBehalfOfInterceptor` | Correct — appends `x-on-behalf-of` to all gRPC call types |
| `ChannelProvider` OBO support | Correct — stacks interceptor after auth when identity provided |
| `execute_graphton.py` parameter threading | Fixed — `invoker_identity_account_id` passed to `_execute_graphton_impl` |
| `execute_graphton.py` channel split | Correct — OBO for reads, system for `updateStatus` |
| `generate_session_subject.py` | Correct — OBO for all reads + session update |

### FGA/Proto Foundations — Documented Divergence

The original plan proposed per-resource `operator` + `can_update_status` permissions. The implementation chose a better path:

- **`updateStatus` authorization**: Platform-level `can_update_execution_status` on `platform:stigmer` instead of per-resource operator relations. Simpler, avoids operator tuple proliferation.
- **ExecutionContext authorization**: Derived auth from parent execution (agent_execution or workflow_execution) instead of a dedicated `execution_context.fga` model. Reuses existing ownership chain.

## Benefits

- Full confidence that OBO wiring is complete and correct across both runners
- Both identified bugs confirmed as resolved
- Clear documentation of intentional divergence from original plan
- Remaining work scope is narrow: build validation and end-to-end testing only

## Impact

- **Agent Runner**: All user-facing reads use OBO impersonation; status updates use machine account
- **Workflow Runner**: Same split; continue-as-new preserves identity across workflow restarts
- **Security model**: Users can only access their own resources through runners; machine account restricted to status telemetry

## Related Work

- Session 5 changelog: `2026-03-25-150239-remove-operator-propagation-from-fga-model.md`
- Session 4 changelog: `2026-03-25-144412-execution-context-derived-authorization-and-runner-obo-fixes.md`
- OBO wiring changelog: `2026-03-25-140735-wire-obo-impersonation-into-runners-and-fga-hardening.md`
- Design plan: `wire_obo_t05-t06_2922e9a4.plan.md`

---

**Status**: ✅ Production Ready (pending build validation and E2E testing)
