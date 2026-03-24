# Fix IAM Repo Metadata Field Name Mismatch

**Date**: March 24, 2026

## Summary

Fixed a critical field name mismatch in three IAM domain repositories and two migration index files where MongoDB queries used `metadata.organization` and `metadata.environment` instead of the correct proto-derived field names `metadata.org` and `metadata.env`. This broke duplicate checking, org-based lookups, and org-based filtering for API keys, identity accounts, and IAM policies.

## Problem Statement

The Protobuf `ApiResourceMetadata` message defines `string org = 4` and `string env = 5`. When serialized via `JsonFormat.printer()`, these fields are stored in MongoDB under their proto field names: `metadata.org` and `metadata.env`. However, three IAM repos were querying for `metadata.organization` and `metadata.environment` — fields that don't exist in stored documents.

### Pain Points

- `ApiKeyRepo.findByOrgAndSlug` always returned empty because `metadata.organization` doesn't exist in MongoDB documents, causing the duplicate check to fail silently on every API key creation.
- New API keys bypassed deduplication entirely, leading to FGA tuple corruption where old owner tuples (pointing to deleted identity accounts) persisted instead of being properly managed.
- The `findByOrg` and `find` methods in all three IAM repos returned empty results for any org-scoped query.
- MongoDB indexes on `metadata.organization` were useless since no documents contain that field.

## Solution

Replaced all occurrences of `metadata.organization` with `metadata.org` and `metadata.environment` with `metadata.env` across the three affected repos and two migration index files. This aligns the queries with the actual field names in MongoDB documents, matching the pattern already used correctly by all agentic and tenancy repos.

## Implementation Details

### Files Changed

| File | Replacements |
|------|-------------|
| `ApiKeyRepo.java` | 4x `metadata.organization` → `metadata.org`, 2x `metadata.environment` → `metadata.env` |
| `IdentityAccountRepo.java` | 4x `metadata.organization` → `metadata.org`, 2x `metadata.environment` → `metadata.env` |
| `IamPolicyRepo.java` | 4x `metadata.organization` → `metadata.org`, 2x `metadata.environment` → `metadata.env` |
| `U20250101_IdentityAccountIndexes.java` | Index creation and rollback drop: `metadata.organization` → `metadata.org` |
| `U20250101_IamPolicyIndexes.java` | Index creation and rollback drop: `metadata.organization` → `metadata.org` |
| `agent_instance.fga` | Documented known issue with default instance ownership (Root Cause 3) |

### Affected Methods (per repo)

- `findByOrgAndSlug` — org filter fixed
- `findByOrgAndEnvAndSlug` — both org and env filters fixed
- `findByOrg` — org filter fixed
- `find` — both org and env filters fixed

### Verification

A full project scan confirmed that all other repos (`AgentRepo`, `AgentInstanceRepo`, `AgentExecutionRepo`, `SessionRepo`, `McpServerRepo`, `SkillRepo`, `WorkflowRepo`, `WorkflowInstanceRepo`, `WorkflowExecutionRepo`, `EnvironmentRepo`, `ProjectRepo`, `ExecutionContextRepo`, `IdentityProviderRepo`) already use the correct `metadata.org` field name.

## Benefits

- API key duplicate checking now works correctly, preventing FGA tuple corruption from silently bypassed deduplication.
- Org-scoped queries return correct results for API keys, identity accounts, and IAM policies.
- MongoDB indexes now match the actual document field names, providing expected query performance.
- Consistency across the entire codebase — all repos now use the same proto-derived field names.

## Impact

- **API Key Authentication**: Resolves the root cause of "invalid token" errors where new API keys were corrupting FGA tuples by bypassing the duplicate check, leaving stale owner references to deleted identity accounts.
- **IAM Queries**: All org-based lookups and filtering for identity accounts and IAM policies now return correct results.
- **Database**: Migration indexes will create indexes on the correct field, enabling efficient org-based queries.

## Related Work

- [fix-dotted-key-queries-remaining-repos](2026-03-23-162100-fix-dotted-key-queries-remaining-repos.md) — similar MongoDB field name mismatch fix for dotted label/annotation keys
- [fix-mongodb-dotted-label-key-queries](2026-03-23-123257-fix-mongodb-dotted-label-key-queries.md) — initial dotted-key fix

---

**Status**: ✅ Production Ready
