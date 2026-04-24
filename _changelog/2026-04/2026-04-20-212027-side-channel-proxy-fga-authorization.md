# Add FGA Authorization to Side-Channel Proxy

**Date**: April 20, 2026

## Summary

Added OpenFGA-based authorization to the Side-Channel Proxy endpoints (checkpoints, artifacts, LLM). The proxy now reuses the exact same `RequestCallerIdentityMapper` and `RequestAuthorizationService` infrastructure as the gRPC handlers — no new authorization concepts or custom validation layers. A 5-minute in-memory cache eliminates FGA latency on the checkpoint hot path.

## Problem Statement

The Side-Channel Proxy had authentication (valid token required) but zero authorization. Any authenticated user could read or write ANY checkpoint, generate presigned URLs for ANY artifact, and route unlimited LLM requests — all because the proxy never checked whether the caller had permission to access the specific resource.

### Pain Points

- **Checkpoint data fully exposed**: Any valid API key could read any user's full conversation state (tool call arguments, results, LLM responses) by guessing the predictable `thread-{session_id}` thread ID
- **Artifact data fully exposed**: Any valid token could generate presigned R2 URLs for any execution's artifacts — read private outputs or overwrite/tamper with existing ones
- **LLM proxy unmetered**: No per-user or per-org cost attribution beyond a log line
- **Sessions modeled as personal resources in FGA but proxy bypassed it entirely**: The FGA model explicitly states "org admins have NO implicit access (personal resource)" for sessions, yet the proxy gave everyone access

## Solution

Wire the proxy into the existing FGA authorization infrastructure. The proxy now calls the same `RequestCallerIdentityMapper` → `RequestAuthorizationService` → OpenFGA `check()` path that every gRPC handler uses. No new authorization models, no custom validation layers.

## Implementation Details

### Proxy-side (stigmer-cloud, 5 files)

**New: `ProxyAuthorizationService`** (`ai.stigmer.proxy.authorization`) — Thin wrapper over the existing authorization infrastructure with a caching layer:
- Injects `RequestCallerIdentityMapper` (resolves `Authentication` → `identityAccountId`, handles API keys, JWTs, PlatformClient tokens, federated tokens)
- Injects `RequestAuthorizationService` (performs OpenFGA checks via in-process gRPC to IAM domain)
- `authorizeSessionAccess(auth, sessionId, write)` — for checkpoint operations
- `authorizeExecutionAccess(auth, executionId, write)` — for artifact operations
- 5-minute in-memory cache per `(identityAccountId, permission, resourceKind, resourceId)` — after the first FGA check per execution, hundreds of subsequent checkpoint writes hit cache

**New: `ProxyAccessDeniedException`** — Thrown on FGA denial, caught by controllers to return 403.

**Modified: `CheckpointerProxyController`** — Every operation derives `session_id` from `thread_id` (strips `thread-` prefix), calls `authorizeSessionAccess()`. Writes require `can_edit`, reads require `can_view`. Added 4MB document size limit and MongoDB compound indexes on `(thread_id, checkpoint_ns, checkpoint_id)`.

**Modified: `ArtifactProxyController`** — Every operation extracts `execution_id` from the artifact key prefix (`artifacts/{execution_id}/...`), calls `authorizeExecutionAccess()`. Uploads require `can_edit`, downloads require `can_view`. Added key validation (pattern, length, traversal prevention, MIME type).

**Modified: `LlmProxyController`** — Authentication only (unchanged). Stateless pass-through with no data isolation concern.

### Runner-side (stigmer, 2 files)

**Modified: `HttpCheckpointSaver`** — Reads `org_id` from `config["configurable"]["org"]` and includes it in checkpoint documents for data hygiene. No authorization headers or context binding needed — the proxy handles authorization server-side from the user's auth token.

**Modified: `ProxyArtifactStorage`** — Clean form, no changes beyond docstring update. Authorization is handled server-side.

## Benefits

- **Sessions are truly personal**: The FGA model's personal-resource semantics (`can_view: viewer`, `can_edit: owner`) are now enforced on the proxy, not just on gRPC
- **Zero new authorization infrastructure**: Reuses `RequestCallerIdentityMapper`, `RequestAuthorizationService`, and the full OpenFGA model already in production
- **Minimal latency impact**: 5-minute cache means one FGA check per execution, not per checkpoint write
- **Input validation hardening**: 4MB document size limit, key pattern validation, path traversal prevention, MIME type validation

## Impact

- **Side-Channel Proxy**: All checkpoint and artifact operations are now FGA-authorized
- **agent-runner**: No changes needed for authorization — the user's token is already sent as the Bearer credential
- **FGA model**: No changes — existing `session.can_view`/`can_edit` and `agent_execution.can_view`/`can_edit` permissions are used directly

## Related Work

- Phase 0 proxy implementation: commits `0329220b` (stigmer-cloud) and `e690b95ff` (stigmer)
- LLM proxy wiring: `_changelog/2026-04/2026-04-20-191935-llm-proxy-base-url-wiring.md`
- Project: `_projects/2026-04/20260420.01.agent-runner-as-resource`

---

**Status**: Production Ready (pending deploy with Phase 0)
