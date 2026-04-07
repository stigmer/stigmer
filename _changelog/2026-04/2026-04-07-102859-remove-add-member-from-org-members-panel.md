# Remove "Add Member" from OrgMembersPanel

**Date**: April 7, 2026

## Summary

Removed the "+ Add member" button and inline `GrantAccessForm` from `OrgMembersPanel` in `@stigmer/react`. Organization member addition now flows exclusively through the invitation system (`InvitationManager`). The members panel is now focused solely on managing existing members: viewing, changing roles, and removing.

## Problem Statement

The `OrgMembersPanel` component had a "+ Add member" action that opened a `GrantAccessForm` requiring a raw identity account ID (e.g., `ia-01HQUSER123`). This was a poor UX — end users don't know internal account IDs. With the recently shipped invitation flow (invite links with configurable roles), this raw-ID form is obsolete for the org membership use case.

### Pain Points

- Adding a member required knowing the exact identity account ID — not user-friendly
- Two competing paths to add members (direct ID vs. invitation link) created confusion
- The members panel mixed two responsibilities: member management and member onboarding

## Solution

Removed the add-member capability from `OrgMembersPanel`, leaving it as a pure member-management panel (view, change role, remove). Member onboarding is handled by `InvitationManager` on the adjacent Invitations settings page.

## Implementation Details

**File**: `sdk/react/src/iam-policy/OrgMembersPanel.tsx`

- Removed `GrantAccessForm` import (no longer used in this file)
- Removed `showAddForm` state and `handleGranted` callback
- Removed the "+ Add member" button and the inline `GrantAccessForm` card
- Collapsed the header from a nested two-div `justify-between` layout to a single `flex items-center gap-2` (no second element to justify)
- Updated the empty state text from "No members yet. Add someone to get started." to "No members found." (neutral, non-instructional fallback)
- Updated JSDoc to reflect that member addition now goes through the invitation flow

**Preserved**: `GrantAccessForm` remains exported from `@stigmer/react` as a standalone, generic IAM policy creation primitive — platform builders may still use it for granting access to any resource kind.

## Benefits

- Clearer separation of concerns: members panel manages, invitations panel onboards
- Eliminates a confusing raw-ID input that no end user would realistically use
- Reduces cognitive load on the members page — fewer actions, clearer purpose

## Impact

- **SDK consumers**: `OrgMembersPanel` no longer renders an add-member form. Platform builders who relied on it for direct member addition should use `InvitationManager` or compose `GrantAccessForm` independently.
- **Console users**: The Members settings page now shows only existing members with role/remove actions. Adding members is done via the Invitations page.
- **Public API**: No exports removed. `GrantAccessForm`, `GrantAccessFormProps`, and all hooks remain available.

## Related Work

- [Invitation React Components](2026-04-06-181319-invitation-react-components.md) — `InvitationManager` component that replaces the add-member flow
- [Invitation Redeem Handler and Console Integration](2026-04-06-182804-invitation-redeem-handler-and-console-integration.md) — Backend + Console wiring for the invitation flow

---

**Status**: Production Ready
