# OAuth App Create / Edit / Delete on Settings Page

**Date**: April 13, 2026

## Summary

Added full CRUD capabilities for OAuth apps on the Settings > OAuth Apps page. Users can now create, view, edit, and delete OAuth apps directly from settings — previously the page was read-only with management only possible through the BYOA flow on MCP server detail pages. This enables platform builders with custom MCP servers to register OAuth app credentials independently.

## Problem Statement

The `/settings/oauth-apps` page was a read-only visibility surface introduced alongside the BYOA project (T01-T07). Users could see their org's OAuth apps but could not create new ones or edit existing ones from this location. The BYOA flow on MCP server detail pages handles the common case (overriding platform vendor credentials), but users building custom MCP servers need to register OAuth apps independently — without a platform template to clone from.

### Pain Points

- No way to create an OAuth app from settings — required navigating to an MCP server detail page and using the BYOA flow
- No edit capability for any existing OAuth app (updating credentials, URLs, or scopes required recreating the resource)
- No delete capability from settings — only available through the BYOA removal flow on MCP server detail
- The `OAuthAppInput` type was not exported from `@stigmer/sdk`'s public surface, preventing platform builders from using the type directly

## Solution

Built following the platform's SDK-first architecture, mirroring the established `IdentityProvider` settings pattern:

1. **SDK layer** (`@stigmer/react`): Three mutation hooks (`useCreateOAuthApp`, `useUpdateOAuthApp`, `useDeleteOAuthApp`), a create form with progressive disclosure (`CreateOAuthAppForm`), and a view/edit/delete panel (`OAuthAppDetailPanel`)
2. **SDK layer** (`@stigmer/sdk`): Exported `OAuthAppClient` and `OAuthAppInput` from the public package surface
3. **Console layer** (`client-apps/web`): Updated `OAuthAppsSection` with `FlowState` orchestration matching the Identity Providers pattern

## Implementation Details

### SDK: Mutation Hooks (`sdk/react/src/oauth-app/`)

- **`useCreateOAuthApp`** — Wraps `stigmer.oauthapp.create()` with `{ create, isCreating, error, clearError }`. Same pattern as `useCreateIdentityProvider`.
- **`useUpdateOAuthApp`** — Wraps `stigmer.oauthapp.update()` with `{ update, isUpdating, error, clearError }`. Same pattern as `useUpdateIdentityProvider`.
- **`useDeleteOAuthApp`** — Wraps `stigmer.oauthapp.delete()` with `{ deleteApp, isDeleting, error, clearError }`. Same pattern as `useDeleteApiKey`.

### SDK: CreateOAuthAppForm

Headless-first form (no dialog wrapper) with progressive disclosure:
- **Required fields** (always visible): Name, Provider, Client ID, Client Secret (password field), Authorization URL, Token URL
- **Advanced section** (collapsed by default): Scopes, Userinfo URL, Scope parameter name, Vendor approval status (select), Vendor approval docs URL

Follows Hick's Law — the 6 essential fields are immediately visible; 5 optional fields are behind an expandable "Advanced settings" toggle.

### SDK: OAuthAppDetailPanel

View/edit panel mirroring `IdentityProviderDetailPanel`:
- **View mode**: Structured label/value layout showing all spec fields, audit timestamps, "Edit" and "Delete" buttons
- **Edit mode**: Fields become editable inputs. Client secret uses placeholder "Leave empty to keep existing secret" — only sends `clientSecret` in the update payload when explicitly changed.
- **Delete**: Inline confirmation pattern (no modal) matching the codebase convention for proportionate, reversible-feeling actions

### SDK: OAuthAppListPanel Enhancement

Added optional `onEdit?: (app: OAuthApp) => void` prop. When provided, rows show a pencil icon button. When absent, rows remain static — fully backward compatible for existing embedders.

### Console: OAuthAppsSection

Replaced the read-only wrapper with `FlowState` orchestration:
- `idle`: Shows list with `onEdit` wired + `"+ New OAuth app"` button in header
- `creating`: Shows `CreateOAuthAppForm` in a bordered card
- `editing`: Shows `OAuthAppDetailPanel` in a bordered card with back navigation

Updated description text from "Manage individual OAuth apps from the MCP server detail page" to "Create new apps here or bring your own from an MCP server's detail page."

### TypeScript SDK: Public Surface Fix

Added missing `OAuthAppClient` and `OAuthAppInput` exports to `sdk/typescript/src/index.ts`. These types existed in `gen/oauthapp.ts` but were never re-exported from the package root, preventing `import type { OAuthAppInput } from "@stigmer/sdk"`.

## Benefits

- **User flexibility**: Platform builders with custom MCP servers can register OAuth apps without going through the BYOA template-cloning flow
- **Full CRUD**: Settings page now supports create, view, edit, and delete — matching the Identity Providers pattern
- **SDK-first**: All hooks and components are available to platform builders via `@stigmer/react`; a third-party dashboard can embed the same create/edit flows
- **Backward compatible**: `OAuthAppListPanel` without `onEdit` behaves identically to before
- **Zero backend changes**: All required API endpoints already existed in the IAM OAuthApp command/query controllers

## Impact

- **End users**: Full OAuth app management from Settings > Configuration > OAuth Apps
- **Platform builders**: 3 new mutation hooks, 2 new components, and `OAuthAppInput` type now exported from `@stigmer/sdk`
- **Files changed**: 5 new (SDK hooks + components) + 5 modified (barrel exports, list panel, console section, TS SDK exports)

## Related Work

- OAuth BYOA Integration (T01-T07) — `_projects/2026-04/20260413.01.oauth-byoa-integration/`
- OAuth Apps Settings Page — `_changelog/2026-04/2026-04-13-184626-oauth-apps-settings-page.md`
- This work extends the read-only settings page into a full CRUD surface

---

**Status**: ✅ Production Ready
