# Upgrade GitHub MCP Server from stdio to Remote HTTP

**Date**: April 12, 2026

## Summary

Upgraded the GitHub MCP server from local stdio transport (`go run github-mcp-server`) to GitHub's hosted remote HTTP endpoint at `api.githubcopilot.com/mcp/`. This completes the GitHub portion of T04 (no-DCR vendor OAuth servers), making GitHub a fully remote, OAuth-connected integration in the marketplace.

## Problem Statement

The GitHub MCP server was the only vendor-OAuth server still running on stdio transport. While the OAuth app credentials and migration were already configured (from session 3), the YAML still pointed at a local `go run` command, requiring users to have Go installed and pulling the server binary on every session start.

### Pain Points

- Users needed Go toolchain installed locally to use GitHub MCP
- Each session start downloaded and compiled the server binary via `go run`
- Inconsistent with other vendor-OAuth servers (Figma, Slack) which are all remote HTTP

## Solution

Changed `mcp-server-github.yaml` from stdio to HTTP transport, pointing at GitHub's official hosted MCP endpoint. Renamed the environment variable from `GITHUB_PERSONAL_ACCESS_TOKEN` to `GITHUB_ACCESS_TOKEN` to align with the `*_ACCESS_TOKEN` convention used by all other OAuth-enabled servers.

## Implementation Details

Single file change in `seedpack/mcp-servers/mcp-server-github.yaml`:

- **Transport**: `stdio` (go run) → `http` (`https://api.githubcopilot.com/mcp/`)
- **Env var**: `GITHUB_PERSONAL_ACCESS_TOKEN` → `GITHUB_ACCESS_TOKEN`
- **Auth block**: Unchanged — already had `oauth_app_ref: github-oauth` from session 3
- **Migration**: No changes needed — `U20260412c_SeedGitHubGoogleCalendarOAuthApps` already seeds the OAuthApp
- **Credentials**: Already in `vendor-oauth-config.yaml` and `vendor-oauth-credentials.yaml`

## Benefits

- Zero local dependencies for GitHub MCP — no Go toolchain required
- Instant connection — no binary download/compile on each session
- Consistent OAuth experience across all vendor-OAuth servers
- GitHub's hosted endpoint handles versioning and updates server-side

## Impact

- **Users**: GitHub MCP now connects instantly via remote HTTP instead of compiling locally
- **Marketplace**: 53 servers, with GitHub now fully upgraded to remote + vendor OAuth
- **T04 progress**: GitHub subtask complete; Google Calendar assessed (no official remote endpoint exists)

## Related Work

- [Wave-1a: 9 DCR-verified MCP servers](2026-04-12-172021-wave-1a-nine-dcr-verified-mcp-servers.md)
- [Upgrade Stripe/Cloudflare to remote OAuth](2026-04-12-173835-upgrade-stripe-cloudflare-to-remote-oauth.md)
- [T05: discovery_url, vendor OAuth, API-key servers](2026-04-12-183709-t05-marketplace-expansion-discovery-url-vendor-oauth.md)
- [T06+T03: DCR verification and marketplace expansion](2026-04-12-190454-t06-t03-dcr-verification-marketplace-expansion.md)

---

**Status**: ✅ Production Ready
**Timeline**: 5 minutes (YAML change only — migration and credentials pre-existing)
