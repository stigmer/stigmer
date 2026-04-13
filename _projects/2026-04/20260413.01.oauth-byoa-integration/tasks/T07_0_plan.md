# Task T07: Frontend — BYOA Experience

**Created**: 2026-04-13 11:03
**Status**: NOT STARTED
**Repo**: stigmer
**Estimated scope**: ~8-10 files
**Depends on**: T05 (BYOA backend handlers), T06 (frontend gap fixes — shared component surface)

## Objective

Build the complete BYOA frontend experience: the OAuthApp form (client_id + client_secret), the hook for managing org OAuth app overrides, and integration into the MCP server detail view and config panel.

## Context

This is the capstone task. By the time we get here, the backend supports the full resolution chain (T04+T05) and the frontend already has disconnect + health display (T06). This task adds the "Bring your own app" action.

### User Flow

1. User visits MCP server page. Platform OAuth is PENDING/REJECTED.
2. User sees "Bring your own app" button alongside "Enter token manually"
3. Clicks "Bring your own app" — modal/sheet opens with `OAuthAppForm`
4. User enters their `client_id` and `client_secret`
5. Submits → `setOrgOAuthApp` creates OAuthApp + override
6. Modal closes, ConnectBar updates to show "Sign in with your app"
7. User clicks sign in → standard OAuth flow using the org's app
8. After connect, shows green "Connected" with the org's app

### BYOA Removal Flow

1. User sees "Using your OAuth app" indicator
2. Clicks "Remove custom app" (in dropdown/secondary action)
3. Confirmation dialog
4. `deleteOrgOAuthApp` removes override + grant
5. UI reverts to platform OAuth state (PENDING → shows BYOA option again)

## Deliverables

### 1. `OAuthAppForm` component

New component at `sdk/react/src/mcp-server/OAuthAppForm.tsx`:

A two-field form showing:
- Vendor name (read-only, from platform OAuthApp provider)
- Brief instruction text: "Register an OAuth app with {provider} and enter your credentials below"
- `client_id` input (text, required)
- `client_secret` input (password/secret, required)
- Submit button: "Save and connect"
- Cancel button

Props:
```typescript
interface OAuthAppFormProps {
  providerName: string;
  onSubmit: (clientId: string, clientSecret: string) => Promise<void>;
  onCancel: () => void;
  isSubmitting: boolean;
  error: Error | null;
}
```

### 2. `useOrgOAuthApp` hook

New hook at `sdk/react/src/mcp-server/useOrgOAuthApp.ts`:

```typescript
export function useOrgOAuthApp(resourceId: string | null, org: string | null): {
  hasOverride: boolean;
  oauthAppId: string | null;
  clientId: string | null;  // for display (masked)
  isLoading: boolean;
  error: Error | null;
  setOrgOAuthApp: (mcpServerId: string, org: string, clientId: string, clientSecret: string) => Promise<void>;
  deleteOrgOAuthApp: (resourceId: string, org: string) => Promise<void>;
  isSubmitting: boolean;
  refetch: () => void;
}
```

### 3. Enhance `useMcpServerCredentials`

New derived state:
- `effectiveOAuthSource` — from `spec.auth.effective_oauth_source` (enriched at query time)
- `isOrgOAuthApp` — `effectiveOAuthSource === ORG_OVERRIDE`
- `canBringOwnApp` — `authMode === "oauth" && !isOrgOAuthApp && oauth_app_ref is set`
  (BYOA only makes sense for vendor OAuth MCP servers with a platform template)

### 4. ConnectBar BYOA integration in `McpServerDetailView`

**When platform OAuth is PENDING/REJECTED and no org override:**
- Existing: Amber "Pending approval" pill + disabled sign-in + "Enter token manually"
- New: Add "Bring your own app" button below/alongside "Enter token manually"
- Clicking opens the BYOA modal with `OAuthAppForm`

**After BYOA setup (org override exists):**
- Show "Sign in with your app" button (enabled, uses org's OAuthApp)
- Small indicator: "Using your OAuth app" with option to remove
- Vendor approval pill changes to reflect org app is `APPROVED`

**Remove custom app:**
- Secondary action (dropdown or icon button)
- Confirmation dialog
- After removal: reverts to platform state

### 5. InlineOAuthSignIn BYOA integration in `McpServerConfigPanel`

Mirror the ConnectBar changes:
- "Bring your own app" option when platform pending
- "Using your OAuth app" indicator when override exists
- Remove action

### 6. BYOA Modal/Sheet

The form can be either:
- A modal dialog (simpler, recommended for initial implementation)
- A slide-out sheet (more space for instructions)

Include:
- Vendor logo/name header
- Link to vendor's OAuth app registration page (from `vendor_approval_docs_url`)
- The `OAuthAppForm`

### 7. Export new components and hooks

Add to `sdk/react/src/mcp-server/index.ts`:
- `OAuthAppForm`
- `useOrgOAuthApp`

## Files to Create/Modify

| File | Action | What |
|------|--------|------|
| `OAuthAppForm.tsx` | Create | Two-field BYOA form component |
| `useOrgOAuthApp.ts` | Create | Hook for set/get/delete org OAuth app |
| `useMcpServerCredentials.ts` | Modify | Add `effectiveOAuthSource`, `isOrgOAuthApp`, `canBringOwnApp` |
| `McpServerDetailView.tsx` | Modify | BYOA button, modal, post-setup state, remove action |
| `McpServerConfigPanel.tsx` | Modify | BYOA in InlineOAuthSignIn |
| `index.ts` | Modify | Export new components/hooks |

## Acceptance Criteria

- [ ] "Bring your own app" appears when platform OAuth is PENDING/REJECTED
- [ ] Form collects only client_id and client_secret (nothing else)
- [ ] After submit, org OAuthApp is created and override binding is established
- [ ] "Sign in with your app" immediately available after BYOA setup
- [ ] OAuth flow works end-to-end with org's credentials
- [ ] "Remove custom app" deletes override and reverts to platform state
- [ ] "Bring your own app" does NOT appear for:
  - Manual-only MCP servers (no `spec.auth`)
  - DCR MCP servers (no `oauth_app_ref`)
  - MCP servers where platform OAuth is already APPROVED
- [ ] When org override exists, vendor approval gating is bypassed (org's app is self-approved)

## Predecessor Tasks

T05 (BYOA backend handlers), T06 (frontend gap fixes)

## Successor Tasks

None — this is the final task. After completion:
- Full BYOA flow works end-to-end
- All 10 gaps are fixed
- Resolution chain is fully integrated
