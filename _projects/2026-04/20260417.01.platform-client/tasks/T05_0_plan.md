# Task T05: SDK — PlatformClient Auth Support in Node/Go/Python Clients

**Created**: 2026-04-17
**Status**: NOT STARTED
**Estimated effort**: 1–2 sessions
**Repo**: stigmer (SDK packages)
**Depends on**: T01 (proto stubs), T03 (token endpoint functional)

## Objective

Add `clientId` + `clientSecret` as a new authentication option in the TypeScript (Node), Go, and Python server SDKs, and provide an `auth.createUserToken()` convenience method for minting user tokens.

## Background

Today the SDKs support two auth modes:
- `apiKey` — static bearer token (server-side)
- `getAccessToken` — dynamic token provider callback (browser or server)

PlatformClient introduces a third mode for server-side use:
- `clientId` + `clientSecret` — the SDK calls `POST /oauth/token` to obtain a bearer token, then uses it for subsequent requests

The browser-side SDK needs no changes — platform builders use `getAccessToken` to pass the user token obtained from their backend.

## Task Breakdown

### 1. TypeScript SDK (`@stigmer/sdk/node`)

**New config option:**
```typescript
interface NodeClientConfig {
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly getAccessToken?: TokenProvider;
  // New:
  readonly clientId?: string;
  readonly clientSecret?: string;
}
```

**Validation:** exactly one of `apiKey`, `getAccessToken`, or `clientId + clientSecret` must be provided. `clientId` and `clientSecret` must be provided together.

**Transport:** When `clientId + clientSecret` is configured:
- On first request (or when current token is expired): call `POST {baseUrl}/oauth/token` with `grant_type=client_credentials` to obtain an access token
- Cache the token until `expires_in` (with a small buffer, e.g., refresh 30 seconds before expiry)
- Use the cached token as `Authorization: Bearer` on all gRPC requests

**`auth.createUserToken()` method:**
```typescript
const stigmer = createNodeClient({
  baseUrl: 'https://api.stigmer.ai',
  clientId: process.env.STIGMER_CLIENT_ID,
  clientSecret: process.env.STIGMER_CLIENT_SECRET,
});

const { token, expiresAt } = await stigmer.auth.createUserToken({
  userId: 'user-123',
  email: 'jane@example.com',
  name: 'Jane Doe',
  orgId: 'org-xyz',  // optional
});
```

Implementation: HTTP POST to `{baseUrl}/oauth/token` with `grant_type=urn:stigmer:grant-type:user-token` + user fields. Returns the parsed token response.

### 2. Go SDK (`sdk/go`)

**New option:**
```go
client := stigmer.New(
    stigmer.WithClientCredentials(clientID, clientSecret),
    stigmer.WithBaseURL("https://api.stigmer.ai"),
)
```

**Validation:** `WithClientCredentials`, `WithAPIKey`, and `WithToken` are mutually exclusive.

**Token management:** Same pattern as TypeScript — obtain client_credentials token on first call, cache, refresh before expiry.

**`Auth.CreateUserToken()` method:**
```go
token, err := client.Auth.CreateUserToken(ctx, &stigmer.CreateUserTokenRequest{
    UserID: "user-123",
    Email:  "jane@example.com",
    Name:   "Jane Doe",
    OrgID:  "org-xyz",
})
```

### 3. Python SDK

Equivalent implementation following the Python SDK's existing patterns.

### 4. Browser SDK — No Changes

The browser SDK (`@stigmer/sdk` default entry) already has `getAccessToken`. Platform builders wire it to call their backend endpoint. No SDK changes needed.

Document this clearly: "The browser SDK does not need clientId/clientSecret. Your backend mints user tokens and your frontend passes them via getAccessToken."

## Key Design Decisions

- **Client credentials → token caching**: The SDK manages its own token lifecycle when using clientId/clientSecret. The developer never sees the intermediate access token — they just call API methods.
- **`createUserToken` is a convenience**: It is a thin wrapper around `POST /oauth/token` with the user-token grant. Developers can also call the endpoint directly if they prefer.
- **No clientId/clientSecret in browser SDK**: This is deliberately excluded. The browser SDK's config type should NOT include these fields to prevent misuse.

## Success Criteria

- [ ] TypeScript `createNodeClient` accepts `clientId` + `clientSecret`
- [ ] TypeScript token caching and refresh works correctly
- [ ] TypeScript `stigmer.auth.createUserToken()` returns user tokens
- [ ] Go `WithClientCredentials` option works
- [ ] Go `Auth.CreateUserToken()` returns user tokens
- [ ] Python equivalent implemented
- [ ] Validation: cannot combine clientId/clientSecret with apiKey or getAccessToken
- [ ] Browser SDK config type does NOT include clientId/clientSecret
- [ ] Unit tests for token caching, refresh, createUserToken
- [ ] README updates for all three SDKs

## Files to Modify (stigmer)

```
sdk/typescript/src/config.ts          → Add clientId/clientSecret to StigmerConfig (node only)
sdk/typescript/src/node.ts            → Add clientId/clientSecret to NodeClientConfig, token caching
sdk/typescript/src/transport.ts       → Token provider logic for client credentials
sdk/typescript/src/stigmer.ts         → auth.createUserToken() method
sdk/go/client.go                      → WithClientCredentials option
sdk/go/auth.go                        → CreateUserToken method (new file)
sdk/python/...                        → Equivalent changes
```
