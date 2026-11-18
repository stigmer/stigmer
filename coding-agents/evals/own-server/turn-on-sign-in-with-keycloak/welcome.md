What a good answer may also say. Never graded: leaving any of it out fails nothing.

- Setting `STIGMER_OPERATOR_EMAIL` and signing in as the operator first, so the operator owns the Organization.
- `stigmer auth login --device` for machines without a browser, when Keycloak allows the device grant on the native client.
- Checking the server's `/config.json` answer for `"authMode": "oidc"`.
- Setting `STIGMER_ORG` in the CI job beside `STIGMER_API_KEY`.
- A service account takes the smallest role the job needs (Member to create and run Agents).
- The console client uses PKCE with no client secret ("Client authentication" off) and an Audience mapper; the settings are `STIGMER_OIDC_ISSUER` (https), `STIGMER_OIDC_AUDIENCE` and `STIGMER_OIDC_CONSOLE_CLIENT_ID`, applied with `docker compose up -d`.
- The runner's key never expires.
- `stigmer config backend add <name> --endpoint stigmer.internal.acme.com:443`, `stigmer config backend use <name>`, and `STIGMER_OIDC_NATIVE_CLIENT_ID` for the native client.
- The CI key comes from `stigmer service-account create` and `stigmer apikey create --service-account ...`.
