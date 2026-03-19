# Design Decision 002: Personal Resource Identification

**Date**: 2026-03-19
**Status**: Accepted

## Context

How do we identify personal Environments and personal AgentInstances programmatically? We need a reliable way to check "does this user already have a personal instance for Agent X?"

## Options Considered

### Option A: Naming convention only
Use deterministic slugs: `personal` for Environment, `{agent-slug}-personal` for AgentInstance.

- Pro: O(1) lookup via `getByReference`, no new APIs
- Con: Pollutes slug namespace, no semantic queryability

### Option B: Labels only
Use `stigmer.ai/personal: "true"` label on resources.

- Pro: Clean, semantic, queryable
- Con: Requires backend search service to support label filtering (may not exist yet)

### Option C: Deterministic naming + labels (selected)
Use both. Naming for fast O(1) lookup. Labels for semantic identification and future queryability.

## Decision

Option C. Both mechanisms work together:

| Resource | Slug | Labels |
|----------|------|--------|
| Personal Environment | `personal` | `stigmer.ai/personal: "true"` |
| Personal AgentInstance | `{agent-slug}-personal` | `stigmer.ai/personal: "true"`, `stigmer.ai/for-agent: "{org}/{slug}"` |

Primary lookup is `getByReference(org, slug, kind)` — fast, deterministic, no new APIs needed. Labels are set for queryability and UI filtering.

## Consequences

- Lookup is O(1) via existing `getByReference` API
- Labels provide semantic meaning for future list/filter operations
- FGA RESTRICTED model ensures only the owner can see personal resources
- No backend changes needed for identification (labels are already on ApiResourceMetadata)
