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

## Auth0-Based Integration (Second Environment)

A staging Auth0 tenant is its own issuer with its own key set, so it is its own IdentityProvider beside the production one. Stigmer refuses one provider whose issuers' discovery documents name different key sets.

```yaml
apiVersion: iam.stigmer.ai/v1
kind: IdentityProvider
metadata:
  name: Planton Staging
  slug: planton-staging
  org: planton
spec:
  display_name: "Planton (staging)"
  jwks_uri: "https://planton-staging.us.auth0.com/.well-known/jwks.json"
  allowed_issuers:
    - "https://planton-staging.us.auth0.com/"
  expected_audience: "https://api.planton.ai/"
  userinfo_endpoint: "https://planton-staging.us.auth0.com/userinfo"
```

## Just-In-Time Provisioning

Let Stigmer create each user's account on their first sign-in instead of creating accounts ahead of time, and grant every account a role on the owning organization the first time it signs in there.

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
  create_accounts_on_sign_in: true
  sign_in_role: member
```

## Child Organization Binding

Bind each token to the child organization it names. Stigmer reads `org_id` from every token and resolves it to the child of `saas-co` whose `external_id` equals the value; the token works in that organization only. A token without the claim, or naming an unknown child, is refused as unauthenticated. With no `sign_in_role`, Stigmer grants nothing and the platform grants roles itself through IAM policies.

```yaml
apiVersion: iam.stigmer.ai/v1
kind: IdentityProvider
metadata:
  name: SaaS Platform
  slug: saas-platform
  org: saas-co
spec:
  display_name: "SaaS Platform"
  jwks_uri: "https://auth.saas.example.com/.well-known/jwks.json"
  allowed_issuers:
    - "https://auth.saas.example.com/"
  expected_audience: "https://stigmer.saas.example.com/"
  external_id_claim: "org_id"
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

