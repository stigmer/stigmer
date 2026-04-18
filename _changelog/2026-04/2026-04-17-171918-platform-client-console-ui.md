# PlatformClient Console UI: Full-CRUD Management in @stigmer/react

**Date**: April 17, 2026

## Summary

Built the complete PlatformClient management UI as SDK-first React components with Console integration. Six data/mutation hooks and four styled components in `@stigmer/react` provide full CRUD lifecycle — create (with one-time secret reveal), list, detail/edit, secret rotation, and delete — consumed by a new Console section at `/settings/platform-clients`. This is the UI half of T06 in the PlatformClient feature track.

## Problem Statement

Platform builders need to create and manage PlatformClient credentials through the Stigmer Console to enable the BYOA (Bring Your Own Auth) integration pattern. Without a management UI, the only way to create PlatformClients would be direct API calls — unacceptable for a production workflow that involves one-time secret handling and JIT provisioning configuration.

### Pain Points

- No UI to create PlatformClient credentials (client_id + client_secret pair)
- No way to safely reveal the one-time secret after creation or rotation
- No Console surface for configuring JIT provisioning (auto-provision accounts, auto-grant roles, allowed origins)
- PlatformClient management was invisible in the Console navigation despite having full backend CRUD (T02) and generated TypeScript client (T01)

## Solution

SDK-first architecture: build all hooks and components in `@stigmer/react` following the IdentityProvider pattern (the most feature-complete CRUD reference in the codebase), then consume from the Console as a thin orchestration layer.

## Implementation Details

### Hooks (6)

| Hook | Purpose | Returns |
|------|---------|---------|
| `usePlatformClientList(org)` | Org-scoped list with refetch | `PlatformClient[]` |
| `usePlatformClient(id)` | Single-resource fetch | `PlatformClient \| null` |
| `useCreatePlatformClient()` | Create mutation | `PlatformClientCreateResponse` (includes one-time secret) |
| `useUpdatePlatformClient()` | Update mutation | `PlatformClient` |
| `useDeletePlatformClient()` | Delete mutation | `PlatformClient` (deleted resource) |
| `useRotatePlatformClientSecret()` | Secret rotation | `PlatformClientCreateResponse` (new one-time secret) |

### Components (4)

- **`PlatformClientListPanel`** — List view with inline delete confirmation, expiry badges, JIT provisioning badges, secret fingerprint display
- **`CreatePlatformClientForm`** — Full create form: name, expiry toggle + datetime-local, JIT provisioning (auto-provision, auto-grant on org, role select), allowed origins (chip/tag input with add-on-enter)
- **`PlatformClientDetailPanel`** — View/edit modes: read-only credential display, editable spec fields, rotate secret (with inline confirmation), delete (with inline confirmation)
- **`PlatformClientSecretAlert`** — One-time secret reveal component reused for both create and rotate contexts. Shows client_id + client_secret with copy buttons.

### Console Integration

- `PlatformClientsSection` with 4-state flow machine: `idle` → `creating` → `revealing` → `editing`
- Route at `/settings/platform-clients`
- Navigation entry under "Configuration" group (Plug icon), positioned between API Keys and Environments

### Barrel Exports

- `@stigmer/sdk`: Added `PlatformClientClient` + `PlatformClientInput` (parity fix — generated class existed but wasn't re-exported)
- `@stigmer/react`: 12 value exports + 12 type exports in the public barrel

## Benefits

- **Platform builders**: Can create PlatformClients, copy credentials, configure JIT provisioning, rotate secrets, and manage lifecycle entirely through the Console
- **SDK consumers**: All hooks and components available for embedding in third-party admin panels via `@stigmer/react`
- **Consistency**: Follows established IdentityProvider pattern — same flow state machine, same inline confirmation UX, same barrel export structure
- **Theme compliance**: All visual properties via `--stgm-*` tokens, embeddable in any host app theme

## Impact

- **Who**: Platform builders using the BYOA integration pattern
- **What**: Unblocks the full PlatformClient workflow — create credentials in the Console, integrate in their backend using SDK helpers (T05), embed Stigmer React components in their app
- **Where**: `@stigmer/react` (11 new files), `@stigmer/sdk` (1 modified), Console (3 new files, 1 modified)

## Related Work

- T01: PlatformClient proto definition (session 1)
- T02: Backend CRUD + credential generation (session 2, stigmer-cloud)
- T03: Token endpoint + JWT issuance (session 3, stigmer-cloud)
- T04: Auth chain integration + JIT provisioning (session 4, stigmer-cloud)
- T05: SDK auth helpers across TypeScript/Go/Python/Java (session 5)
- T06 docs (session 7, upcoming): Documentation pass for guides and SDK docs

---

**Status**: In Progress (UI complete, documentation remaining in session 7)
**Timeline**: 1 session (session 6 of the PlatformClient feature track)
