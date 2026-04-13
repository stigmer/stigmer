# Next Task: OAuth BYOA Integration

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260413.01.oauth-byoa-integration

**Description**: Redesign MCP server OAuth integration: implement Bring Your Own App (BYOA) support with org-level OAuth app overrides, fix 10 architectural gaps, and establish a robust OAuth app resolution chain (org override -> platform default -> manual token).

**Goal**: Implement org-level OAuth app overrides with a resolution chain, fix critical gaps (disconnect, grant health, execution refresh, vendor gate, error UX), and build the complete BYOA frontend experience.

**Tech Stack**: Protobuf, Java/Spring (stigmer-cloud), Go (stigmer), TypeScript/React (stigmer SDK), MongoDB

**Repos**: stigmer (proto + frontend), stigmer-cloud (backend)

## Task Overview (7 tasks)

| Task | Scope | Repo | Status | Depends on |
|------|-------|------|--------|------------|
| **T01** | Proto: messages, RPCs, enums, stubs | stigmer | DONE | — |
| **T02** | Backend: disconnect + grant health | stigmer-cloud | DONE | T01 |
| **T03** | Backend: harden refresh + vendor gate + error UX | stigmer-cloud | DONE | T01 |
| **T04** | Backend: BYOA infrastructure (repo, resolution, migration) | stigmer-cloud | DONE | T01 |
| **T05** | Backend: BYOA handlers + resolution chain integration | stigmer-cloud | DONE | T04 |
| **T06** | Frontend: disconnect + health + error UX | stigmer | DONE | T02, T03 |
| **T07** | Frontend: BYOA experience | stigmer | DONE | T05, T06 |

### Dependency Graph

T01 → T02 → T06 → T07
T01 → T03 → T06
T01 → T04 → T05 → T07

After T01: T02, T03, T04 can run in parallel.

## Architecture Reference

The full architecture plan with 10-gap analysis, resolution chain design, and domain analysis is at:
`~/.cursor/plans/oauth_byoa_architecture_6d4d6d67.plan.md`

### Key Architectural Decisions

1. **Per-resource BYOA binding**: `OAuthAppOverride` keyed by `(resource_id, resource_kind, org_id)` — mirrors `OAuthGrant` pattern
2. **Pre-fill from platform template**: BYOA clones platform OAuthApp, user only provides `client_id` + `client_secret`
3. **Resolution chain**: org override → platform default → none
4. **`OAuthAppOverride` is internal** (like `OAuthGrant`), not a full API resource

### 10 Identified Gaps

1. No OAuthApp admin UI (needed for BYOA)
2. No disconnect/revoke flow (grant + env cleanup)
3. Grant status != token validity (misleading "Connected")
4. Execution-path refresh soft-fails (should hard-fail)
5. `accessTokenExpiresAt == 0` = "never expires" (may not be true)
6. Token refresh always resolves platform OAuthApp (breaks BYOA)
7. No BYOA support (new feature)
8. Vendor approval gating is UI-only (backend should enforce)
9. Connect failure error UX is cryptic (raw Temporal metadata)
10. Figma "Connected" mystery (stale grant, no disconnect)

## Essential Files

### Task Plans
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260413.01.oauth-byoa-integration/tasks/
```

### Key Proto Files (stigmer)
- `apis/ai/stigmer/agentic/mcpserver/v1/spec.proto` — McpServerAuth (user intent only) + McpServerSpec
- `apis/ai/stigmer/agentic/mcpserver/v1/status.proto` — OAuthStatus + OAuthAppSource + McpServerStatus
- `apis/ai/stigmer/agentic/mcpserver/v1/oauth.proto` — OAuthGrant + OAuthAppOverride
- `apis/ai/stigmer/agentic/mcpserver/v1/io.proto` — OAuthConnectionHealth + RPC I/O messages
- `apis/ai/stigmer/agentic/mcpserver/v1/command.proto` — RPCs (13 total, 4 new)
- `apis/ai/stigmer/iam/oauthapp/v1/spec.proto` — OAuthAppSpec + VendorApprovalStatus

### Key Backend Files (stigmer-cloud)
- `domain/agentic/mcpserver/request/handler/McpServerInitiateOAuthConnectHandler.java`
- `domain/agentic/mcpserver/request/handler/McpServerCompleteOAuthConnectHandler.java`
- `domain/agentic/mcpserver/request/handler/McpServerGetOAuthGrantStatusHandler.java`
- `domain/agentic/mcpserver/request/handler/McpServerConnectHandler.java`
- `domain/agentic/mcpserver/oauth/OAuthTokenRefreshService.java`
- `domain/agentic/mcpserver/oauth/OAuthAppResolutionService.java` (new in T04)
- `domain/agentic/mcpserver/oauth/OAuthAppOverrideRepo.java` (new in T04)
- `domain/agentic/mcpserver/oauth/ManagedEnvironmentService.java`
- `domain/agentic/mcpserver/query/McpServerVendorApprovalEnricher.java`

### Key Frontend Files (stigmer)
- `sdk/react/src/mcp-server/useMcpServerCredentials.ts`
- `sdk/react/src/mcp-server/useMcpServerOAuthConnect.ts`
- `sdk/react/src/mcp-server/useOAuthGrantStatus.ts`
- `sdk/react/src/mcp-server/useDisconnectOAuth.ts` (new in T06)
- `sdk/react/src/mcp-server/McpServerDetailView.tsx`
- `sdk/react/src/mcp-server/McpServerConfigPanel.tsx`
- `sdk/react/src/mcp-server/OAuthCallbackHandler.tsx`

### Seedpack (Figma MCP server definition)
- `seedpack/mcp-servers/mcp-server-figma.yaml`
- `seedpack/mcp-servers/mcp-server-slack.yaml`

## Resume Checklist

When starting a new session:
1. [ ] Read the latest checkpoint (if any) from `checkpoints/`
2. [ ] Check current task status in `tasks/`
3. [ ] Review the architecture plan if needed
4. [ ] Review any design decisions in `design-decisions/`
5. [ ] Continue with the next task

## Session Progress (2026-04-13)

### T01 Completed
- Defined all new proto types: OAuthAppOverride, OAuthConnectionHealth, OAuthAppSource, OAuthStatus
- Added 4 new RPCs: disconnectOAuth, setOrgOAuthApp, getOrgOAuthApp, deleteOrgOAuthApp
- Added 7 new I/O messages for disconnect and BYOA operations
- Corrected spec/status violation: moved 4 read-only fields from McpServerAuth to OAuthStatus
- Updated frontend consumers (useMcpServerCredentials.ts, McpServerPicker.tsx)
- Updated backend enricher (McpServerVendorApprovalEnricher.java)
- Regenerated all stubs in both repos
- Committed: stigmer `32c8b932f`, stigmer-cloud `a7fa27fc`

### T03 Completed
- GAP 4: Execution-path OAuth refresh is now a hard failure — `McpOAuthException` propagates from `refreshIfExpired` instead of being swallowed, preventing agents from running with expired tokens that pass key-presence validation
- GAP 8: Vendor approval enforcement at the backend — `initiateOAuthConnect` rejects requests when `VendorApprovalStatus` is PENDING or REJECTED
- GAP 9: Connect workflow errors are layered — `WorkflowFailedException` extracts root cause from Temporal chain, `WorkflowServiceException` maps to UNAVAILABLE, generic catch uses INTERNAL instead of incorrect DEADLINE_EXCEEDED
- 3 files changed, 68 insertions, 11 deletions
- Committed: stigmer-cloud `22cc3ca5`

### T02 Completed
- GAP 2: Disconnect handler with idempotent desired-state semantics — `McpServerDisconnectOAuthHandler` deletes managed environment (secrets first) then grant, returns `disconnected: false` without error when no grant exists
- GAP 3: Grant health evaluation — `LookupGrant` now returns `OAuthConnectionHealth` (HEALTHY / TOKEN_EXPIRED_REFRESHABLE / TOKEN_EXPIRED / NO_GRANT) using the same 60-second buffer as `OAuthTokenRefreshService`
- Added `deleteOnBehalfOf` to `EnvironmentCommandGrpcRepo` and `deleteManagedEnvironment` to `ManagedEnvironmentService`
- Updated proto comments in `io.proto` and `command.proto` to reflect idempotent disconnect semantics
- 5 backend files changed (1 new), 17 regenerated stub files across both repos
- Committed: stigmer `597ce01a7`, stigmer-cloud `efc03ef9`

### Key Design Decisions Made
1. All new RPCs use `resource_id` (not `mcp_server_id`) — resource-agnostic pattern
2. BYOA set/delete authorized via `can_create_oauth_app` on `organization`
3. OAuthAppOverride is a separate binding document (not fields on OAuthApp)
4. Read-only enrichment fields belong in status, not spec
5. Vendor gate error message says "enter a token manually" (not "use BYOA") — BYOA doesn't exist yet, message will be updated when T05/T07 ship
6. Disconnect is idempotent (desired-state) — no error for missing grants, aligns with Stigmer's declarative platform DNA

### T04 Completed
- Proto correction: moved getOAuthGrantStatus and getOrgOAuthApp from McpServerCommandController to McpServerQueryController (read-only queries belong on query surface)
- OAuthAppOverrideDocument: plain @Data POJO following OAuthGrantDocument pattern
- OAuthAppOverrideRepo: MongoTemplate-based with find/upsert/delete by composite key (resourceId, resourceKind, orgId)
- OAuthAppResolutionService: two-step resolution chain (org override → platform default → none) with documented OAuthAppRepo cross-domain access, defensive fallthrough for deleted overrides
- U20260413 Mongock migration: oauth_app_override collection with unique compound index
- Updated McpServerGetOAuthGrantStatusHandler @RequestRoute to query controller
- Regenerated all stubs in both repos
- Architecture decision: no enricher needed — getOrgOAuthApp RPC (explicit org param) serves frontend BYOA resolution need; frontend composes effective source from three calls
- Committed: stigmer `7894f2130`, stigmer-cloud `0dea473a`

### Key Design Decisions Made (Session 4)
7. Query RPCs belong on query controller — getOAuthGrantStatus and getOrgOAuthApp are read-only with can_view authorization, not commands
8. No enricher needed for BYOA — get pipeline has no caller org context; existing getOrgOAuthApp RPC serves the same purpose
9. Authorization stays on mcp_server resource (not organization) for getOrgOAuthApp — prevents info leaks about resources the caller can't see
10. Defensive fallthrough in resolution chain — deleted override OAuthApp logs warning and falls through to platform default

### T05 Completed
- 3 new Java handlers: McpServerSetOrgOAuthAppHandler (composite create/update OAuthApp + override binding), McpServerGetOrgOAuthAppHandler (query override status), McpServerDeleteOrgOAuthAppHandler (delete OAuthApp + override)
- Wired OAuthAppResolutionService into McpServerInitiateOAuthConnectHandler — replaced direct slug lookup with resolution chain (org override → platform default → DCR)
- Wired OAuthAppResolutionService into OAuthTokenRefreshService — replaced private resolveClientSecret with resolution chain + clientId mismatch detection
- Architecture decisions: direct OAuthAppRepo.save() for BYOA OAuthApp (no FGA, internal resource), no proactive grant cleanup on delete (clientId mismatch detection instead), always re-clone from platform template on re-set
- Committed: stigmer-cloud `2b0c8f83`

### Go OSS Parity Fixes (T02/T03 dual implementation)
- Identified 5 core-classification parity gaps in Go backend during T05 work
- Edition classification: BYOA features (T04/T05) classified as cloud-only; core OAuth fixes (T02/T03) implemented in Go
- Fix 1: disconnectOAuth handler with idempotent desired-state semantics + environment Delete prereqs
- Fix 2: OAuthConnectionHealth evaluation in getOAuthGrantStatus (same 60s buffer as RefreshTokenIfExpired)
- Fix 3: Hard failure for execution-path OAuth refresh (was soft/non-fatal)
- Fix 4: Vendor approval gate enforcement in initiateOAuthConnect
- Fix 5: Layered Temporal error handling in connect workflow (replaced DeadlineExceeded catch-all)
- All Go tests pass (5 packages, 0 failures)
- Committed: stigmer `4aa82ac61`

### Key Design Decisions Made (Session 5)
11. BYOA OAuthApp is internal infrastructure — created via direct OAuthAppRepo.save(), no FGA tuples needed
12. No proactive grant cleanup on override deletion — clientId mismatch detection provides clear re-auth message
13. Always re-clone endpoint URLs from platform template on setOrgOAuthApp re-invocation
14. BYOA features classified as cloud-only — org-level overrides have no meaningful OSS equivalent
15. Go OSS parity limited to core features (disconnect, health, refresh hardening, vendor gate, error UX)

### T06 Completed
- New `useDisconnectOAuth` behavior hook wrapping `disconnectOAuth` RPC (mutation pattern: useState + useCallback + toError + rethrow)
- Enhanced `useOAuthGrantStatus` with `connectionHealth: OAuthConnectionHealth` pass-through from backend
- Enhanced `useMcpServerCredentials` with `connectionHealth` and `canDisconnect` derived state
- Health-aware status pill in ConnectBar: four states (green HEALTHY, amber TOKEN_EXPIRED_REFRESHABLE, red TOKEN_EXPIRED, muted NO_GRANT) replacing binary Connected/Not connected
- Health-aware status dot in InlineOAuthSignIn: same four states at compact density
- Inline disconnect confirmation in both ConnectBar and InlineOAuthSignIn following RevokeConfirmation pattern (no modal)
- Enhanced error strips: `getUserMessage()` for human-readable messages, "Try again" button when `isRetryableError()` is true
- Extracted `healthPillProps()` and `inlineHealthProps()` helpers to avoid deepening ternary nesting
- All new props on `McpServerOAuthSignInProps` are optional — backward compatible with `McpServerPicker`
- Exported `useDisconnectOAuth` + `UseDisconnectOAuthReturn` from barrel
- 8 files changed, 629 insertions, 68 deletions
- Committed: stigmer `80f47733c`

### Key Design Decisions Made (Session 6)
16. Disconnect uses inline confirmation (not modal) — matches `RevokeConfirmation` pattern, no portal/z-index issues for SDK embedders, proportionate to reversible action
17. Error display uses `getUserMessage()` + `isRetryableError()` from `@stigmer/sdk` rather than full `ErrorMessage` component — compact density matching vendor-approval banner pattern
18. Health pill uses extracted helper functions (`healthPillProps`, `inlineHealthProps`) instead of nested ternaries — cleaner, easier to extend for T07 BYOA states
19. `McpServerConfigPanel` stays presentational — disconnect state management wired through optional props from parent, not internal hooks

### T07 Completed
- New `useOrgOAuthApp` hook: hybrid data+behavior (auto-fetches `getOrgOAuthApp`, exposes `setOrgOAuthApp` and `deleteOrgOAuthApp` mutations bound to resource+org context)
- New `OAuthAppForm` component: pure presentational two-field form (client_id + client_secret), headless-first, themed via `--stgm-*` tokens
- Enhanced `useMcpServerCredentials` with 4 BYOA-derived fields: `effectiveOAuthSource`, `isOrgOAuthApp`, `canBringOwnApp`, `isVendorApprovalBlocked` — from backend enrichment, zero extra RPCs
- Enhanced ConnectBar: BYOA button in vendor-blocked banner, secondary link when vendor approved, org override indicator + "Remove custom app" inline confirmation, native `<dialog>` for form
- Enhanced InlineOAuthSignIn: 7 new optional BYOA props on `McpServerOAuthSignInProps`, mirrors ConnectBar at compact density
- Exported `useOrgOAuthApp`, `OAuthAppForm`, and types from barrel
- 7 files changed, 1091 insertions, 29 deletions
- Committed: stigmer `4d21a2230`

### Key Design Decisions Made (Session 7)
20. BYOA available at all vendor approval states — primary when blocked (PENDING/REJECTED), secondary when approved — Hick's Law for the common case, user control for power users
21. Save and sign-in are separate user gestures — browsers block popups from async chains, so BYOA submit says "Save" and sign-in is a subsequent click
22. `isVendorApprovalBlocked` covers both PENDING and REJECTED — existing `isVendorApprovalPending` preserved for backward compat
23. Org override bypasses vendor gate — `oauthSignInDisabled` is `false` when `isOrgOAuthApp` (the org's app is self-approved)
24. Config panel stays presentational for BYOA — receives BYOA callbacks via optional props, picker wiring is a follow-up
25. `useOrgOAuthApp` auto-fetches on mount (same pattern as `useOAuthGrantStatus`) — derive basic BYOA state from enrichment, fetch details for management UI

## Current Status

**Created**: 2026-04-13 11:03
**Completed**: 2026-04-13
**Status**: ALL 7 TASKS COMPLETE. Project done.

All 10 identified architectural gaps are addressed:
1. GAP 1: OAuthApp admin UI → T07 BYOA form + useOrgOAuthApp hook
2. GAP 2: Disconnect flow → T02 handler + T06 frontend
3. GAP 3: Grant health → T02 OAuthConnectionHealth + T06 health pills
4. GAP 4: Execution refresh → T03 hard failure
5. GAP 5: Token expiry → T02 health evaluation with 60s buffer
6. GAP 6: Token refresh resolves wrong app → T05 resolution chain
7. GAP 7: BYOA support → T04 infrastructure + T05 handlers + T07 frontend
8. GAP 8: Vendor gate enforcement → T03 backend + T06 frontend
9. GAP 9: Error UX → T03 layered errors + T06 getUserMessage
10. GAP 10: Stale grant → T02 disconnect + T06 health display

## Follow-up Items

1. ~~**`useMcpServerSetup` / picker wiring**~~: **Resolved** (2026-04-13) — After analysis, BYOA setup is an admin task that belongs on the detail page (already fully wired). The picker silently benefits from BYOA via the backend resolution chain. The actual bug was `isVendorApprovalBlocked` not being passed (REJECTED status ignored) — fixed in `ad1403adb`.
2. **Provider name resolution**: `OAuthAppForm` uses MCP server name as provider name; a dedicated `provider` field on `OAuthStatus` would be cleaner
3. ~~**`VendorApprovalStatus.REJECTED` end-to-end test**~~: **Partially resolved** (2026-04-13) — Picker now handles REJECTED via `isVendorApprovalBlocked`. Full end-to-end test still blocked on no seedpack server having REJECTED status.
