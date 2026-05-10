# Inline detail editing and skill artifact duplicate warning

**Date**: May 10, 2026

## Summary

Shipped a reusable inline-editing layer in `@stigmer/react`, wired it into Agent and MCP server detail views, and removed the Console’s draft-session primary edit path for agents. Added a client-side SHA-256 check before skill upload so operators see a clear duplicate-artifact warning with an explicit override. Together this moves resource management closer to “edit where you read” without sacrificing validation or recovery UX.

## Problem Statement

Detail hubs were largely read-only after Phase 2 shells landed; changing an agent or MCP server meant leaving context (draft session or external tooling). Skill uploads could silently re-push identical ZIP payloads, wasting backend work and confusing version timelines.

### Pain Points

- High-friction edits for agents and MCP servers on the web Console.
- Duplicate skill pushes had no upfront signal tied to artifact identity.
- Primary “Edit” on agents routed through an older draft-session pattern inconsistent with other resources.

## Solution

Introduced focused primitives (`inline-edit/`), thin converters from live protos to apply inputs, mutation hooks on top of existing `apply` RPCs, and `editable` + `onResourceUpdated` props on the two detail views. For skills, hash ZIP bytes once during upload flow and compare to the remote skill’s stored artifact fingerprint when available.

## Implementation Details

- **`sdk/react/src/inline-edit/`** — Text, textarea, image, select, key/value, and resource-list editors sharing `useInlineFieldSave` for pending/dirty/success/error UI.
- **`agent/internal/agentToInput.ts`**, **`mcp-server/internal/mcpServerToInput.ts`** — Serialize current resource state into shapes suitable for `useUpdateAgent` / `useUpdateMcpServer`.
- **`useUpdateAgent`**, **`useUpdateMcpServer`** — Call `stigmer.agent.apply` / `stigmer.mcpServer.apply`, then invoke `onResourceUpdated` so parents refetch.
- **`AgentDetailView`**, **`McpServerDetailView`** — Conditional inline sections; header/meta adjusted when `editable` to avoid duplicated description/icon blocks.
- **`client-apps/web` detail pages** — Pass `editable`; agent page drops `getEditSessionUrl` / primary draft-session edit.
- **`skill/internal/computeArtifactHash.ts`**, **`useSkillDuplicateCheck`**, **`SkillUploader`** — SHA-256 over upload bytes; banner + “Push Anyway” when hash matches remote.

Lint compliance: `InlineEditSelect` uses theme tokens without forbidden opacity modifiers on status colors (`stigmer/no-token-opacity-modifiers`).

## Benefits

- Faster iteration on blueprints from the same screen used for inspection.
- Fewer accidental duplicate skill pushes; intentional re-push remains one click.
- Clearer mental model: Console aligns agent editing with MCP and other library resources.

## Impact

- **SDK consumers** — New exports and props; default non-editable behavior unchanged.
- **Console** — Agent and MCP detail pages support inline saves; agent draft-session edit removed as primary path.
- **Skills** — Upload dialog gains duplicate detection when server exposes comparable artifact identity.

## Related Work

- Project tracking: `_projects/2026-05/20260508.02.resource-views-ux-overhaul/next-task.md` (Session 19).
- Builds on Phase 2 `resource-detail` shells and Phase 3 skill upload flow.

---

**Status**: ✅ Production Ready (feature-complete for scoped fields; MCP tags/auth editing deferred)
**Timeline**: Single-session implementation (2026-05-10)
