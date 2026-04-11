# Next Task: 20260411.01.mcp-oauth-managed-credentials

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260411.01.mcp-oauth-managed-credentials

**Description**: Separate OAuth token storage from personal environments into per-(user, org, resource) managed environments with strict mutation protection. Generalized OAuthGrant to be resource-agnostic (keyed by identity_account_id, resource_id, org_id). Use grant.environmentId as the authoritative token locator across connect, refresh, and session execution flows.
**Goal**: Clean separation of system-managed OAuth credentials from user-managed personal environments, eliminating collision risk and mixed concerns.
**Tech Stack**: Protocol Buffers, Go (stigmer-server), Java/Spring (stigmer-cloud), TypeScript/React (SDK/UI)

## Current Status

**Created**: 2026-04-11
**Status**: T01 DONE, T02 DONE, T03 DONE, T04 DONE, T05 IN PROGRESS (migration done, E2E validation pending)
**Active Task**: T05 — Migration + End-to-End Validation
**Last Session**: 2026-04-11 (T05 migration completed — MongoDB data cleanup)

## Session Progress (2026-04-11, Session 5)

### T05 In Progress: Migration + End-to-End Validation

MongoDB data cleanup completed via direct `mongosh` connection. E2E validation pending (manual testing by user).

**Migration actions performed:**

1. **Inspected `oauth_grant` collection**: Found 1 document with old schema (`mcpServerId` instead of `resourceId`, missing `orgId` and `resourceKind` fields). Pointed to personal environment `env_01kmmdavxx9r8qxgqytva7r45k`.
2. **Inspected related environments**: Personal env had `SLACK_ACCESS_TOKEN` (old OAuth flow) + `GITHUB_TOKEN` (user-managed). No managed environments existed (clean slate).
3. **Wiped `oauth_grant` collection**: `db.oauth_grant.deleteMany({})` — removed 1 stale document.
4. **Cleaned OAuth token from personal environment**: `db.environment.updateOne(...)` — removed `spec.data.SLACK_ACCESS_TOKEN`. Only `GITHUB_TOKEN` remains.

**Verification**: `oauth_grant` count = 0, personal env `spec.data` keys = `[GITHUB_TOKEN]`.

**Remaining (E2E validation checklist — manual testing):**
- [ ] OAuth connect: tokens stored in new managed env (not personal env)
- [ ] OAuthGrant has correct `org_id` and `environment_id` pointing to managed env
- [ ] Token refresh reads from `grant.environmentId`
- [ ] MCP connect resolves OAuth vars from managed env + manual vars from personal env
- [ ] Session execution injects tokens correctly
- [ ] Frontend detail page reflects grant status
- [ ] Frontend session composer auto-resolves when grant exists
- [ ] Managed environment not visible in environment list UI
- [ ] Managed environment rejects user mutation attempts
- [ ] Personal environment contains only user-managed credentials

## Previous Sessions

### T04 Completed (Session 4): Frontend — OAuth Grant Status + Session Composer
### T03 Completed (Session 3): Connect + Refresh + Session Injection
### T02 Completed (Session 2): ManagedEnvironmentService + CompleteOAuthConnect Rewiring
### T01 Completed (Session 1): Proto + Schema Foundation

(See `tasks.md` for full details of prior sessions.)

## Next Steps

1. **T05 E2E validation (manual)** — Re-connect Slack OAuth and verify all 10 checkpoints above. The new flow should create a managed environment, store tokens there, and the frontend should reflect grant status correctly.

## Context for Resume

- All implementation tasks (T01–T04) are complete and committed.
- T05 migration is done — `oauth_grant` collection wiped, personal env cleaned of stale OAuth tokens.
- MongoDB connection: `stigmer-prod-mongo-database.planton.live:27017`, db `stigmer`, user `stigmer-app`.
- The old grant used `mcpServerId` (old schema). New grants use `resourceId` + `orgId` + `resourceKind` (three-part key).
- No managed environments exist yet — first OAuth connect will create the first one.
- Personal environment `env_01kmmdavxx9r8qxgqytva7r45k` (org: `suresh`) now only has `GITHUB_TOKEN`.
- The `getOAuthGrantStatus` handler is implemented in both Go (OSS) and Java (Cloud).
- `useOAuthGrantStatus` is a standalone hook — platform builders can import it independently.
- `useMcpServerCredentials` derives `isOAuthConnected` from the grant status API.
- `useMcpServerSetup.addServer` makes an imperative `getOAuthGrantStatus` call for OAuth servers before diffing env declarations.

## Key Design Decisions Made

1. **`resource_id` instead of `mcp_server_id`**: OAuthGrant is now resource-agnostic (T01).
2. **Downstream layer for managed env operations**: No direct repo access (T02).
3. **Re-connect reuse**: Existing managed environment reused on re-connect (T02).
4. **Split resolution in connect handlers**: OAuth vars from managed env + remaining from personal env, merged at the caller (T03).
5. **Inline refresh in session injection**: Non-fatal, best-effort refresh before reading tokens (T03).
6. **Cross-domain grant read**: AgentExecution reads from OAuthGrantStore (MCP domain) — acceptable read-only access (T03).
7. **Standalone `useOAuthGrantStatus` hook**: Independently usable by platform builders (T04).
8. **No `oauthStatus` on reducer entry**: Picker derivation from `missingVariables` is naturally correct (T04).
9. **Pool effect skips OAuth re-evaluation**: OAuth changes require explicit user action → `addServer` re-run (T04).

## Key References

- **Predecessor project**: `_projects/2026-04/20260410.03.mcp-oauth-connect/next-task.md`
- **Task list**: `_projects/2026-04/20260411.01.mcp-oauth-managed-credentials/tasks.md`
- **Architect role**: `_roles/001_architect.md`
- **Plan file (T01)**: `.cursor/plans/t01_proto_schema_foundation_e74bbe93.plan.md`
- **Plan file (T02)**: `.cursor/plans/t02_managedenv_service_b1fd0b7a.plan.md`
- **Plan file (T03)**: `.cursor/plans/t03_oauth_managed_env_9d749410.plan.md`
- **Plan file (T04)**: `.cursor/plans/t04_oauth_frontend_0153e095.plan.md`

---

*Drop this file into a new conversation to resume work on this project.*
