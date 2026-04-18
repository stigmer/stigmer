# Task T06: Console UI + Documentation

**Created**: 2026-04-17
**Status**: NOT STARTED
**Estimated effort**: 2 sessions
**Repo**: stigmer (React SDK, Console, docs)
**Depends on**: T01 (proto stubs), T02 (CRUD backend functional)

## Objective

Build React components for PlatformClient management in `@stigmer/react`, wire them into the Console, and create documentation that guides platform builders through the PlatformClient integration flow.

## Task Breakdown

### 1. React Components in `@stigmer/react`

**Hooks:**
- `usePlatformClientList(orgId)` — fetch all PlatformClients for an org
- `usePlatformClient(id)` — fetch a single PlatformClient by ID
- `useCreatePlatformClient()` — mutation hook for creating a PlatformClient
- `useDeletePlatformClient()` — mutation hook for deleting
- `useRotatePlatformClientSecret()` — mutation hook for secret rotation

**Components:**
- `CreatePlatformClientForm` — form for creating a new PlatformClient (name, auto_provision_accounts toggle, auto_grant_on_org selector, auto_grant_role selector)
- `PlatformClientListPanel` — list view showing all PlatformClients in an org (name, client_id, secret fingerprint, created date)
- `PlatformClientDetailPanel` — detail view for a single PlatformClient (all spec fields, secret rotation button, delete button)
- `PlatformClientSecretDisplay` — one-time secret display after creation (copy button, warning that it won't be shown again). Follow ApiKey creation pattern.
- `PlatformClientQuickStart` — inline code snippet showing how to use the client_id + client_secret (copy-pasteable Node.js and Go examples)

**Export from `@stigmer/react`:**
- All hooks and components exported from `sdk/react/src/index.ts`
- Gated by `useResourceAvailable(ApiResourceKind.platform_client)` for deployment mode

### 2. Console Pages in `client-apps/web`

- Add PlatformClient section under IAM/Settings in the Console navigation
- Page: list view with create button → create form → secret display → list with new entry
- Page: detail view with configuration editing, secret rotation, and deletion
- Follow existing IAM page patterns (ApiKey pages, IdentityProvider pages)

### 3. Documentation

**New guide: `docs/guides/platform-client/`**

Pages:
- `overview.mdx` — What is a PlatformClient? When to use it vs API keys vs federation. Comparison table of all three auth paths.
- `quick-start.mdx` — 5-minute setup guide:
  1. Create a PlatformClient in the Console
  2. Add one endpoint to your backend (code examples in Node.js, Go, Python)
  3. Wire `getAccessToken` in your React app
  4. Done — first API call works
- `token-endpoint.mdx` — Full reference for `POST /oauth/token` (request format, grant types, response format, error codes)
- `auto-provisioning.mdx` — How JIT user provisioning works, configuring auto_grant_on_org and auto_grant_role, multi-tenant patterns

**Update existing docs:**
- `docs/sdk/react/index.mdx` — Add PlatformClient as a third auth method alongside apiKey and federation
- `docs/sdk/index.mdx` — Add PlatformClient to the auth methods overview, add clientId/clientSecret config docs
- `docs/sdk/node/index.mdx` (if exists) — Add clientId/clientSecret config
- `docs/guides/federation/overview.mdx` — Add a callout: "If you don't have an OIDC provider, consider using a PlatformClient instead"

### 4. Interactive Demos (optional, time permitting)

- `DemoPlatformClientSetup` — walkthrough of creating a PlatformClient and using the token endpoint
- Follow the existing demo framework pattern from `site/src/components/docs/demos/`

## Key Design Decisions

- **Components in `@stigmer/react`, not `client-apps/web`**: PlatformClient management is something platform builders might embed in their own admin panels. Build it in the SDK first.
- **Quick-start is the hero doc**: The entire point of PlatformClient is reducing friction. The docs must demonstrate the "5-minute integration" promise.
- **Code examples in all server languages**: Node.js, Go, Python — matching the SDK languages that support clientId/clientSecret.

## Success Criteria

- [ ] All React hooks and components exported from `@stigmer/react`
- [ ] Console pages functional: create, list, detail, rotate, delete
- [ ] Secret display on creation follows one-time pattern (like ApiKey)
- [ ] Documentation guide with overview, quick-start, token endpoint reference
- [ ] SDK docs updated with PlatformClient as third auth path
- [ ] Code examples work end-to-end when copy-pasted
- [ ] Components work in both Console and embedded (third-party) contexts

## Files to Create (stigmer)

```
sdk/react/src/features/platform-client/
  ├── hooks.ts
  ├── CreatePlatformClientForm.tsx
  ├── PlatformClientListPanel.tsx
  ├── PlatformClientDetailPanel.tsx
  ├── PlatformClientSecretDisplay.tsx
  ├── PlatformClientQuickStart.tsx
  └── index.ts

docs/guides/platform-client/
  ├── overview.mdx
  ├── quick-start.mdx
  ├── token-endpoint.mdx
  └── auto-provisioning.mdx
```

## Files to Modify (stigmer)

```
sdk/react/src/index.ts                          → Export new components
client-apps/web/src/...                          → Add Console pages and navigation
docs/sdk/react/index.mdx                         → Add PlatformClient auth method
docs/sdk/index.mdx                               → Add PlatformClient to overview
docs/guides/federation/overview.mdx              → Cross-reference PlatformClient
```
