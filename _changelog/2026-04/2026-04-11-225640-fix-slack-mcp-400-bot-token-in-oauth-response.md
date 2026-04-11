# Fix Slack MCP 400: Bot Token Stored Instead of User Token

**Date**: April 11, 2026

## Summary

Fixed a 400 Bad Request from Slack's MCP endpoint (`mcp.slack.com/mcp`) caused by the OAuth token exchange storing the bot token (`xoxb-...`) instead of the user token (`xoxp-...`). The `resolveFromAuthedUser()` method in both the Java and Go backends was treating the `authed_user` block as a fallback rather than a preference, which never activated because Slack always returns a non-blank bot token at the top level.

## Problem Statement

After completing the Slack OAuth flow, clicking "Connect" on the Slack MCP server resulted in `400 Bad Request` from `mcp.slack.com`. The OAuth token had been successfully acquired and stored in the managed environment, but it was the wrong token — the bot token instead of the user token.

### Pain Points

- The 400 error was cryptic — it appeared as a remote Slack rejection with no indication that the wrong token type was being sent
- Earlier connect attempts without OAuth correctly produced 401 (missing token), but post-OAuth attempts produced 400 (wrong token), making it look like a different issue
- The `resolveFromAuthedUser()` method had been written to handle Slack's nested response but the condition was inverted — it only promoted `authed_user.access_token` when the top-level was missing, which Slack never does
- No unit tests existed for the Slack-style token response shape, so the bug was invisible at the code level

## Solution

Changed `resolveFromAuthedUser()` from a fallback to a preference: when `authed_user.access_token` is present and non-blank, it always wins over the top-level `access_token`. The `authed_user` block only appears in Slack-style OAuth V2 responses where user-level scopes were granted. Standard OAuth providers never include it, so their behavior is unchanged.

### Design Decision: Response-Driven (Option A) over Config-Driven (Option B)

Two approaches were considered:

- **Option A**: Prefer `authed_user.access_token` when present in the response — the response structure is the signal.
- **Option B**: Thread `scope_parameter_name` from `OAuthAppSpec` through to `OAuthTokenService` to control extraction.

Option A was chosen because:

1. The `authed_user` block is a semantic declaration by the provider that user-level authorization was granted — its presence is always correct by construction
2. `scope_parameter_name` belongs to a different concern (authorization URL construction), not token response parsing
3. Coupling them would create a second source of truth that can drift (violates "derived state over stored state")
4. Option A changes one method in one file per backend; Option B requires threading a new parameter through multiple classes

## Implementation Details

### Token Response Fix (Java + Go)

Both `OAuthTokenService.TokenResponse.resolveFromAuthedUser()` (Java) and `TokenResponse.resolveFromAuthedUser()` (Go) had identical logic:

```
// BEFORE: fallback-only (broken for Slack)
if (accessToken is blank) AND (authedUser exists):
    copy from authedUser

// AFTER: preference (correct for Slack, unchanged for others)
if (authedUser is nil): return
if (authedUser.accessToken is non-blank): overwrite accessToken
if (authedUser.tokenType is non-blank): overwrite tokenType
if (authedUser.scope is non-blank): overwrite scope
```

### Root Cause Chain (from production data)

1. Slack OAuth V2 returns: `{"access_token": "xoxb-...", "authed_user": {"access_token": "xoxp-..."}}`
2. `resolveFromAuthedUser()` checks: top-level is blank? No (`xoxb-...`). Skips authed_user entirely.
3. Bot token `xoxb-...` stored as `SLACK_ACCESS_TOKEN` in managed environment
4. MCP connect sends `Authorization: Bearer xoxb-...` to `mcp.slack.com`
5. Slack rejects bot token with `400 Bad Request` (MCP endpoint requires user token)

### Unit Tests

Added comprehensive tests in both backends covering:

- **Both tokens present** (Slack V2): user token wins over bot token
- **Standard OAuth**: top-level token used unchanged (no `authed_user`)
- **Only authed_user**: top-level blank, user token promoted (original fallback case)
- **Partial authed_user**: blank `access_token` in `authed_user` does not overwrite valid top-level token
- **Scope and type overwrite**: `authed_user` scope and token_type also override top-level values

### Data Cleanup

Deleted the stale OAuth grant and managed environment from MongoDB that held the wrong bot token. A fresh OAuth flow will store the correct user token after the fix is deployed.

## Benefits

- Slack MCP connect will work end-to-end with the correct user token
- Any future OAuth provider that uses Slack-style nested `authed_user` responses will be handled correctly
- Unit test coverage for token response parsing now exists (previously zero)
- The `scope_parameter_name` field retains its single responsibility (authorization URL construction)

## Impact

- **Users**: Slack MCP server (and any future `authed_user`-style providers) can be connected via OAuth
- **Architecture**: No proto changes, no new RPCs, no new collections. Single-method fix in each backend.
- **Testing**: Token response parsing now has dedicated test coverage in both Java and Go

## Files Changed

### stigmer (OSS)
| File | Change |
|------|--------|
| `backend/services/stigmer-server/pkg/domain/mcpserver/oauth/token.go` | Fix `resolveFromAuthedUser()` to prefer `authed_user` |
| `backend/services/stigmer-server/pkg/domain/mcpserver/oauth/token_test.go` | Add 6 unit tests for token response parsing |

### stigmer-cloud (private)
| File | Change |
|------|--------|
| `.../oauth/OAuthTokenService.java` | Fix `resolveFromAuthedUser()` to prefer `authed_user` |
| `.../oauth/OAuthTokenServiceTokenResponseTest.java` | Add 7 unit tests for token response parsing |

## Related Work

- `2026-04-11-210620-fix-mcp-connect-401-and-delete-handler-pipeline.md` — Fixed the OAuth grant lookup (empty identityAccountId) that caused 401 errors before OAuth flow completion
- `2026-04-11-154042-fix-mcp-connect-stale-address-and-protocol-mismatch.md` — Fixed stale STIGMER_SERVER_ADDRESS and MCP protocol version mismatch
- `2026-04-11-084912-oauth-app-proto-definitions-and-mcp-server-auth.md` — Introduced OAuthApp proto with `scope_parameter_name`

---

**Status**: Production Ready
**Repositories**: stigmer (2 files), stigmer-cloud (2 files)
