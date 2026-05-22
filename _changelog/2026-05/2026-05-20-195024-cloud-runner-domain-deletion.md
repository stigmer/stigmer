# Cloud Control Plane: Runner Domain Deleted, Per-Session Dispatch Implemented

**Date**: May 20, 2026

## Summary

Deleted the entire Runner API resource from the Java control plane (stigmer-service) and replaced runner-based execution dispatch with per-session Temporal task queue routing. This is the cloud-side counterpart to the OSS Runner deletion (T02) and completes the architectural shift from managed Runner resources to anonymous Temporal workers. 203 files changed, ~43K lines deleted, ~1K lines inserted.

## Problem Statement

The stigmer-cloud Java service maintained a full Runner domain — CRUD handlers, MongoDB collection, heartbeat service, bidirectional gRPC streams, Redis command coordination, Daytona sandbox launcher, FGA authorization model, and launch token exchange — all managing a concept that Temporal already handles natively. The cloud service's `RunnerDispatchService` resolved execution routing through a multi-step lookup: `session.runner_id` → load Runner → `runner.status.task_queue`, requiring the entire Runner lifecycle to be operational just to route an activity to a worker.

### Pain Points

- Runner domain added ~31 Java source files and ~5 test classes of incidental complexity
- Dispatch required 3 database lookups (session → runner → task queue) for every execution
- Ephemeral runner provisioning created throw-away Runner resources in MongoDB just to get a task queue name
- Runner heartbeat, stream registry, and Redis coordinator were custom reimplementations of Temporal's native worker health tracking
- Daytona launcher was coupled to Runner lifecycle instead of session lifecycle
- FGA authorization model included `runner` type and `can_create_runner` permission that added no real access control value

## Solution

Mirrored the Go implementation (T04) in Java: a simple `SessionDispatchService` that resolves the activity task queue directly from the session ID and a server-level routing mode (`STIGMER_ACTIVITY_ROUTING`), with zero Runner involvement.

## Implementation Details

**New `SessionDispatchService`** — replaces `RunnerDispatchService` with a clean resolution path:
- `global` mode (default): all activities route to the shared `agent_execution_runner` queue
- `session` mode: activities route to `session:{sessionId}` queues for per-session worker isolation
- Session always loaded for harness extraction (NATIVE vs CURSOR activity selection)
- Global fallback when session ID is null/empty or session not found

**Deleted Runner domain** (31 Java files):
- gRPC controller + 10 request handlers (CRUD, Apply, Connect, SendCommand, Stop)
- MongoDB repository, heartbeat service, stream registry, Redis command coordinator
- Launch token service + create/exchange handlers
- Launcher infrastructure (interface, config, Noop, Daytona, ProvisionInfrastructureStep)
- Downstream gRPC client (RunnerGrpcRepo + impl)

**Simplified workflow dispatch** — `WorkflowExecutionDispatchService` reduced from runner-provisioning logic to a single `resolve()` returning the global queue. Workflow executions have no session concept and always use global routing.

**Proto stub regeneration** — all generated stubs (Java, Go, Python, TypeScript, Dart) regenerated from the OSS branch where Runner protos are deleted. `RunnerUsageSummary` → `StreamingUsageSummary` across all languages.

**Infrastructure cleanup** — removed Daytona SDK from Maven dependencies, deleted `application-runner-launcher.yaml` config, removed `runner-launcher` Spring profile, stripped runner-related env vars from Kubernetes kustomize overlays (local + prod).

## Benefits

- **~43K lines of code deleted** from the cloud codebase
- **Dispatch reduced from 3 DB lookups to 1** (session only, for harness — no Runner lookup)
- **Behavioral parity between OSS and Cloud** — both control planes now implement identical `STIGMER_ACTIVITY_ROUTING` with the same `session:{id}` queue naming
- **Daytona SDK dependency removed** — sandbox provisioning will be redesigned as a dedicated Temporal activity (follow-up)
- **FGA model simplified** — one fewer resource type to authorize
- **MongoDB `runner` collection** no longer needed — one fewer collection to index and maintain

## Impact

- **stigmer-cloud control plane**: Runner gRPC endpoints no longer served. Any client calling Runner CRUD/Connect/SendCommand will get gRPC UNIMPLEMENTED.
- **Cloud sandbox provisioning**: Deferred to follow-up. Cloud mode continues with `global` routing using pre-deployed workers until `EnsureSessionSandbox` is designed.
- **Billing**: `runner_id` no longer set on execution status updates. `streaming_usage` field name change (from `runner_usage`) is transparent to billing — billing reads token counts, not the field name.
- **Both control planes**: Dispatch is now symmetric — same env var, same queue naming, same fallback behavior.

## Related Work

- OSS Runner API deletion (T02) — proto + Go server + TS runner + SDK/React + CLI + Desktop
- Per-session task queue routing in Go (T04) — the reference implementation this Java work mirrors
- `createStigmerRunner()` factory (T03) — the NPM package that replaces the Runner resource
- Next: T06 (Desktop app embedded runner) and cloud sandbox provisioning redesign

---

**Status**: ✅ Production Ready (pending branch merge)
**Timeline**: ~1 hour (Session 5 of the runner-architecture-simplification project)
