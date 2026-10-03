# IdentityProvider YAML Schema Reference

Core schema reference for the `iam.stigmer.ai/v1` IdentityProvider resource. For how a request carrying a provider's token is verified, see [sign-in-flow.md](sign-in-flow.md).

## IdentityProvider YAML Structure

```yaml
apiVersion: iam.stigmer.ai/v1
kind: IdentityProvider
metadata:
  name: Planton
  slug: planton
  org: planton
spec:
  display_name: "Planton"
  jwks_uri: "https://planton-prod.us.auth0.com/.well-known/jwks.json"
  allowed_issuers:
    - "https://planton-prod.us.auth0.com/"
  expected_audience: "https://api.planton.ai/"
  userinfo_endpoint: "https://planton-prod.us.auth0.com/userinfo"
status: {}  # System-managed, never set by users
```

## Top-Level Fields

| Field | Required | Value |
|---|---|---|
| `apiVersion` | Yes | Must be exactly `iam.stigmer.ai/v1` |
| `kind` | Yes | Must be exactly `IdentityProvider` |
| `metadata` | Yes | Standard API resource metadata (see below) |
| `spec` | Yes | Identity provider configuration (see below) |
| `status` | No | System-managed; never set by users |

## Metadata Fields

| Field | Required | Description |
|---|---|---|
| `metadata.name` | Yes | Human-readable name (e.g., `Planton`). Used in UI and audit logs. |
| `metadata.slug` | No | URL-friendly identifier, unique within the organization. Auto-generated from `name` if omitted. Format: lowercase alphanumeric with hyphens, starts with a letter. |
| `metadata.id` | No | System-generated unique identifier (prefix `idp_`). Never set by users. |
| `metadata.org` | Yes | Organization that owns this identity provider. All federated accounts created via this provider are associated with this org. |

## Spec Fields

| Field | Required | Description |
|---|---|---|
| `spec.display_name` | No | Human-readable label for the provider. Shown in UI and audit logs. Max 200 characters. |
| `spec.jwks_uri` | Yes | HTTPS URL of the JWKS endpoint exposing the signing public keys. Stigmer fetches and caches keys from this URL for JWT signature verification. Must be the `jwks_uri` that every allowed issuer's discovery document names. Max 2048 characters. |
| `spec.allowed_issuers` | Yes | List of accepted `iss` claim values. Every token from this provider must have its `iss` match one entry. At most 10, each at most 2048 characters. Several values are accepted only when every issuer's discovery document names the same `jwks_uri` (and the same `userinfo_endpoint` when one is set); register one identity provider per environment otherwise. Each issuer must publish an OpenID Connect discovery document whose `issuer` equals it. |
| `spec.expected_audience` | Yes | Required `aud` claim value. Tokens without this exact audience value are rejected. With the issuer, it identifies this provider across the platform: no two identity providers share an issuer and audience pair. Max 200 characters. |
| `spec.userinfo_endpoint` | No | HTTPS URL of the OIDC UserInfo endpoint. When Stigmer creates an account from a token that carries no email claim, it calls this endpoint with that token as a Bearer token to read the user's profile; it is not called otherwise. When set, it must be the `userinfo_endpoint` every allowed issuer's discovery document names. Max 2048 characters. |

## API Operations

| Operation | RPC | Authorization |
|---|---|---|
| Apply (create or update) | `IdentityProviderCommandController.apply` | Kubernetes-style upsert: creating asks what Create asks, updating asks what Update asks. |
| Create | `IdentityProviderCommandController.create` | `can_create_idp` on the owning organization |
| Update | `IdentityProviderCommandController.update` | `can_edit` on the IdentityProvider |
| Delete | `IdentityProviderCommandController.delete` | `can_delete` on the IdentityProvider. Refused while any platform-managed organization references this provider. |
| Get by ID | `IdentityProviderQueryController.get` | `can_view` on the IdentityProvider |
| Get by reference | `IdentityProviderQueryController.getByReference` | `can_view` on the resolved IdentityProvider, exactly as Get by ID |
| List by organization | `IdentityProviderQueryController.listByOrg` | `can_view` on the organization; the answer holds only the providers the caller may view |
| SSO discovery | `IdentityProviderQueryController.getSsoProvider` | None: the login page calls it before sign-in, and it answers only the SSO projection (display name, OIDC client ID, issuer, expected audience) |

The organization's admins view, edit and delete its identity providers. An admin can grant a person in the organization view of one provider; other members of the organization see none of them. A provider's creator manages it only while they remain an admin of the organization.

## CLI Commands

The CLI applies identity providers declaratively; reading and deleting them is done in the console or through the API.

```bash
# Apply (create or update) an identity provider from YAML
stigmer apply -f idp.yaml
```

## Related Documentation

- [README.md](README.md) — Overview and sign-in diagram
- [sign-in-flow.md](sign-in-flow.md) — How a provider's token is verified and its account resolved, and the OIDC standards involved
- [examples.md](examples.md) — Complete YAML examples
- [validation-checklist.md](validation-checklist.md) — Pre-create checklist and common pitfalls
- [../../identityaccount/docs/provisioning-modes.md](../../identityaccount/docs/provisioning-modes.md) — Federated account provisioning details
