# FederationIssuer YAML Schema Reference

Core schema reference for the `iam.stigmer.ai/v1` FederationIssuer resource. For how a request carrying an issuer's token is verified, see [sign-in-flow.md](sign-in-flow.md).

## FederationIssuer YAML Structure

```yaml
apiVersion: iam.stigmer.ai/v1
kind: FederationIssuer
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
| `kind` | Yes | Must be exactly `FederationIssuer` |
| `metadata` | Yes | Standard API resource metadata (see below) |
| `spec` | Yes | Federation issuer configuration (see below) |
| `status` | No | System-managed; never set by users |

## Metadata Fields

| Field | Required | Description |
|---|---|---|
| `metadata.name` | Yes | Human-readable name (e.g., `Planton`). Used in UI and audit logs. |
| `metadata.slug` | No | URL-friendly identifier, unique within the organization. Auto-generated from `name` if omitted. Format: lowercase alphanumeric with hyphens, starts with a letter. Changed only by `rename`; the old slug reads for 30 days, and sign-in does not name it. |
| `metadata.id` | No | System-generated unique identifier (prefix `idp_`). Never set by users. |
| `metadata.org` | Yes | Organization that owns this federation issuer. All federated accounts created via this provider are associated with this org. |

## Spec Fields

| Field | Required | Description |
|---|---|---|
| `spec.display_name` | No | Human-readable label for the issuer. Shown in UI and audit logs. Max 200 characters. |
| `spec.jwks_uri` | Yes | HTTPS URL of the JWKS endpoint exposing the signing public keys. Stigmer fetches and caches keys from this URL for JWT signature verification. Must be the `jwks_uri` that every allowed issuer's discovery document names. Max 2048 characters. |
| `spec.allowed_issuers` | Yes | List of accepted `iss` claim values. Every token from this provider must have its `iss` match one entry. At most 10, each at most 2048 characters. Several values are accepted only when every issuer's discovery document names the same `jwks_uri` (and the same `userinfo_endpoint` when one is set); register one federation issuer per environment otherwise. Each issuer must publish an OpenID Connect discovery document whose `issuer` equals it. |
| `spec.expected_audience` | Yes | Required `aud` claim value. Tokens without this exact audience value are rejected. With the issuer, it identifies this provider across the platform: no two federation issuers share an issuer and audience pair. Max 200 characters. |
| `spec.userinfo_endpoint` | No | HTTPS URL of the OIDC UserInfo endpoint. When Stigmer creates an account from a token that carries no email claim, it calls this endpoint with that token as a Bearer token to read the user's profile; it is not called otherwise. When set, it must be the `userinfo_endpoint` every allowed issuer's discovery document names. Max 2048 characters. |
| `spec.create_accounts_on_sign_in` | No | When true, Stigmer creates a federated account the first time a valid token arrives for a `sub` it has no account for. When false (the default), the platform creates accounts with `createFederatedAccount` first. |
| `spec.sign_in_role` | No | The role an account receives the first time it signs in to an organization through this issuer: the organization its token is bound to. Granted once per account and organization; a role an admin later removes stays removed. Unspecified grants nothing; owner is refused. |
| `spec.external_id_claim` | No | The JWT claim that names the child organization each token works in: the child of the issuer's organization whose `external_id` equals the claim's value. Refused on an issuer in a child organization. Read on every token: a missing claim, a non-string value or an unknown organization is refused as unauthenticated. When empty, every token is bound to the issuer's own organization. Max 256 characters. |

## API Operations

| Operation | RPC | Authorization |
|---|---|---|
| Apply (create or update) | `FederationIssuerCommandController.apply` | Kubernetes-style upsert: creating asks what Create asks, updating asks what Update asks. |
| Create | `FederationIssuerCommandController.create` | `can_create_federation_issuer` on the owning organization |
| Update | `FederationIssuerCommandController.update` | `can_edit` on the FederationIssuer |
| Rename | `FederationIssuerCommandController.rename` | `can_delete` on the FederationIssuer: whoever may delete it may rename it |
| Delete | `FederationIssuerCommandController.delete` | `can_delete` on the FederationIssuer. |
| Get by ID | `FederationIssuerQueryController.get` | `can_view` on the FederationIssuer |
| Get by reference | `FederationIssuerQueryController.getByReference` | `can_view` on the resolved FederationIssuer, exactly as Get by ID |
| List | `FederationIssuerQueryController.list` | `can_view` on the organization; a page holds only the issuers the caller may view |

The organization's admins view, edit and delete its federation issuers. An admin can grant a person in the organization view of one provider; other members of the organization see none of them. A provider's creator manages it only while they remain an admin of the organization.

## CLI Commands

The CLI applies federation issuers declaratively; reading and deleting them is done in the console or through the API.

```bash
# Apply (create or update) a federation issuer from YAML
stigmer apply -f issuer.yaml
```

## Related Documentation

- [README.md](README.md) — Overview and sign-in diagram
- [sign-in-flow.md](sign-in-flow.md) — How an issuer's token is verified and its account resolved, and the OIDC standards involved
- [examples.md](examples.md) — Complete YAML examples
- [validation-checklist.md](validation-checklist.md) — Pre-create checklist and common pitfalls
- [../../identityaccount/docs/provisioning-modes.md](../../identityaccount/docs/provisioning-modes.md) — Federated account provisioning details
