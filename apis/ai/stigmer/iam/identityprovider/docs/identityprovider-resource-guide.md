# IdentityProvider YAML Schema Reference

Core schema reference for the `iam.stigmer.ai/v1` IdentityProvider resource. For the token exchange flow, see [token-exchange-flow.md](token-exchange-flow.md).

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
  rate_limit_budget: 1000
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
| `metadata.id` | No | System-generated unique identifier (prefix `idp-`). Never set by users. |
| `metadata.org` | Yes | Organization that owns this identity provider. All federated accounts created via this provider are associated with this org. |

## Spec Fields

| Field | Required | Description |
|---|---|---|
| `spec.display_name` | No | Human-readable label for the provider. Shown in UI and audit logs. Max 200 characters. |
| `spec.jwks_uri` | Yes | HTTPS URL of the JWKS endpoint exposing the signing public keys. Stigmer fetches and caches keys from this URL for JWT signature verification. Max 2048 characters. |
| `spec.allowed_issuers` | Yes | List of accepted `iss` claim values. Every token from this provider must have its `iss` match one entry. Supports multiple values for key rotation or multi-environment setups. |
| `spec.expected_audience` | Yes | Required `aud` claim value. Tokens without this exact audience value are rejected. Max 200 characters. |
| `spec.userinfo_endpoint` | Yes | HTTPS URL of the OIDC UserInfo endpoint. Stigmer calls this on every token exchange with the provider's access token as a Bearer token to retrieve the user's profile. Max 2048 characters. |
| `spec.rate_limit_budget` | No | Shared rate limit in requests per minute across all organizations managed through this provider. `0` means no limit. Defaults to `0`. |

## API Operations

| Operation | RPC | Authorization |
|---|---|---|
| Apply (create or update) | `IdentityProviderCommandController.apply` | Kubernetes-style upsert. |
| Create | `IdentityProviderCommandController.create` | `can_create_idp` on the owning organization |
| Update | `IdentityProviderCommandController.update` | `can_edit` on the IdentityProvider |
| Delete | `IdentityProviderCommandController.delete` | `can_delete` on the IdentityProvider. Blocked if any platform-managed organizations reference this provider. |
| Get by ID | `IdentityProviderQueryController.get` | `can_view` on the IdentityProvider |
| Get by reference | `IdentityProviderQueryController.getByReference` | Open (used during token exchange flow) |

## CLI Commands

```bash
# Apply (create or update) an identity provider from YAML
stigmer identity-provider apply idp.yaml

# Create a new identity provider
stigmer identity-provider create idp.yaml

# Update an existing identity provider
stigmer identity-provider update idp.yaml

# Get an identity provider by ID
stigmer identity-provider get idp-01ABCDEF

# Get an identity provider by reference (org/slug)
stigmer identity-provider get --org planton --slug planton

# Get as YAML
stigmer identity-provider get idp-01ABCDEF --output yaml

# Delete an identity provider
stigmer identity-provider delete idp-01ABCDEF
```

## Related Documentation

- [README.md](README.md) — Overview and token exchange diagram
- [token-exchange-flow.md](token-exchange-flow.md) — Detailed token exchange walkthrough and OIDC standards
- [examples.md](examples.md) — Complete YAML examples
- [validation-checklist.md](validation-checklist.md) — Pre-create checklist and common pitfalls
- [../../identityaccount/docs/provisioning-modes.md](../../identityaccount/docs/provisioning-modes.md) — Federated account provisioning details
