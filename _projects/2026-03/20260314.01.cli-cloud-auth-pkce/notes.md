# Notes: 20260314.01.cli-cloud-auth-pkce

**Created**: 2026-03-14

## Purpose

Use this file to capture important information as you work:

- 🎯 **Decisions**: Why you chose approach A over B
- 🐛 **Gotchas**: Issues discovered and how you solved them
- 💡 **Learnings**: Insights that might help later
- 📝 **Commands**: Useful commands or snippets
- 🔗 **References**: Links to docs, Stack Overflow, etc.

Keep entries **timestamped** and **concise**. This isn't a novel — just enough context to remember later.

---

## 2026-03-14 07:13 — Architectural Analysis: Why PKCE, What's Safe

### The Problem

The cloud CLI (`stigmer-cloud/client-apps/cli`) embeds an Auth0 **client secret** in
`internal/cli/auth/config/config.go`. This cannot go into the open-source repo.

```
ClientSecret: "haPGCQaCEgtTvQ59UKDXsXrMd3UBdo-W9HoP6MzOIBZPWN4agxcCy2uhadxf-COp"
```

### The Solution: PKCE (Proof Key for Code Exchange)

PKCE is the industry standard for public/native CLI clients. It replaces the client
secret with a one-time cryptographic proof generated at runtime.

**What's safe to embed in open-source (NOT secrets):**
- Auth0 domain URL — public service endpoint
- Client ID — public identifier for PKCE/Native apps (like a username, not a password)
- API audience URL — public resource identifier
- Callback port/path — local convention

**What gets eliminated:**
- `ClientSecret` — gone. PKCE replaces it entirely.

**Auth0 setup required:** Change the Auth0 application type from "Regular Web Application"
to "Native" (or create a new app). Enable "Authorization Code with PKCE" grant type.

### Auth Flow Diagram

```
stigmer auth login
    │
    ├─ Generate random code_verifier (43-128 chars)
    ├─ Compute code_challenge = base64url(sha256(code_verifier))
    ├─ Start HTTP server on localhost:8088
    ├─ Open browser → Auth0 /authorize?
    │     client_id=X&
    │     response_type=code&
    │     redirect_uri=http://localhost:8088/auth/callback&
    │     code_challenge=Y&
    │     code_challenge_method=S256&
    │     scope=openid+profile+email+offline_access&
    │     state=RANDOM&
    │     audience=https://api.stigmer.com/
    │
    │   [User authenticates on Auth0 page]
    │
    ├─ Auth0 redirects → localhost:8088/auth/callback?code=ABC&state=RANDOM
    ├─ POST https://stigmer-prod.us.auth0.com/oauth/token
    │     grant_type=authorization_code
    │     client_id=X
    │     code_verifier=ORIGINAL_VERIFIER  (NOT client_secret)
    │     code=ABC
    │     redirect_uri=http://localhost:8088/auth/callback
    ├─ Receive access_token
    ├─ Store in ~/.stigmer/config.yaml → backend.cloud.token
    └─ Done
```

### Config Model Mapping

Cloud CLI stores token at `auth.token`. OSS CLI stores it at `backend.cloud.token`.
The OSS model is cleaner — the token belongs to the cloud backend config.

```yaml
# OSS CLI config (~/.stigmer/config.yaml)
backend:
  type: cloud
  local:
    endpoint: localhost:7234
  cloud:
    endpoint: api.stigmer.ai:443
    token: eyJhbG...    # populated by stigmer auth login
```

### Token Resolution Priority (for gRPC calls)

1. `STIGMER_API_KEY` env var (highest priority — for CI/CD, scripts)
2. `--api-key` CLI flag (sets env var internally)
3. `backend.cloud.token` from config (normal user flow)

### Key Decision: Auto-switch backend on login?

When a user runs `stigmer auth login`, should we automatically set `backend.type: cloud`?
**Yes** — if someone is authenticating, they intend to use the cloud backend.
If they want to go back to local, `stigmer config backend set local` is explicit.

---

## 2026-03-14 07:13 — Cloud CLI Files to Reference

### Files to port (with modifications)
| Cloud CLI File | Purpose | OSS Adaptation |
|---|---|---|
| `cmd/stigmer/auth.go` | Cobra commands | Port as-is |
| `cmd/stigmer/whoami.go` | Root-level whoami | Port as-is |
| `internal/cli/auth/login/login.go` | Login flow | Replace token exchange with PKCE |
| `internal/cli/auth/login/logo.svg` | Success page SVG | Port as-is |
| `internal/cli/auth/config/config.go` | Auth0 config | Remove ClientSecret field entirely |
| `internal/cli/backend/authheader/get_value.go` | Token resolution | Adapt to `backend.cloud.token` path |
| `internal/cli/backend/backend.go` | gRPC auth | Port `tokenAuth` struct and wiring |

### Files to delete from cloud CLI (after validation)
- `internal/cli/auth/` — entire directory (contains embedded secret)
- `cmd/stigmer/auth.go`
- `cmd/stigmer/whoami.go`

---

*Add your timestamped notes below as you work*

---
