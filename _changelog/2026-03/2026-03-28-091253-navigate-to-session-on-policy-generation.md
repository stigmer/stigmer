# Navigate to Session View on Approval Policy Generation

**Date**: March 28, 2026

## Summary

When users click "Generate Policies" or "Regenerate Policies" on an MCP server detail page, the app now navigates to the full session view instead of rendering an inline execution panel. This also resolves the sidebar session list not refreshing after policy generation.

## Problem Statement

Clicking "Regenerate Policies" triggered a session and execution behind the scenes, then displayed an inline `ApprovalPolicyGeneratorPanel` embedded within the MCP server detail page. This inline panel was a stripped-down view that lacked the full session experience: no follow-up composer, no execution progress sidebar, no artifacts widget, and no cost summary.

### Pain Points

- Users could not interact with the agent during policy generation (no follow-up messages)
- The inline panel showed a minimal thread view without execution metadata
- The sidebar session list did not update because the route never changed
- The newly created session was invisible until a manual page refresh

## Solution

Added an `onPolicySessionCreated` callback prop to the SDK's `McpServerDetailView` component. The Console's `McpServerDetailPage` provides a callback that navigates to `/sessions/{sessionId}` after the policy generation session is created, landing the user in the standard session view with full capabilities.

## Implementation Details

### SDK Layer (`@stigmer/react`)

Added optional `onPolicySessionCreated` prop to `McpServerDetailViewProps` in `McpServerDetailView.tsx`. When the callback is provided, the component calls it with `{ sessionId, executionId }` after triggering the session instead of rendering the inline panel. When omitted, the existing inline `ApprovalPolicyGeneratorPanel` behavior is preserved for backward compatibility.

### Console Layer (`client-apps/web`)

`McpServerDetailPage.tsx` passes a `handlePolicySessionCreated` callback that calls `navigateTo('/sessions/${sessionId}')`. Since `navigateTo` performs a full page load, the sidebar remounts and fetches the fresh session list, making the new session immediately visible and highlighted as the active entry.

## Benefits

- Users get the full session experience during policy generation (composer, progress, artifacts)
- The sidebar session list updates automatically — no manual refresh needed
- The approach is backward compatible — SDK consumers without a session page keep the inline panel
- Platform builders get a clean integration point to handle session creation however fits their app

## Impact

- **SDK**: New optional prop on `McpServerDetailView` — non-breaking, additive change
- **Console**: MCP server detail page now navigates away on policy generation instead of showing an inline panel
- **Sidebar**: Session list refresh is resolved as a side effect of the navigation change

## Related Work

- MCP server discovery and approval policy generation (`2026-03-27-092434`)
- MCP tool rendering and approval card beautification (`2026-03-28-085412`)

---

**Status**: ✅ Production Ready
