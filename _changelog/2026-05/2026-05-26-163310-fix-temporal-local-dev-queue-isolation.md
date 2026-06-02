# Fix Temporal Local Dev Queue Isolation

**Date**: May 26, 2026

## Summary

Isolated local development Temporal task queues from production by adding a `local_` prefix to all orchestrator and runner queue names in the local kustomize overlay and `.env`. This eliminates the dual-worker version mismatch that caused sporadic `NonDeterministicException` failures when running the Java service locally.

## Problem Statement

Running `stigmer-service` locally via the desktop dev stack (MakeDesktopFNDevCommand) while the Kubernetes production pod is active caused sporadic workflow failures.

### Pain Points

- Local Java service and K8s pod both polled the **same Temporal task queues** (`agent_execution_stigmer`, `workflow_execution_stigmer`) on the **same production Temporal cluster** (`default` namespace)
- Temporal round-robins workflow tasks across all connected workers — when a task was started by one worker and replayed by the other (running different code), `NonDeterministicException` occurred
- The error was sporadic (depended on which worker Temporal assigned each task to), making it extremely hard to diagnose
- Stuck workflows entered infinite replay loops, producing continuous `TMPRL1100` errors
- The `FailExternalActivity` local activity marker recorded by the K8s worker (origin/main code) was not expected by the local worker (feat/workflow-ux-overhaul code with version gates)

## Solution

Added a `local_` prefix to all four Temporal task queue names in the local development configuration, creating complete isolation between local and production workers on the shared Temporal cluster.

## Implementation Details

**Local kustomize overlay** (`_kustomize/overlays/local/service.yaml`):

| Queue Variable | Before | After |
|---|---|---|
| `TEMPORAL_AGENT_EXECUTION_STIGMER_TASK_QUEUE` | `agent_execution_stigmer` | `local_agent_execution_stigmer` |
| `TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE` | `stigmer_runner` | `local_stigmer_runner` |
| `TEMPORAL_WORKFLOW_EXECUTION_STIGMER_TASK_QUEUE` | `workflow_execution_stigmer` | `local_workflow_execution_stigmer` |
| `TEMPORAL_WORKFLOW_EXECUTION_RUNNER_TASK_QUEUE` | `stigmer_runner` | `local_stigmer_runner` |

**`.env` file**: same four values updated (gitignored, runtime-only).

No changes needed for dynamic per-session (`session:{id}`) or per-execution (`wfexec:{id}`) queues — these are already naturally isolated by their unique IDs.

## Benefits

- Local development can no longer steal workflow tasks from production
- Eliminates an entire class of sporadic `NonDeterministicException` errors during local dev
- No impact on production — queue names, K8s deployment, and prod overlay are untouched
- Temporal creates queues on demand, so no server-side setup is required

## Impact

- **Developers**: local dev sessions are fully isolated from production; no more mysterious sporadic workflow failures
- **Production**: unaffected; K8s pods continue polling the original queue names
- **CI/CD**: `.env` is regenerated from the local overlay via `planton service dot-env --env local`, so future regenerations will pick up the new names automatically

---

**Status**: Production Ready
