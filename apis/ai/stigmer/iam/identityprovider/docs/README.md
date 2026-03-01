# IdentityProvider Resource Documentation

Comprehensive documentation for the `iam.stigmer.ai/v1` IdentityProvider resource.

## What Is an IdentityProvider?

An IdentityProvider represents an external platform's trust relationship with Stigmer. It configures how Stigmer validates signed JWT assertions from that platform, enabling the platform's users to authenticate to Stigmer via a token exchange flow.

A typical use case: a platform like Planton Cloud wants its users to access Stigmer's AI features. Instead of requiring users to create a separate Stigmer account, Planton Cloud registers an IdentityProvider. When a user authenticates on Planton Cloud, that platform exchanges the user's OIDC token for a Stigmer-native token, automatically creating a [federated IdentityAccount](../../identityaccount/docs/README.md) on first use.

## Token Exchange Flow

```
External Platform               Stigmer
─────────────────               ───────
User authenticates
  on platform            ──►   POST /token-exchange
                                  │
                          Validate JWT signature
                          (fetches keys from jwks_uri)
                                  │
                          Validate iss (allowed_issuers)
                          Validate aud (expected_audience)
                                  │
                          Fetch user profile
                          (calls userinfo_endpoint)
                                  │
                          JIT-provision IdentityAccount
                          (if first time) or refresh profile
                                  │
                          Issue Stigmer-native token
                                  │
                ◄─────────────────┘
         Stigmer API access
         using native token
```

## Key Concepts

| Concept | Detail |
|---|---|
| **Ownership** | An IdentityProvider is owned by one organization. The org field on the IdentityProvider identifies the owning organization. |
| **JWKS URI** | The endpoint Stigmer fetches signing keys from to verify JWT signatures. |
| **Allowed issuers** | The `iss` claim values Stigmer will accept. Tokens with any other issuer are rejected. |
| **Expected audience** | The `aud` claim value every token must include. Prevents tokens from other services being accepted. |
| **UserInfo endpoint** | Called on every token exchange to fetch and refresh the user's profile (email, name, picture). |
| **No secrets stored** | The spec contains only public validation configuration — no client secrets or private keys. |
| **Rate limit budget** | Shared requests-per-minute budget across all organizations managed through this provider. `0` means no limit. |

## Documentation Index

| Document | Description |
|---|---|
| [identityprovider-resource-guide.md](identityprovider-resource-guide.md) | YAML schema reference — spec fields, CLI commands, API operations |
| [token-exchange-flow.md](token-exchange-flow.md) | Detailed token exchange walkthrough, OIDC standards, and integration requirements |
| [examples.md](examples.md) | Complete YAML examples for registering an identity provider |
| [validation-checklist.md](validation-checklist.md) | Pre-create checklist and common pitfalls |
