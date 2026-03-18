# Backend Default Agent Resolution (Go + Java)

**Date**: March 17, 2026

## Summary

Implemented automatic default agent resolution in both the Go (OSS) and Java (Cloud) backends, enabling the session-first UX. Users can now create an `AgentExecution` with just a message — no `agent_id` or `session_id` required. The backend resolves the platform's public default assistant agent via the `stigmer.ai/default-agent` label.

## Problem Statement

The `AgentExecution` creation pipeline required at least `session_id` or `agent_id`, blocking the session-first UX where users type a message and immediately get a response. Neither the Go `store.Store` nor the Java `AgentRepo` supported label-based queries, and the pipeline validation rejected requests without an agent reference.

### Pain Points

- Frontend had to know about agents before starting a conversation
- No mechanism to resolve a "platform default" agent
- Go store's `FindByField` couldn't query map fields (labels) due to proto reflection limitations with dot-notation key ambiguity
- Session creation was hardcoded to the agent's org, breaking cross-org usage of public agents

## Solution

Added a `ResolveDefaultAgentStep` to the execution creation pipeline in both backends, positioned before validation. When neither `session_id` nor `agent_id` is provided, the step queries for the platform's default agent (labeled `stigmer.ai/default-agent: "true"` with `visibility_public`) and populates `agent_id` on the request. Downstream steps proceed as normal.

## Implementation Details

### Seedpack
- `assistant.yaml`: Added `visibility: visibility_public` to metadata

### Proto (shared)
- `spec.proto`: Updated `session_id` and `agent_id` field comments to document the three-way resolution priority

### Go Backend (stigmer)
- **Store interface**: Added `FindByLabel(ctx, kind, labelKey, labelValue, msg)` and `FindAllByLabel(ctx, kind, labelKey, labelValue, templateMsg)` to `store.Store`
- **SQLite implementation**: Label querying via proto reflection — navigates `metadata` message field, accesses `labels` map field, and performs key-value lookup using `protoreflect.MapKey`
- **Pipeline**: Added `resolveDefaultAgentStep` querying by label + checking `visibility_public`. Updated `createSessionIfNeededStep` to use `execution.GetMetadata().GetOrg()` (caller's org) instead of agent's org. Removed now-unused `agentClient` dependency from the session step.

### Java Backend (stigmer-cloud)
- **AgentRepo**: Added `findDefault()` — MongoDB criteria query on `metadata.labels.stigmer\.ai/default-agent` + `metadata.visibility`
- **Pipeline**: Added `ResolveDefaultAgentStep` inner class using `AgentRepo.findDefault()`. Updated `CreateSessionIfNeededStep` to use `execution.getMetadata().getOrg()` (caller's org). Removed now-unused `agentRepo` dependency from the session step.

## Benefits

- **Session-first UX unblocked**: Frontend can create executions with just a message
- **Platform-level default agent**: Single source of truth for the default experience, accessible cross-org
- **Multi-tenant correctness**: Sessions are scoped to the caller's org even when using a cross-org agent
- **First-class label queries**: Go store now supports label-based lookups, a natural fit for the K8s-inspired resource model
- **Clean separation of concerns**: Resolution is a distinct pipeline step, not tangled into validation logic

## Impact

- **Frontend**: Can now send `Create Execution` with only `message` — no agent selection required
- **Backend (Go)**: 5 files changed, +288 lines. New store interface methods, new pipeline step, session org fix.
- **Backend (Java)**: 2 files changed, +92 lines. New repo method, new pipeline step, session org fix.
- **API contract**: `spec.proto` comments updated to reflect the new resolution behavior (backward compatible — existing callers unaffected)

## Related Work

- T01.1: Seedpack Default Assistant Agent (`ca2b2554`) — created the agent definition
- T01.3: Web UI Teardown — cleared the slate for session-first rebuild
- T01.4 (next): Web App Shell — three-panel layout consuming this backend capability

---

**Status**: Production Ready
**Repositories**: stigmer (Go), stigmer-cloud (Java)
