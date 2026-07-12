# PlatformClient

## What It Is

A **PlatformClient** is an OAuth2 client credential (`client_id` + `client_secret`) where Stigmer acts as the authorization server. Platform builders create a PlatformClient to mint user-scoped JWTs from their backend, enabling their end users to interact with Stigmer resources through the React SDK — without setting up OIDC federation.

## When to Use It

Use PlatformClient when a platform builder wants to embed Stigmer UI components (sessions, agents, etc.) into their product and needs to authenticate their users against Stigmer.

**PlatformClient vs IdentityProvider:**

| Concern | PlatformClient | IdentityProvider |
|---------|---------------|-----------------|
| Setup complexity | Minimal — just create a PlatformClient and call `mintUserToken` | Requires JWKS endpoint, issuer configuration, audience setup |
| Token issuer | Stigmer signs the JWT | External IdP (Auth0, Okta, etc.) signs the JWT |
| User identity source | Platform builder provides user_id, email, name in the mint request | JWT claims from the external IdP |
| Best for | Quick integration, embedded components, platform builders without their own IdP | Enterprises with existing IdP infrastructure, SSO requirements |

## Credential Lifecycle

1. **Create**: Call `PlatformClientCommandController.create` — Stigmer generates a `client_id` (prefix `stgm_cid_`) and `client_secret` (prefix `stgm_cs_`). The raw secret is returned **once** in the response.

2. **Store securely**: The `client_secret` is never stored or retrievable after creation. Only the SHA-256 hash is persisted. Store the raw secret in your backend's secrets manager.

3. **Use from backend**: Call `PlatformClientTokenController.mintUserToken` with the `client_id`, `client_secret`, and user identity to get a Stigmer-signed JWT.

4. **Rotate when needed**: Call `PlatformClientCommandController.rotateSecret` to generate a new secret. The old secret is invalidated immediately. The `client_id` remains unchanged.

5. **Delete**: Call `PlatformClientCommandController.delete` to permanently invalidate the credentials. Previously minted tokens remain valid until their own expiration.

## Token Minting Flow

```
Platform Builder Backend                Stigmer API
        |                                    |
        |  1. mintUserToken                  |
        |    client_id + client_secret       |
        |    user_id + user_email + name     |
        | ---------------------------------> |
        |                                    |
        |                          2. Validate credentials
        |                          3. Resolve/provision user
        |                          4. Sign JWT with Stigmer key
        |                                    |
        |  5. { access_token, expires_in }   |
        | <--------------------------------- |
        |                                    |
        |  6. Pass token to browser          |
        |                                    |

Browser (React SDK)                     Stigmer API
        |                                    |
        |  7. API calls with Bearer token    |
        | ---------------------------------> |
        |                          8. Validate Stigmer JWT
        |                          9. Resolve identity account
        |                                    |
```

## JIT Provisioning

PlatformClient supports three provisioning modes:

### Manual (default)
- `auto_provision_accounts: false`
- Platform must create identity accounts before minting tokens
- `mintUserToken` returns `NOT_FOUND` if the user does not exist

### JIT (Just-In-Time)
- `auto_provision_accounts: true`, `auto_grant_on_org: false`
- Stigmer creates an IdentityAccount on first `mintUserToken` call
- The user has no organization access until explicitly granted via IAM policies

### JIT + Auto-Grant
- `auto_provision_accounts: true`, `auto_grant_on_org: true`
- Stigmer creates an IdentityAccount and grants `auto_grant_role` (default: viewer) on the PlatformClient's owning organization
- Simplest setup — new users can immediately interact with org resources

## Authorization

| Operation | RPC | Permission | Scope |
|-----------|-----|------------|-------|
| Create | `create` | `can_create_platform_client` | Organization |
| Update | `update` | `can_edit` | PlatformClient |
| Delete | `delete` | `can_delete` | PlatformClient |
| Rotate secret | `rotateSecret` | `can_edit` | PlatformClient |
| View | `get` | `can_view` | PlatformClient |
| List | `listByOrg` | `can_view` | Organization |
| Mint token | `mintUserToken` | N/A (client_id + client_secret auth) | N/A |
| Mint guest token | `mintGuestToken` | N/A (public; gated on agent `spec.sharing.enabled`) | N/A |

## Guest Tokens (Shared Agents)

`mintGuestToken` is the credential-free exception to the client-credential model. It powers the hosted chat page for shared agents: an anonymous visitor resolves a share URL (`org` + agent `slug`) into a short-lived guest JWT without a Stigmer account and without PlatformClient credentials.

- **Gate**: the target agent must have `spec.sharing.enabled`. Unshared and nonexistent agents return an identical `NOT_FOUND`, so the endpoint leaks nothing about agent existence.
- **System-managed client**: the first mint in an org lazily provisions a system-managed PlatformClient (reserved slug `system-share-client`, labeled `stigmer.ai/system-managed`). Its secret is discarded at creation — it exists only so guest JWTs carry a valid `platform_client_id`. User deletion and secret rotation on it are rejected.
- **Guest identity**: all visitors in an org share one guest identity account (bounded cardinality). Per-visitor identity is the `guest_cookie_id` — a high-entropy bearer secret generated server-side on first mint, persisted by the hosted page in an httpOnly cookie, and echoed on subsequent mints. It scopes session/execution reads and continuation to the visitor who created them.
- **Containment**: a guest token can only create sessions and executions against shared agents in the token's org. All other RPCs are denied, and disabling sharing immediately stops both new mints and new guest sessions.
- **Launch-gate limits**: guest traffic is bounded by platform rate limits (per-visitor and per-org, including mints on this endpoint), a per-conversation turn limit and inactivity timeout, and a fail-closed credit check on the sharing org. A refused request carries a visitor-friendly message in the error — owners customize the copy per agent via `spec.sharing.messages`.
- **Embed origins**: when the widget runs inside an iframe (or a direct SDK embed), the mint request carries the embedding page's `embed_origin`. It is validated against the agent's `spec.sharing.allowed_origins` — an empty list admits any origin; a non-empty list refuses unlisted origins with `PERMISSION_DENIED` — then stamped into the guest JWT and re-validated against the live list on every session and execution create. The unframed hosted page sends no origin and is always exempt.

## Resource Definition

```yaml
apiVersion: iam.stigmer.ai/v1
kind: PlatformClient
metadata:
  name: Acme Dashboard
  slug: acme-dashboard
  org: acme
spec:
  auto_provision_accounts: true
  auto_grant_on_org: true
  auto_grant_role: viewer
  allowed_origins:
    - "https://app.acme.com"
    - "https://staging.acme.com"
```
