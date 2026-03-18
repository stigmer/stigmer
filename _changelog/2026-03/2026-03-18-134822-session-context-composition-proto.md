# Session Context Composition: Proto Schema

**Date**: March 18, 2026

## Summary

Added `mcp_server_usages` and `skill_refs` fields to `SessionSpec`, enabling users to attach MCP servers and skills at session creation time. This is the foundational proto change for the session context composition feature — all downstream work (stubs, SDK, backend, UI) depends on this schema.

## Problem Statement

Users could only configure MCP servers and skills at the agent blueprint level. To use a different set of tools or knowledge for a specific conversation, they had to create a new agent or modify the existing blueprint — both heavyweight operations for what should be a per-session concern.

### Pain Points

- No way to augment an agent's capabilities for a single conversation
- Modifying an agent blueprint affects all sessions, not just the one that needs the change
- The session launcher couldn't express "use this agent, but also give it access to my GitHub MCP server for this conversation"

## Solution

Extended `SessionSpec` with two new repeated fields that mirror the corresponding fields on `AgentSpec`:

- `mcp_server_usages` (field 7): Reuses `McpServerUsage` from the agent spec, maintaining consistent ubiquitous language
- `skill_refs` (field 8): Uses `ApiResourceReference` with `reference_kind = skill`, same pattern as `AgentSpec.skill_refs`

Both fields include CEL validation matching the agent spec patterns, with `session_`-prefixed rule IDs to avoid collision.

## Implementation Details

**File**: `apis/ai/stigmer/agentic/session/v1/spec.proto`

- Added four imports: `agent/v1/spec.proto`, `field_options.proto`, `io.proto`, `buf/validate/validate.proto`
- Added `mcp_server_usages` field with CEL validation: `this.mcp_server_ref.kind == 44`
- Added `skill_refs` field with `reference_kind = skill` and CEL validation: `this.kind == 43`
- Doc comments document merge semantics: session-level usages union with agent-level, session takes precedence on slug collision

**Design decisions**:

- Reused `McpServerUsage` from agent spec rather than creating a session-specific variant — same concept, same type, same merge code
- Added CEL validation even though the original plan omitted it — catches invalid `kind` references at the API boundary instead of at runtime
- Merge logic deferred to agent runner (Python) — backend just persists the fields

## Benefits

- Users can attach MCP servers and skills per-session without modifying agent blueprints
- Session launcher becomes the single-screen product pitch: message + workspace + skills + MCP servers + model
- Consistent validation across agent and session spec fields
- Clean additive schema change — no breaking changes to existing protos

## Impact

- **Proto schema**: New fields on `SessionSpec` — all consumers (Go, Java, TypeScript stubs) need regeneration
- **Backend**: Go and Java backends need verification that normalization handles nested `ApiResourceReference` fields
- **SDK**: TypeScript SDK codegen will pick up new fields automatically
- **React SDK**: `useCreateSession` hook and session launcher UI will expose the new fields
- **Agent Runner**: Will implement merge logic in a follow-up task

## Related Work

- Depends on: Session-first web UX project (20260317.01, complete)
- Enables: T01.2-T01.9 (stub regen, backend verification, SDK updates, UI components)
- Follow-up: T02 (Agent Runner merge implementation in Python)

---

**Status**: Production Ready
**Timeline**: ~30 minutes
