# AgentRunner Domain Aggregate — stigmer-cloud Implementation

**Date**: April 21, 2026

## Summary

Implemented the complete AgentRunner domain aggregate in stigmer-cloud: FGA authorization model, MongoDB repository, 5 command handlers (create, update, delete, apply, heartbeat), 3 query handlers (get, getByReference, list), MongoDB index migration, and Proto-FGA consistency test registration. This is the Java/Spring Boot server-side implementation of the AgentRunner resource whose proto contract was defined in Session 5.

## Problem Statement

The AgentRunner proto was fully defined (6 proto files, 154 generated files across all languages) but had no server-side implementation. Without the aggregate, handlers, and authorization model in stigmer-cloud, the runner lifecycle (create, heartbeat, dispatch routing, session composer selection) cannot function.

### Pain Points

- No CRUD operations for AgentRunner in the Java control plane
- No FGA authorization model — runners have no access control
- No heartbeat processing — runner liveness tracking is inoperable
- No apply (idempotent create-or-update) — CLI registration path blocked
- No list with label filtering — session composer cannot discover runners
- Proto-FGA consistency test does not cover AgentRunner RPCs

## Solution

Built the full AgentRunner aggregate following the established codebase patterns: annotation-processor-generated gRPC controllers, pipeline-based request handlers with composable steps, `AbstractMongoApiResourceRepository` for storage, and FGA-native authorization matching the proto's `kind_meta` declarations.

## Implementation Details

### FGA Authorization Model (3 files)

- **`agentic/agent_runner.fga`** — new type with `organization`, `owner`, `viewer` relations and `can_view`, `can_edit`, `can_delete`, `can_grant_access`, `can_view_access` permissions. Modeled after `agent.fga` with org-transitive viewer access for session composer discoverability.
- **`tenancy/organization.fga`** — added `can_create_agent_runner: member` (any org member can register a runner, decided with principal architect).
- **`fga.mod`** — registered `agentic/agent_runner.fga` in the model manifest.

### MongoDB Repository

- `AgentRunnerRepo` extends `AbstractMongoApiResourceRepository<AgentRunner>`, collection `agent_runner`.
- Standard queries: `findByOrgAndSlug`, `findByOrg`, `findBySlug`, `findById` (inherited).
- Custom queries: `findByIdsAndOrgAndLabels` (FGA-filtered + label AND semantics using `$getField` for dotted label keys), `findByIds` (batch ID lookup).

### Command Handlers

- **CreateHandler** — standard create pipeline + custom `InitializeRunnerStatus` step that sets `task_queue = "agent-runner:{id}"` and `phase = PENDING` after ID generation.
- **UpdateHandler** — standard update pipeline + custom `PreserveRunnerStatus` step that restores status from the existing resource after the framework's `buildNewState` clears it.
- **DeleteHandler** — standard delete pipeline with FGA tuple cleanup.
- **ApplyHandler** — delegates to create/update via `ApplyOperationHandlerV2`. Primary CLI registration path.
- **HeartbeatHandler** — custom handler with 4 pipeline steps: LoadRunner, VerifyCallerOwnership (FGA `can_edit` check), UpdateHeartbeatStatus (phase transitions, reactivation from PENDING/STOPPED to READY), Persist. FAILED phase blocks heartbeat transitions.

### Query Handlers

- **GetHandler** — standard get pipeline with FGA `can_view` check.
- **GetByReferenceHandler** — custom handler that resolves by org+slug, then FGA `can_view` check. Used by CLI for `stigmer run agent my-agent --runner my-macbook`.
- **ListHandler** — FGA-filtered query pattern: queries authorized IDs via `listAuthorizedResourceIds`, then loads from MongoDB with org+label filters and pagination.

### MongoDB Migration

- `U20260421_AgentRunnerIndexes` — unique index on `metadata.id`, compound unique on `(metadata.org, metadata.slug)`, compound on `(metadata.org, status.phase)` for dispatch queries.

### Proto-FGA Consistency Test

- Added AgentRunner command and query descriptors to `ProtoFgaSchemaConsistencyTest.allProtoFileDescriptors()`.

## Benefits

- AgentRunner is now a fully operational first-class API resource in the cloud edition
- Runners have proper org-scoped FGA authorization matching the platform's security model
- The heartbeat handler enforces ownership — only the runner's creator can update its operational state
- The apply handler enables idempotent CLI registration with identity persistence across restarts
- Label-based filtering supports the session composer's need to hide system-managed ephemeral runners

## Impact

- **Backend**: 12 new Java files + 3 modified files in stigmer-cloud
- **Authorization**: New FGA type `agent_runner` with full RBAC; `can_create_agent_runner` added to organization
- **Storage**: New MongoDB collection `agent_runner` with 3 indexes
- **Proto stubs**: Generated stubs synced from OSS protos via `make protos` (all languages)
- **Unblocks**: Phase 1 dispatch integration (item 10), runner auth migration (item 12), runner heartbeat client (item 13)

## Related Work

- Session 5 (2026-04-20): AgentRunner proto definition — the contract this implementation builds on
- Session 4 (2026-04-20): Side-Channel Proxy FGA authorization — established the FGA patterns reused here
- Next: Item 9 (Go/SQLite implementation in stigmer OSS), Item 10 (dispatch integration)

---

**Status**: Production Ready (pending deployment)
**Timeline**: Session 6 — single session implementation
