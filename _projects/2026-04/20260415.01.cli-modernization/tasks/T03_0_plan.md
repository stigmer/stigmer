# Task T03: Replace `discover` with `connect`, Slug Audit, MCP OAuth

**Created**: 2026-04-15
**Status**: PENDING (depends on T02)
**Type**: Feature Development + Refactoring

## Objective

Three related command-level improvements:
1. Rename `discover` to `connect mcp-server` (aligning CLI verb with backend RPC)
2. Audit and fix all `<name-or-id>` help text to `<slug-or-id>`
3. Add browser-based OAuth flow for `connect mcp-server` when `spec.auth` is present

## Part 1: Rename `discover` -> `connect`

### Changes
- Rename `cmd/stigmer/root/discover.go` -> `connect.go`
- Change command `Use` from `discover` to `connect`
- Keep subcommand `mcp-server <slug-or-id>`
- Add `discover` as a hidden alias with deprecation warning for one release cycle
- Update all help text, examples, and documentation
- Update `internal/cli/mcpserver/discover.go` -> `connect.go` (or rename functions)

### User-facing result
```
stigmer connect mcp-server my-slack          # new
stigmer connect mcp-server my-org/my-slack   # with org prefix
stigmer discover mcp-server my-slack         # still works, prints deprecation warning
```

## Part 2: Slug Audit

### Problem
Proto separates `name` (human-readable) from `slug` (URL-friendly, unique within org). The CLI reference parser already resolves by slug/ID, but help text says `<name-or-id>` in several places.

### Audit targets
- `discover.go` / `connect.go` — `<name-or-id>` in usage
- `get.go` — check all `Use:` strings per kind
- `delete.go` / `delete_handlers.go` — same
- `run.go` / `run_resolve.go` — agent/workflow resolution help
- `draft.go` — draft subcommand usage strings
- Any other command that accepts a resource reference

### Fix
Replace `<name-or-id>` with `<slug-or-id>` (or `<ref>` where it would be too verbose). Ensure examples show slug forms like `my-agent`, `my-org/my-agent`.

## Part 3: MCP OAuth Flow in CLI

### Problem
MCP servers with `spec.auth.oauth_app_ref` (e.g., Slack, GitHub, Figma) require OAuth token authorization. The web console handles this via `useMcpServerOAuthConnect` (popup flow). The CLI has no equivalent — it only supports env-based credential injection.

### Design

```
stigmer connect mcp-server my-slack
  1. CLI fetches McpServer -> sees spec.auth.oauth_app_ref = "slack"
  2. CLI calls initiateOAuthConnect(mcp_server_id) -> gets auth_url + state
  3. CLI opens browser to auth_url (same pattern as `auth login`)
  4. CLI starts local HTTP callback server on localhost
  5. Vendor redirects back with code + state
  6. CLI calls completeOAuthConnect(code, state) -> backend stores token
  7. CLI calls connect(mcp_server_id) -> discovery runs with stored token
  8. CLI displays discovered tools and approval policies
```

### Implementation
- New `internal/cli/mcpserver/oauth.go` — browser-based OAuth callback (reuse pattern from `internal/cli/auth/login.go`)
- Modify `internal/cli/mcpserver/connect.go` — check `spec.auth` before calling `connect` RPC; if OAuth needed and no grant exists, run OAuth flow first
- Use `McpServerQueryController.getOAuthGrantStatus` to check if user already has a valid grant

### Fallback
- Non-OAuth servers: env resolution + `--env` overrides (unchanged behavior)
- If `--env` is explicitly passed with an OAuth server: skip OAuth, use provided env (escape hatch)

## Files Changed

- `cmd/stigmer/root/discover.go` -> `connect.go` (RENAME + refactor)
- `cmd/stigmer/root/root.go` (command registration update)
- `internal/cli/mcpserver/discover.go` -> `connect.go` (RENAME)
- `internal/cli/mcpserver/oauth.go` (NEW)
- `cmd/stigmer/root/get.go` (help text fix)
- `cmd/stigmer/root/delete.go` (help text fix)
- `cmd/stigmer/root/run.go` (help text fix)
- Various other command files (slug audit)

## Success Criteria

- [ ] `stigmer connect mcp-server <slug>` works (replaces discover)
- [ ] `stigmer discover` prints deprecation warning and delegates to connect
- [ ] All help text consistently says `<slug-or-id>` instead of `<name-or-id>`
- [ ] OAuth flow works for MCP servers with `spec.auth` configured
- [ ] Non-OAuth servers continue to work with env-based resolution
- [ ] All tests pass

## Next Task Preview

**T04: `@stigmer/ink` package and `run`/`resume` rewrite**
