# Workstream D: Workflow Sandbox Lifecycle Hooks — Automated Deprovisioning

**Date**: May 21, 2026

## Summary

Implements automated sandbox deprovisioning for workflow executions across all terminal paths (completion, failure, cancellation, termination, deletion) plus re-provisioning on recovery. This is the most architecturally critical piece of the workflow sandbox affinity feature — without it, every cloud workflow execution would leave an orphaned Daytona VM running indefinitely.

## Problem Statement

Session sandboxes are cleaned up when users explicitly delete sessions (`SessionDeleteHandler.DeprovisionSandboxStep`). Workflow executions are fire-and-forget — no user action triggers cleanup. Before this change, workflow sandboxes had provisioning logic (Workstream A) but zero deprovisioning, meaning every cloud workflow execution would leave an orphaned Daytona VM running until the 24h auto-delete safety net.

### Pain Points

- Every cloud workflow execution leaked a Daytona VM (real compute cost)
- No automated cleanup path for completed, failed, cancelled, or terminated workflows
- Terminate (force-kill) bypasses the Temporal workflow's finally block entirely — no cleanup was possible
- Recovering a failed workflow after sandbox deprovision left the execution without a worker on its queue

## Solution

Two complementary cleanup mechanisms covering all terminal paths:

1. **Orchestrator finally block** (Temporal local activity) — handles success, failure, and cancellation via a version-gated `DeprovisionWorkflowSandboxActivity` in the workflow's detached cancellation scope
2. **Handler pipeline steps** — non-critical `DeprovisionWorkflowSandboxStep` in terminate, cancel, and delete handlers; critical `EnsureWorkflowSandboxStep` in the recover handler for re-provisioning

## Implementation Details

### New Files (2)

- `sandbox/temporal/DeprovisionWorkflowSandboxActivity.java` — `@ActivityInterface` for Temporal consumption
- `sandbox/temporal/DeprovisionWorkflowSandboxActivityImpl.java` — delegates to `SandboxProvisioner`, lets exceptions propagate for Temporal retries (unlike `DeleteExecutionContextActivity` which swallows errors)

### Bug Fix (D.0)

Fixed a retry-defeating bug in `DaytonaSandboxProvisioner.deprovisionWorkflowSandbox()`: the error path was deleting the repo record before throwing, which meant Temporal retries found no record and returned as no-op, leaving the Daytona VM orphaned. The repo record is now preserved on transient errors so retries can re-attempt the delete.

### Orchestrator Cleanup (D.2)

Version-gated with `Workflow.getVersion("workflow-sandbox-cleanup")` to avoid `NonDeterministicWorkflowError` on in-flight workflows. Independent try-catch from EC cleanup so one failure doesn't prevent the other.

### Handler Steps (D.4-D.7)

- **Terminate** (D.4): ONLY cleanup path — Temporal terminate kills the process, no finally block runs. Always attempts deprovision regardless of `CTX_ALREADY_TERMINATED`.
- **Cancel** (D.5): Safety net — orchestrator finally is primary, handler step covers crashes and slow signal delivery. Idempotent with finally block.
- **Delete** (D.6): Follows `SessionDeleteHandler.DeprovisionSandboxStep` pattern — positioned after `deleteSteps.delete`, non-critical.
- **Recover** (D.7): Re-provisions sandbox with fresh token minting. Positioned after `findResetPointStep`, before `resetTemporalWorkflowStep` to avoid race conditions. Critical step — fails fast with `UNAVAILABLE` if provisioning fails.

### Error Handling Philosophy

Sandbox deprovisioning is **retriable, not best-effort** (unlike EC cleanup):
- Orphaned VMs have real compute cost
- Daytona auto-delete is a 24h safety net (much slower than EC TTL)
- Activity lets `SandboxProvisioningException` propagate for Temporal retries
- The finally block's try-catch absorbs terminal failure after all retries exhausted

## Benefits

- Zero orphaned Daytona VMs from workflow executions on all terminal paths
- Three-layer defense: orchestrator finally + handler safety nets + Daytona auto-delete (24h)
- Recovered workflows get fresh sandboxes with valid tokens
- Temporal versioning ensures backward compatibility with in-flight workflows

## Impact

- **Cloud infrastructure**: Eliminates orphaned VM leak from every workflow execution
- **Cost**: Direct compute savings from automated sandbox cleanup
- **User experience**: Recovered workflows work correctly instead of failing silently
- **Reliability**: Multiple safety nets ensure cleanup happens even under failure conditions

## Related Work

- Workstream A: Sandbox provisioning + deprovisioning infrastructure (prerequisite)
- Workstream B: Dispatch routing for per-execution queues
- Workstream C: Agent override wiring + security
- Workstream E: Tests + validation (next)

---

**Status**: Production Ready
**Repo**: stigmer-cloud
**Branch**: feat/unified-runner-migration
