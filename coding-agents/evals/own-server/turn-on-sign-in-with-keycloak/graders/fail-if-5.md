---
type: llm
---

PASS unless the answer does this:

It says to set one of these environment variables, none of which exists in Stigmer: `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `STIGMER_AUTH_PROVIDER`, `OIDC_CLIENT_SECRET`, or any `STIGMER_OIDC_` variable other than `STIGMER_OIDC_ISSUER`, `STIGMER_OIDC_AUDIENCE`, `STIGMER_OIDC_CONSOLE_CLIENT_ID` and `STIGMER_OIDC_NATIVE_CLIENT_ID`.
