# Identity Provider React SDK Feature Folder

**Date**: April 5, 2026

## Summary

Built the complete `sdk/react/src/identity-provider/` feature folder with 3 data hooks, 3 mutation hooks, and 2 styled components — plus the prerequisite backend `listByOrg` RPC that enables listing identity providers by organization. This is Phase 6 of the identity provider flow project, making IdP management embeddable in any platform builder's app through the `@stigmer/react` SDK.

## Problem Statement

Phase 5 completed the backend identity provider flow (federated account creation, SSO data model, secure lookups), but there was no way for platform builders to manage identity providers from the UI. The React SDK had zero identity-provider coverage — no hooks, no components, no way to list, create, update, delete, or discover SSO providers.

### Pain Points

- No React SDK hooks for identity provider CRUD operations
- No `listByOrg` query RPC — the search service indexes only `agent, skill, mcp_server, workflow`, not identity providers
- No styled components for IdP management (list panel, create form)
- Platform builders embedding Stigmer had no reusable UI for IdP administration
- SSO login page had no hook for discovering an org's SSO provider without authentication

## Solution

End-to-end implementation from proto through backend to React SDK:
1. Added a `listByOrg` RPC to `IdentityProviderQueryController` with org-level authorization
2. Implemented the backend handler in stigmer-cloud
3. Ran the full codegen pipeline (proto → JSON schemas → SDK stubs across Go/Java/Python/TypeScript)
4. Built the complete React SDK feature folder following established patterns from `api-key` and `session`

## Implementation Details

### Proto Changes (stigmer repo)

- **`io.proto`**: Added `ListIdentityProvidersByOrgInput` message with validated `org` field
- **`query.proto`**: Added `listByOrg` RPC with `resource_kind = organization`, `permission = can_view`, `field_path = "org"` — ensures only org members with view permission can list IdPs

### Backend Handler (stigmer-cloud repo)

- **`IdentityProviderListByOrgHandler.java`**: `CustomOperationHandlerV2` with pipeline: `validateFieldConstraints → authorize → LoadByOrg → sendResponse`. Uses the existing `IdentityProviderRepo.findByOrg(org)` method.
- Updated `IdentityProviderGrpcAutoController.java` comment to include `listByOrg` in generated method constants.

### Codegen Pipeline

- Ran `make protos` which executes the full pipeline:
  - `proto2schema --comprehensive` regenerates JSON schemas from protos
  - Codegen generator produces SDK stubs from schemas
  - All stubs regenerated: Go, Java, Python, TypeScript, MCP server
- The TS SDK `IdentityProviderClient` automatically gained a `listByOrg()` method

### React SDK: Data Hooks

- **`useIdentityProviderList(org)`** — Fetches all IdPs for an org. Constructs proper proto message via `create(ListIdentityProvidersByOrgInputSchema, { org })`. Returns flat list (IdPs are small cardinality, no pagination needed).
- **`useIdentityProvider(id)`** — Single IdP by ID with `refetch()` support.
- **`useSsoProvider(org)`** — Unauthenticated SSO discovery. Uses `isNotFound()` from `@stigmer/sdk` to treat NOT_FOUND as absence (null), not error — critical for login pages where SSO may not be configured.

### React SDK: Mutation Hooks

- **`useCreateIdentityProvider()`** — Wraps `identityProvider.create()` with `isCreating` and error state.
- **`useUpdateIdentityProvider()`** — Wraps `identityProvider.update()` with `isUpdating` and error state.
- **`useDeleteIdentityProvider()`** — Wraps `identityProvider.delete()` accepting `DeleteResourceInput` with `isDeleting` and error state.

### React SDK: Styled Components

- **`<IdentityProviderListPanel org={...} />`** — Self-contained list panel with shield icon, SSO badge, edit/delete buttons, inline delete confirmation, loading skeletons, empty state, and error display. Composes `useIdentityProviderList` + `useDeleteIdentityProvider`.
- **`<CreateIdentityProviderForm org={...} onCreated={...} />`** — Form collecting name, JWKS URI, allowed issuers (comma-separated), expected audience, and optional SSO toggle with conditional OIDC client ID. Client-side validation, spinner during submission, and accessible toggle switch.

### Barrel Exports

- Feature barrel `sdk/react/src/identity-provider/index.ts` — exports all 6 hooks, 2 components, 8 return/props types
- Root barrel `sdk/react/src/index.ts` — added identity-provider section between API Key and Error sections

## Benefits

- **Platform builders** can embed IdP management in their apps with `<IdentityProviderListPanel org="acme" />` and `<CreateIdentityProviderForm org="acme" />`
- **Headless-first**: All 6 hooks are independently importable — `useIdentityProviderList` without any styled component
- **SSO discovery**: `useSsoProvider` works unauthenticated, enabling SSO login buttons on custom login pages
- **Zero Console dependencies**: All components use `@stigmer/theme` tokens and `cn()`, no Next.js or app-shell assumptions
- **Type safety**: Proper proto message construction via `create()` + `Schema` — TypeScript catches misuse at compile time
- **Pattern consistency**: Every hook follows the established `useSession`/`useCreateApiKey`/`useDeleteApiKey` patterns with identical return shapes

## Impact

- **Files changed**: ~55 files across stigmer (proto, stubs, SDK) and stigmer-cloud (handler)
- **New files**: 9 React SDK files, 1 Java handler, 2 Java stubs
- **Codegen artifacts**: Regenerated stubs in Go, Java, Python, TypeScript, Dart, MCP server
- **APIs affected**: `IdentityProviderQueryController` gained `listByOrg` RPC
- **SDK surface area**: `@stigmer/react` gained 6 hooks, 2 components, 8 types

## Related Work

- [IAM Client-Side Codegen, SDK React, and Console](2026-04-05-132215-iam-client-side-codegen-sdk-react-console.md) — Companion `iam-policy` feature folder (hooks + components for role granting). Console pages in Phase 7 will compose identity-provider and iam-policy components together.
- Phase 5: Secure Identity Account Lookups — Backend prerequisite that this phase builds UI for
- Phase 4: Self-Managed SSO Data Model — The `useSsoProvider` hook surfaces the SSO config added in Phase 4

---

**Status**: ✅ Production Ready
**Timeline**: 1 session
