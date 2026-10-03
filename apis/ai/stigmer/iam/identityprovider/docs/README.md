# IdentityProvider Resource Documentation

Comprehensive documentation for the `iam.stigmer.ai/v1` IdentityProvider resource.

## What Is an IdentityProvider?

An IdentityProvider represents an external platform's trust relationship with Stigmer. It configures how Stigmer validates the signed JWTs that platform issues, so the platform's users call Stigmer with the platform's own tokens.

Identity providers are served by the Enterprise and Cloud editions; the open-source server answers UNIMPLEMENTED.

A typical use case: a platform like Planton wants its users to access Stigmer's AI features. Instead of requiring users to create a separate Stigmer account, Planton registers an IdentityProvider. Planton either creates [federated IdentityAccounts](../../identityaccount/docs/README.md) for its users ahead of time, or lets Stigmer create them on first sign-in (`auto_provision_accounts`). When a user calls Stigmer with a Planton-issued JWT, Stigmer validates the token and resolves the user's federated account.

## How a Sign-In Is Verified

There is no exchange step and no Stigmer-issued token: every request carries the provider's JWT, and Stigmer verifies it on that request.

```
External Platform               Stigmer
─────────────────               ───────
User authenticates
  on platform
User calls the API       ──►   Route the JWT by (iss, aud)
  with the platform JWT          (allowed_issuers, expected_audience)
                                  │
                          Verify the signature
                          (keys from jwks_uri)
                                  │
                          Check exp, nbf and sub
                                  │
                          Resolve the federated IdentityAccount
                          by (this provider, sub)
                                  │
                          Not found: create it (SSO or JIT),
                          or refuse (manual mode)
                                  │
                ◄─────────────────┘
         The request runs as that account
```

## Key Concepts

| Concept | Detail |
|---|---|
| **Ownership** | An IdentityProvider is owned by one organization. The org field on the IdentityProvider identifies the owning organization. |
| **JWKS URI** | The endpoint Stigmer fetches signing keys from to verify JWT signatures. |
| **Allowed issuers** | The `iss` claim values Stigmer will accept. Tokens with any other issuer are not routed to this provider. |
| **Expected audience** | The `aud` claim value every token must include. With the issuer, it routes a token to this provider, and it keeps tokens minted for other services out. |
| **Provisioning** | Manual (the platform creates each account), JIT (`auto_provision_accounts`) or SSO (`is_sso_provider`). JIT and SSO create the account on the first sign-in. |
| **UserInfo endpoint** | OIDC UserInfo endpoint URL. Read only when Stigmer creates an account from a token that carries no email claim. |
| **No secrets stored** | The spec contains only public validation configuration — no client secrets or private keys. |

## Documentation Index

| Document | Description |
|---|---|
| [identityprovider-resource-guide.md](identityprovider-resource-guide.md) | YAML schema reference — spec fields, CLI commands, API operations |
| [sign-in-flow.md](sign-in-flow.md) | How a request with a provider's token is verified and resolved, the OIDC standards involved, and integration requirements |
| [examples.md](examples.md) | Complete YAML examples for registering an identity provider |
| [validation-checklist.md](validation-checklist.md) | Pre-create checklist and common pitfalls |
