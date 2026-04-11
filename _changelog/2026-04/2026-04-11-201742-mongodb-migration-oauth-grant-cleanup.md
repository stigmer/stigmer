# MongoDB Migration: OAuth Grant Data Cleanup

**Date**: April 11, 2026

## Summary

Performed a live MongoDB migration to wipe stale OAuth grant data and remove OAuth tokens from a personal environment. This completes the data-layer migration for the managed-credentials project, preparing the system for clean end-to-end validation of the new OAuth flow.

## Problem Statement

The `oauth_grant` collection contained a document created under the old schema (keyed by `mcpServerId` instead of `resourceId`, missing `orgId` and `resourceKind` fields). The referenced personal environment also held a `SLACK_ACCESS_TOKEN` value that was written by the old OAuth connect flow — a flow that has been replaced by managed environment storage.

### Pain Points

- Old grant document would cause key mismatches with the new three-part composite key (`identityAccountId`, `resourceId`, `orgId`)
- OAuth token in the personal environment contradicted the new separation design where OAuth tokens belong in managed environments
- Stale data could mask bugs during end-to-end validation

## Solution

Direct MongoDB operations via `mongosh` against the production database to surgically remove the stale data, verified by post-operation queries.

## Implementation Details

Two targeted operations on the `stigmer` database at `stigmer-prod-mongo-database.planton.live`:

1. **`db.oauth_grant.deleteMany({})`** — Removed 1 document with old schema fields (`mcpServerId`, no `orgId`, no `resourceKind`). The new T01–T04 implementation expects `resourceId` + `orgId` + `resourceKind`.

2. **`db.environment.updateOne({...}, {$unset: {"spec.data.SLACK_ACCESS_TOKEN": ""}})`** — Removed the OAuth-managed `SLACK_ACCESS_TOKEN` from personal environment `env_01kmmdavxx9r8qxgqytva7r45k`. The user-managed `GITHUB_TOKEN` was preserved.

Pre-flight inspection confirmed:
- Zero managed environments exist (clean slate for new flow)
- No other personal environments contained OAuth token vars
- The referenced personal environment's only OAuth artifact was `SLACK_ACCESS_TOKEN`

## Benefits

- Clean data state for end-to-end validation of the new OAuth managed-credentials flow
- No stale grant documents that could cause false positives during testing
- Personal environment now contains only user-managed credentials, matching the design goal

## Impact

- **Users**: Next OAuth connect for Slack will create a fresh grant with the new schema and store tokens in a dedicated managed environment
- **Data integrity**: Personal environments are purely user-managed; OAuth tokens are system-managed in labeled environments

## Related Work

- Part of project `20260411.01.mcp-oauth-managed-credentials` (T05: Migration + End-to-End Validation)
- Predecessor: `2026-04-11-200706-frontend-oauth-grant-status-session-composer.md` (T04)
- Full project context: `_projects/2026-04/20260411.01.mcp-oauth-managed-credentials/tasks.md`

---

**Status**: ✅ Production Ready
**Timeline**: Session 5 of 5 (migration portion)
