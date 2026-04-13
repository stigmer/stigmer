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
| **T02** | Backend: disconnect + grant health | stigmer-cloud | NOT STARTED | T01 |
| **T03** | Backend: harden refresh + vendor gate + error UX | stigmer-cloud | NOT STARTED | T01 |
| **T04** | Backend: BYOA infrastructure (repo, resolution, enricher) | stigmer-cloud | NOT STARTED | T01 |
| **T05** | Backend: BYOA handlers + resolution chain integration | stigmer-cloud | NOT STARTED | T04 |
| **T06** | Frontend: disconnect + health + error UX | stigmer | NOT STARTED | T02, T03 |
| **T07** | Frontend: BYOA experience | stigmer | NOT STARTED | T05, T06 |

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

### Key Design Decisions Made
1. All new RPCs use `resource_id` (not `mcp_server_id`) — resource-agnostic pattern
2. BYOA set/delete authorized via `can_create_oauth_app` on `organization`
3. OAuthAppOverride is a separate binding document (not fields on OAuthApp)
4. Read-only enrichment fields belong in status, not spec

## Current Status

**Created**: 2026-04-13 11:03
**Current Task**: T02 (Backend: disconnect + grant health)
**Status**: T01 complete. T02, T03, T04 can proceed in parallel.

## Next Steps

1. Pick T02, T03, or T04 (all unblocked, can run in parallel)
2. T02: Implement disconnect handler + grant health evaluation in stigmer-cloud
3. T03: Harden token refresh + vendor approval backend enforcement + error UX
4. T04: Build OAuthAppOverride repo, OAuthAppResolutionService, enricher integration
