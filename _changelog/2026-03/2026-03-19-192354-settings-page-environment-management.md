# Settings Page with Environment Management

**Date**: March 19, 2026

## Summary

Added a Settings page to the Stigmer Console with full environment management — personal environment with auto-creation, shared org environments with expandable editors, and new environment creation. Built SDK-first with three new reusable components in `@stigmer/react`, then consumed in the Console as thin wrappers.

## Problem Statement

Users had no way to view or manage their environment variables from the web console. The personal environment (introduced in the agent picker flow) stored secrets server-side but was invisible — users couldn't see what variables they had, add new ones, edit values, or remove stale entries. There was also no way to browse or manage shared organization environments.

### Pain Points

- No settings page existed in the Console (only 3 routes: home, session detail, OAuth callback)
- Personal environment variables were created automatically during agent setup but had no management UI
- Users couldn't view, edit, or delete environment variables from the browser
- No way to see what shared environments existed in the organization
- No way to create new environments from the Console

## Solution

Built environment management following the SDK-first mandate: three new styled components in `@stigmer/react` that compose the existing Layer 1 hooks, then a Console settings page that consumes them. The settings page is accessible from the UserMenu dropdown in both authenticated and local-mode menus.

## Implementation Details

### SDK Components (`@stigmer/react`)

**`EnvironmentVariableEditor`** (~800 lines) — the core component:
- Self-contained: takes `environmentId`, fetches data via `stigmer.environment.get()`, handles all CRUD
- Variable table with inline per-variable editing (immediate save on confirm)
- Secret value reveal via `getSecretValue` RPC with 30s auto-clear timer
- Inline delete confirmation (no modal)
- Collapsible "Add variable" form with key, value, isSecret toggle
- Internal sub-components: `VariableRow` (manages own reveal/edit/delete state), `AddVariableForm`, `ActionButton`
- Composes: `useUpdateEnvironmentVariables`, `useRemoveEnvironmentVariables`, `useRevealSecretValue`

**`EnvironmentListPanel`** (~250 lines):
- Lists environments for an organization with expandable inline variable editors
- `labels` prop for include filtering, `excludeLabels` for exclude filtering
- Accordion pattern: one environment expanded at a time
- Composes: `useEnvironmentList`, `EnvironmentVariableEditor`

**`CreateEnvironmentForm`** (~185 lines):
- Name (required) + description (optional)
- Composes: `useCreateEnvironment`

### Console Integration (`client-apps/web`)

- `/settings` route — server component with heading and EnvironmentsSection
- `EnvironmentsSection` — two cards:
  - **Personal Environment** (top): auto-created via `usePersonalEnvironment.getOrCreate()`, always expanded, "You" badge
  - **Shared Environments** (below): `EnvironmentListPanel` excluding personal env, "+ New environment" button revealing `CreateEnvironmentForm`
- `UserMenu` — `SettingsItem` with gear icon and `router.push("/settings")` in both auth modes

### Files Changed

| File | Type | Lines |
|------|------|-------|
| `sdk/react/src/environment/EnvironmentVariableEditor.tsx` | New | ~800 |
| `sdk/react/src/environment/EnvironmentListPanel.tsx` | New | ~250 |
| `sdk/react/src/environment/CreateEnvironmentForm.tsx` | New | ~185 |
| `sdk/react/src/environment/index.ts` | Modified | +6 |
| `sdk/react/src/index.ts` | Modified | +8 |
| `client-apps/web/src/app/settings/page.tsx` | New | 14 |
| `client-apps/web/src/components/settings/EnvironmentsSection.tsx` | New | ~170 |
| `client-apps/web/src/components/layout/UserMenu.tsx` | Modified | +15 |

## Benefits

- **Users can manage secrets**: view, add, edit, remove environment variables from the browser
- **Personal environment is visible**: users can see what credentials are stored and manage them
- **Org environment discoverability**: all accessible environments listed in one place
- **Platform builder embeddability**: `EnvironmentVariableEditor` is a drop-in component — `<EnvironmentVariableEditor environmentId="..." />` just works inside a `StigmerProvider`
- **Consistent UX**: inline per-variable save matches GitHub Actions / Vercel / Netlify conventions

## Impact

- **Direct users**: First settings page in the Console. Environment management joins session management as the second major Console capability.
- **Platform builders**: Three new exportable components from `@stigmer/react`. The `EnvironmentVariableEditor` is the primary new integration point — platform builders embedding Stigmer can now offer env var management in their own settings pages.
- **SDK surface**: 3 new value exports + 3 new type exports from `@stigmer/react`.

## Related Work

- Personal environment hooks (Session 12): `usePersonalEnvironment` with get-or-create, addVariables, removeVariables
- Environment variable management RPCs (sub-project 05): `updateVariables`, `removeVariables`, `getSecretValue`
- Agent picker + personal environment flow (Sessions 1-15): the infrastructure this settings page makes visible and manageable

---

**Status**: Production Ready (pending e2e validation)
**Timeline**: Single session (~2 hours)
