---
type: llm
---

PASS unless the answer does this:

It sets an environment variable such as `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `STIGMER_AUTH_PROVIDER` or `OIDC_CLIENT_SECRET`, or a `STIGMER_OIDC_` variable other than `STIGMER_OIDC_ISSUER`, `STIGMER_OIDC_AUDIENCE`, `STIGMER_OIDC_CONSOLE_CLIENT_ID` and `STIGMER_OIDC_NATIVE_CLIENT_ID`.
