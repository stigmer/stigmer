# API Key Management — React Hooks, Components, and Console Integration

**Date**: March 22, 2026

## Summary

Added full API key management to `@stigmer/react` (data hooks, behavior hooks, styled components) and wired it into the Console settings page. The backend and TypeScript SDK client already existed — this work fills the React layer gap and gives users a UI to create, list, and delete API keys from the web Console.

## Problem Statement

API key CRUD was fully implemented across protos, backend handlers, the TypeScript SDK (`ApiKeyClient`), and the CLI — but the web Console had zero API key management. Users who preferred the browser over the CLI had no way to create or manage API keys.

### Pain Points

- No web UI for creating API keys (CLI-only)
- No visibility into existing keys, their expiry, or last-used timestamps
- No way to delete compromised or stale keys from the browser
- Platform builders embedding Stigmer had no React components for API key management

## Solution

Follow the established three-layer pattern used by the Environment flow: data hooks in `@stigmer/react` consume the existing `ApiKeyClient`, styled components compose those hooks with themed UI, and the Console settings page provides a thin orchestration wrapper.

## Implementation Details

### Layer 1 — Data and Behavior Hooks (`sdk/react/src/api-key/`)

- **`useApiKeyList`**: Fetches all API keys for the authenticated identity via `findAll()`. Identity-scoped (not org-scoped), with cancellation and refetch support.
- **`useCreateApiKey`**: Wraps `apiKey.create()` with loading/error state. Returns the full `ApiKey` response including the one-time raw key in `spec.keyHash`.
- **`useDeleteApiKey`**: Wraps `apiKey.delete()` with loading/error state.

All hooks follow the same patterns as `useEnvironmentList` and `useCreateEnvironment` — `useStigmer()` for the client, `toError()` for error normalization, cancellation guards for effects.

### Layer 2 — Styled Components (`sdk/react/src/api-key/`)

- **`ApiKeyListPanel`**: Lists keys with name, fingerprint (`…abc123`), creation date, expiry, and last-used time. Inline delete confirmation (row transforms to confirm/cancel) rather than a modal.
- **`CreateApiKeyForm`**: Name input + expiry radio group (30 / 60 / 90 days / Never). Fires `onCreated` with the full API key response.
- **`ApiKeyCreatedAlert`**: One-time raw key reveal with copy-to-clipboard. Warning: "Copy this key now. It will not be shown again." Dismiss button to close.

All components use `--stgm-*` tokens via Tailwind, have no Console dependencies, and are embeddable by platform builders.

### Layer 3 — Console Integration (`client-apps/web/`)

- **`ApiKeysSection`**: Orchestrates the create/reveal flow with a discriminated union state machine (`idle | creating | reveal`). Manages refetch coordination between the form and list.
- **Settings page**: Added `ApiKeysSection` above `EnvironmentsSection`. Updated subtitle to mention API keys.

### Barrel Exports

- `sdk/react/src/api-key/index.ts` exports all hooks, components, props types, and return types.
- `sdk/react/src/index.ts` updated with the new API Key section.

## Benefits

- Users can create, view, and delete API keys from the web Console
- Platform builders can embed `<ApiKeyListPanel />` or use `useApiKeyList()` in their own apps
- Hooks are available without components for headless integrators
- One-time key reveal with clipboard support reduces the risk of key loss
- Inline delete confirmation follows proportional interruption — no disruptive modals

## Impact

- **Console users**: Full API key lifecycle management in Settings
- **Platform builders**: New SDK exports — 3 hooks, 3 components, 6 type exports
- **Public API surface**: All exports are new additions; no breaking changes
- **Files**: 8 new, 2 modified

## Related Work

- Existing backend: `stigmer-cloud/backend/services/stigmer-service/src/main/java/ai/stigmer/domain/iam/apikey/`
- Existing SDK client: `sdk/typescript/src/gen/apikey.ts` (`ApiKeyClient`)
- Pattern reference: `sdk/react/src/environment/` (Environment flow)
- CLI commands: `client-apps/cli/internal/cli/apikey/`

---

**Status**: Production ready
**Timeline**: Single session
