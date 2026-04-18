# Wrong Assumptions Discovered in Session 2

## WA-01: "Forwarding Auth0 tokens is a confused deputy vulnerability"

**Wrong assumption**: Session 1 concluded that forwarding Planton's Auth0 JWT to Stigmer would be a confused deputy problem because the audience is `api.planton.ai`, not `stigmer-api`.

**Correction**: Token exchange solves this. The external JWT (with foreign audience) only goes to the token exchange endpoint, which is designed to accept external tokens. Stigmer issues its own token with correct `aud: stigmer-api` for API calls. The audience is correct where it matters — on actual API endpoints.

## WA-02: "We need custom RSA keys and JWKS publishing"

**Wrong assumption**: Planton needs to generate a custom RSA key pair, publish JWKS on GitHub Pages, and the proxy must mint custom JWTs.

**Correction**: Auth0's JWKS is already public (`/.well-known/jwks.json`). With token exchange, the IdentityProvider can point directly to Auth0's JWKS. No custom keys needed. Auth0 handles key rotation automatically.

## WA-03: "A config-only Docker proxy is sufficient"

**Wrong assumption**: Shipping a Docker image with env vars (zero code) would work for all integrators.

**Correction**: Authorization is platform-specific. Each platform has its own org access model. A config-only proxy can't handle custom authz logic, and without it, users can spoof org access by changing the org_id in gRPC messages. The proxy must support custom interceptors (SDK approach).

## WA-04: "Auto-grant org membership is always safe"

**Wrong assumption**: If a request comes through a trusted IdentityProvider for a platform-managed org, auto-granting membership is safe.

**Correction**: Only safe if the request has passed through the platform's authorization layer first. If the proxy is user-facing, users can present valid JWTs but access orgs they don't belong to. The proxy must sit behind the platform's authz boundary, or the SDK must enforce authz interceptors.

## WA-05: "Email in JWT is optional / nice-to-have"

**Wrong assumption**: Storing only `idp_id` on identity accounts is sufficient. Email was treated as optional.

**Correction**: Audit trails showing `ida_98ZYXWVU` are useless to humans. Email, display name, and picture are essential for usability. Solved via OIDC UserInfo endpoint during token exchange — no Auth0 customization needed.

## WA-06: "Auth0 access tokens contain email/profile claims"

**Wrong assumption**: Since Planton requests `openid email profile` scopes, the access token would contain email/name/picture.

**Correction**: Those claims go into the **ID token** (frontend), not the **access token** (backend). Auth0 access tokens only contain `sub`, `aud`, `iss`, `exp`, `scope`. To get profile data, either add Auth0 Actions (rejected — maintenance burden) or call the OIDC UserInfo endpoint (chosen — standard, no Auth0 customization).

## WA-07: "SDK and proxy solve the same problem"

**Wrong assumption**: Early in the discussion, the SDK (library) and proxy (deployable service) were treated as interchangeable.

**Correction**: They solve different problems. SDK = integrator writes code but gets flexibility. Proxy = zero code but limited customization. For the authorization requirement, the final design is a proxy SDK — a library that starts a gRPC server, combining the best of both (flexibility of SDK + convenience of a running service).
