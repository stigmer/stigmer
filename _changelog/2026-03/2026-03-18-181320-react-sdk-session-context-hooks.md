# React SDK Session Context Hooks

**Date**: March 18, 2026

## Summary

Extended the React SDK's session hooks to support MCP server usages and skill references in both session creation and mid-conversation updates. Refactored `sendFollowUp` from positional parameters to an options-object signature, enabling clean extension for future session-level context fields.

## Problem Statement

The session proto (`SessionSpec`) gained `mcp_server_usages` and `skill_refs` fields (T01.1), and the TypeScript SDK codegen produced the corresponding `SessionInput` types (T01.3). However, the React SDK hooks (`useCreateSession`, `useSessionConversation`) did not expose these fields, meaning platform builders had no way to pass MCP servers or skills through the standard hook API.

### Pain Points

- `CreateSessionInput` lacked `mcpServerUsages` and `skillRefs` -- platform builders could not attach MCP servers or skills at session creation time
- `sendFollowUp` used positional parameters `(message, modelName?, workspaceEntries?)` -- adding more optional fields would create an unwieldy signature
- `useSessionConversation` did not expose the session's MCP server usages or skill references as read-only state
- `buildUpdateInput` only accepted workspace entries as an explicit override -- MCP and skill changes mid-conversation were not supported

## Solution

1. Added `mcpServerUsages` and `skillRefs` to `CreateSessionInput` and wired them through to `stigmer.session.create()`
2. Introduced `SendFollowUpOptions` interface and refactored `sendFollowUp` to `(message, options?)` signature
3. Extended `buildUpdateInput` to accept an overrides object -- any provided field replaces the session value, omitted fields are preserved by converting the session proto back to input format
4. Exposed `mcpServerUsages` and `skillRefs` as read-only arrays in the `useSessionConversation` return type
5. Updated all Console call sites and JSDoc examples to match the new signature

## Implementation Details

### New Types

- `SendFollowUpOptions` -- exported from `@stigmer/react`, contains `modelName`, `workspaceEntries`, `mcpServerUsages`, `skillRefs`

### Modified Hooks

- `useCreateSession` -- `CreateSessionInput` extended with two optional fields, passed through to SDK client
- `useSessionConversation` -- `sendFollowUp` refactored, `mcpServerUsages`/`skillRefs` memos added, `buildUpdateInput` restructured with extracted helper functions (`specWorkspaceToInput`, `specMcpUsagesToInput`, `specSkillRefsToInput`)

### Console Updates

- `SessionPage.tsx` -- `handleSubmit` migrated from positional args to options object

### JSDoc Updates

- `FollowUpInput.tsx` and `SessionComposer.tsx` -- examples updated to show `sendFollowUp(msg, { modelName: model })`

## Benefits

- Platform builders can now attach MCP servers and skills at session creation via `useCreateSession`
- Mid-conversation MCP/skill changes are supported through `sendFollowUp` options
- The options-object pattern is extensible -- future session-level fields can be added without signature changes
- Read-only `mcpServerUsages` and `skillRefs` arrays let consumers render the session's current context

## Impact

- **Platform builders**: New fields on `CreateSessionInput`, new `SendFollowUpOptions` type, expanded `UseSessionConversationReturn`
- **Console**: `SessionPage` updated to new signature -- no behavioral change
- **Breaking**: `sendFollowUp` signature changed from positional to options object. Migration is mechanical: `sendFollowUp(msg, model, ws)` becomes `sendFollowUp(msg, { modelName: model, workspaceEntries: ws })`

## Related Work

- Session context composition project (20260318.01.session-context-composition)
- T01.1-T01.5: Proto, stub, codegen, backend verification (complete)
- T01.7/T01.8: MCP Server Picker and Skill Picker components (next)
- T01.9: Console SessionLauncher integration (depends on T01.7/T01.8)

---

**Status**: Production Ready
