# Fix Dotted Key Queries in Remaining Repos

**Date**: March 23, 2026

## Summary

Extended the MongoDB `$getField` fix for dotted label/annotation keys to four additional repositories: `AgentRepo`, `WorkflowRepo`, `SkillRepo`, and `McpServerRepo`. This fixes the `GetDefaultAgent` RPC returning empty results in the cloud backend and ensures `findByProjectId` queries work correctly across all resource types.

## Problem Statement

The `GetDefaultAgent` RPC was returning empty results in the cloud version even though a default agent existed in the database. The frontend displayed "No default agent available. Select an agent to start a session." The same underlying bug affected `findByProjectId` queries across four resource repos.

### Pain Points

- `AgentRepo.findDefault()` used `Criteria.where("metadata.labels.stigmer\\.ai/default-agent")` — MongoDB interpreted the dot as a path separator, navigating `stigmer\` → `ai/default-agent` instead of matching the literal key `stigmer.ai/default-agent`.
- `findByProjectId()` in `AgentRepo`, `WorkflowRepo`, `SkillRepo`, and `McpServerRepo` all used the same broken pattern for annotation key `stigmer.ai/sdk.project`.
- The OSS Go backend was unaffected because it uses SQLite with binary protobuf storage and filters labels in-memory via proto reflection — it never constructs a database query with dotted field names.

## Solution

Replaced `Criteria.where()` dot-notation queries with raw `Document`-based filters using MongoDB's `$getField` operator, consistent with the approach already proven in `AgentInstanceRepo.findByIdsAndOrgAndLabels` and `EnvironmentRepo.findByIdsAndOrgAndLabels`.

## Implementation Details

### `AgentRepo.findDefault()` — Label query

Uses `$getField` on `$metadata.labels` to match `stigmer.ai/default-agent: "true"`, combined with a standard `metadata.visibility` filter:

```json
{"metadata.visibility": "visibility_public",
 "$expr": {"$eq": [{"$getField": {"field": "stigmer.ai/default-agent", "input": "$metadata.labels"}}, "true"]}}
```

### `findByProjectId()` — Annotation query (4 repos)

Uses `$getField` on `$metadata.annotations` to match `stigmer.ai/sdk.project`:

```json
{"$expr": {"$eq": [{"$getField": {"field": "stigmer.ai/sdk.project", "input": "$metadata.annotations"}}, "<projectId>"]}}
```

### Files Changed

| File | Methods Fixed |
|------|---------------|
| `AgentRepo.java` | `findDefault()`, `findByProjectId()` |
| `WorkflowRepo.java` | `findByProjectId()` |
| `SkillRepo.java` | `findByProjectId()` |
| `McpServerRepo.java` | `findByProjectId()` |

## Benefits

- The `GetDefaultAgent` RPC now correctly resolves the platform default agent in the cloud backend.
- Project-scoped resource queries work for all resource types (agents, workflows, skills, MCP servers).
- All dotted-key queries in the codebase now use a single consistent pattern (`$getField` + `BasicQuery`), verified by a scan confirming zero remaining `Criteria.where("metadata.(labels|annotations).")` usages.

## Impact

- **Users**: Session-first UX works — users can start a conversation without explicitly selecting an agent.
- **SDK**: `findByProjectId` queries return correct results, enabling project-scoped resource management.
- **Codebase**: Complete consistency across all repos for dotted-key MongoDB queries.

## Related Work

- [fix-mongodb-dotted-label-key-queries](2026-03-23-123257-fix-mongodb-dotted-label-key-queries.md) — the initial fix for `EnvironmentRepo` and `AgentInstanceRepo`

---

**Status**: ✅ Production Ready
