# Pending: GitHub OAuth App Registration

**Status:** Pending (manual task — requires GitHub org admin access)
**Blocks:** End-to-end testing of the GitHub workspace integration (Phase 1)

## What needs to happen

The Phase 1 implementation is code-complete, but the OAuth flow requires a registered
GitHub OAuth App to function. Without the `client_id` and `client_secret`, the backend
returns `FAILED_PRECONDITION` and the "Connect GitHub" button cannot initiate the flow.

## Apps to register

### 1. Local/OSS App

- **Where:** GitHub > Stigmer org > Settings > Developer settings > OAuth Apps
- **App name:** `Stigmer Local` (or `Stigmer Dev`)
- **Homepage URL:** `https://stigmer.ai`
- **Authorization callback URL:** `http://localhost:8234/auth/github/callback`
- **Scopes needed:** `repo`, `read:user`
- **After creation:** Note the `client_id` and `client_secret`

**How to use:**
Set environment variables before starting the local server:
```bash
export STIGMER_GITHUB_CLIENT_ID=Ov23li...
export STIGMER_GITHUB_CLIENT_SECRET=abc123...
```

### 2. Cloud App

- **Where:** Same GitHub org, separate OAuth App
- **App name:** `Stigmer Cloud` (or `Stigmer`)
- **Homepage URL:** `https://stigmer.ai`
- **Authorization callback URL:** `https://<cloud-domain>/auth/github/callback`
  (add multiple callback URLs if needed for staging/production)
- **Scopes needed:** `repo`, `read:user`
- **After creation:** Configure as environment secrets in cloud deployment:
  - `GITHUB_OAUTH_CLIENT_ID` (Java backend reads from `application.yaml`)
  - `GITHUB_OAUTH_CLIENT_SECRET`

## Open question: embedding credentials in the OSS binary

For the open-source distribution, users shouldn't need to register their own
GitHub App just to use the workspace picker. Options to explore:

1. **Embed in binary (like GitHub CLI `gh`)** — compile the `client_id` and
   `client_secret` as defaults in `config.go`. The `client_id` is public anyway.
   The `client_secret` for a localhost-only OAuth App has limited attack surface
   since tokens can only be delivered to localhost. This is an accepted pattern
   for developer tools.

2. **Fetch from a Stigmer API at startup** — the CLI fetches the credentials
   from a public Stigmer endpoint on first run. Avoids committing the secret
   to the repo but adds a network dependency.

3. **User registers their own** — document the steps and require users to set
   env vars. Worst UX but simplest implementation.

**Recommendation:** Option 1 (embed in binary) for the `client_id`, with the
`client_secret` either embedded (like `gh`) or fetched. Env var overrides for
enterprise/self-hosted users who want their own GitHub App.

## Where credentials are consumed

- **Go backend:** `backend/services/stigmer-server/pkg/config/config.go`
  - `STIGMER_GITHUB_CLIENT_ID` → `Config.GitHubOAuthClientID`
  - `STIGMER_GITHUB_CLIENT_SECRET` → `Config.GitHubOAuthClientSecret`

- **Java backend:** `stigmer-cloud/.../application.yaml`
  - `GITHUB_OAUTH_CLIENT_ID` → `github.oauth.client-id`
  - `GITHUB_OAUTH_CLIENT_SECRET` → `github.oauth.client-secret`

## Checklist

- [ ] Register "Stigmer Local" OAuth App in GitHub org (localhost callback)
- [ ] Register "Stigmer Cloud" OAuth App in GitHub org (cloud callback)
- [ ] Set credentials in local dev environment and verify end-to-end OAuth flow
- [ ] Set credentials in cloud deployment secrets
- [ ] Decide on OSS distribution strategy for credentials (embed vs fetch vs manual)
- [ ] If embedding: add compiled defaults to `config.go` for local mode
