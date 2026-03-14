# CLI Draft Commands: System Agent Org Alignment

**Date**: March 14, 2026

## Summary

Updated the CLI's draft commands (`stigmer draft skill`, `stigmer draft agent`, `stigmer draft mcp-server`) to resolve system agent blueprints from the hardcoded "stigmer" organization, aligning with the web console's `SYSTEM_AGENT_ORG` convention introduced during T06: Draft Flows.

## Problem Statement

After the seedpack org rename from "default" to "stigmer" (commit `af82e13a`), the web console was updated to resolve system agent blueprints (skill-creator, agent-creator, mcp-server-creator) from the "stigmer" org. The CLI still used the user's active organization for agent resolution, creating an inconsistency: draft commands would fail unless the user happened to be operating in the "stigmer" org.

### Pain Points

- CLI draft commands broke when the user's active org was anything other than "stigmer"
- Inconsistency between CLI and web console for the same operation
- Error messages referenced stale troubleshooting steps ("server reset && server")

## Solution

Introduced a `systemAgentOrg` constant (matching the web console's `SYSTEM_AGENT_ORG`) and used it for agent resolution in `executeDraft`, while leaving execution creation on the user's active org via `prep.OrgID`.

## Implementation Details

**File changed**: `client-apps/cli/cmd/stigmer/root/draft_handler.go`

- Added `const systemAgentOrg = "stigmer"` — single source of truth for system agent org
- Changed `agentRef` construction from `prep.OrgID + "/" + cfg.AgentName` to `systemAgentOrg + "/" + cfg.AgentName`
- Changed `resolveAgent` call to pass `systemAgentOrg` instead of `prep.OrgID`
- Updated `displayDraftAgentNotFoundError` to reference the seedpack installation and provide accurate troubleshooting steps

**Two-context org distinction preserved**: agent *resolution* targets "stigmer", while execution *creation* continues to use `prep.OrgID` (the user's active org) — identical semantics to the web console.

## Benefits

- CLI and web console now behave identically for draft commands
- Draft commands work regardless of which org the user has active
- Error messages accurately guide users to re-apply the seedpack

## Impact

- **CLI users**: Draft commands now work in any org context
- **Platform consistency**: Unified system agent resolution across all client surfaces (CLI + web console)

## Related Work

- [Web Console Organization Context](2026-03-14-084504-web-console-organization-context.md)
- [Agent-Fleet Org Portability](2026-03-14-084119-agent-fleet-org-portability.md)
- Seedpack org rename: commit `af82e13a`
- Web console `SYSTEM_AGENT_ORG` in `client-apps/web-console/src/config/draft.ts`

---

**Status**: ✅ Production Ready
