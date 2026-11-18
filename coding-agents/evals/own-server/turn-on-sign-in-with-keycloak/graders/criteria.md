---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

**Must**

- Says to register a public console client in Keycloak whose access tokens carry the audience, then set the issuer, audience and console client id in `.env` (for example `STIGMER_OIDC_ISSUER`) and restart the stack.
- Says to create API keys only after sign-in is on (a key created while the server trusted everyone is refused), and to give the runner its own key (for example `STIGMER_TOKEN` in `.env`).
- For the CLI, says to add the server as a backend (for example `stigmer config backend add`) and sign in with `stigmer auth login` once a native client is registered, or use an API key.
- For CI, says to use a service account's API key, stored as a CI secret (for example `STIGMER_API_KEY`).

**FAIL if**

- It says a self-hosted server signs people in through Stigmer's hosted login.
- It tells them to edit `docker-compose.yml`.
- It tells them to keep using API keys created while the server trusted everyone.
- It gives CI a person's API key.
- It invents environment variables the authentication guide does not name.

**Welcome**

- Setting `STIGMER_OPERATOR_EMAIL` and signing in as the operator first, so the operator owns the Organization.
- `stigmer auth login --device` for machines without a browser, when Keycloak allows the device grant on the native client.
- Checking the server's `/config.json` answer for `"authMode": "oidc"`.
- Setting `STIGMER_ORG` in the CI job beside `STIGMER_API_KEY`.
- A service account takes the smallest role the job needs (Member to create and run Agents).
- The console client uses PKCE with no client secret ("Client authentication" off) and an Audience mapper; the settings are `STIGMER_OIDC_ISSUER` (https), `STIGMER_OIDC_AUDIENCE` and `STIGMER_OIDC_CONSOLE_CLIENT_ID`, applied with `docker compose up -d`.
- The runner's key never expires.
- `stigmer config backend add <name> --endpoint stigmer.internal.acme.com:443`, `stigmer config backend use <name>`, and `STIGMER_OIDC_NATIVE_CLIENT_ID` for the native client.
- The CI key comes from `stigmer service-account create` and `stigmer apikey create --service-account ...`.
