# IdentityProvider Examples

Complete examples for registering external identity providers.

## Auth0-Based Integration (Single Environment)

The most common setup: an external platform uses Auth0 as its identity backend.

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
```

## Auth0-Based Integration (Multi-Environment)

Support tokens from both staging and production Auth0 tenants using the same IdentityProvider.

```yaml
apiVersion: iam.stigmer.ai/v1
kind: IdentityProvider
metadata:
  name: Planton (All Environments)
  slug: planton
  org: planton
spec:
  display_name: "Planton"
  jwks_uri: "https://planton-prod.us.auth0.com/.well-known/jwks.json"
  allowed_issuers:
    - "https://planton-prod.us.auth0.com/"
    - "https://planton-staging.us.auth0.com/"
  expected_audience: "https://api.planton.ai/"
  userinfo_endpoint: "https://planton-prod.us.auth0.com/userinfo"
  rate_limit_budget: 2000
```

## Integration With Rate Limiting

```yaml
apiVersion: iam.stigmer.ai/v1
kind: IdentityProvider
metadata:
  name: Partner Platform
  slug: partner-platform
  org: partner-corp
spec:
  display_name: "Partner Platform"
  jwks_uri: "https://auth.partner.example.com/.well-known/jwks.json"
  allowed_issuers:
    - "https://auth.partner.example.com/"
  expected_audience: "https://stigmer.partner.example.com/"
  userinfo_endpoint: "https://auth.partner.example.com/userinfo"
  rate_limit_budget: 500
```

## CLI: Apply (Create or Update)

```bash
# Kubernetes-style upsert: creates the provider the first time, updates it after
stigmer apply -f planton-idp.yaml
```

## CLI: Update (Rotate JWKS or Update Audience)

Update the YAML with new values, then apply it again. Apply finds the existing provider by its organization and slug, so the file needs no id:

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
  expected_audience: "https://api-v2.planton.ai/"  # updated audience
  userinfo_endpoint: "https://planton-prod.us.auth0.com/userinfo"
```

```bash
stigmer apply -f updated-idp.yaml
```

## Reading and deleting

The CLI applies identity providers and does not read or delete them; use the console's Identity Providers settings or the API (`getByReference` with the organization and slug, `delete` with the id).

Deletion is refused while any platform-managed organization references the IdentityProvider. Remove those organizations first.
