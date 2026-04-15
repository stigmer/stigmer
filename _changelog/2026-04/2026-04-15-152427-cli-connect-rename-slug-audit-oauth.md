# CLI: Replace `discover` with `connect`, Slug Audit, MCP OAuth (T03)

**Date**: April 15, 2026

## Summary

Modernized the Stigmer CLI's MCP server connection surface: renamed `discover` to `connect` (aligning CLI verb with backend RPC), removed the well-known env auto-injection system, audited all help text for slug-vs-name consistency, and added browser-based OAuth support for MCP servers that require vendor authentication.

## Problem Statement

The CLI had accumulated several design debts that needed addressing as a cohesive unit:

### Pain Points

- The `discover` command name diverged from the backend's `connect` RPC, creating vocabulary mismatch across the platform
- Help text inconsistently used `<name-or-id>` when the reference parser works with slugs, not names
- The CLI reached into external tools' credential stores (`gh auth token`, `~/.planton/credentials/`) to auto-inject environment variables — fragile, surprising, and impossible to maintain
- MCP servers requiring OAuth (Slack, GitHub, Figma) had no CLI workflow; users had to authenticate through the web console first, then return to the CLI

## Solution

Four changes, implemented in dependency order:

1. **Remove well-known env auto-injection** — delete `env_resolver.go` and all callers. Credentials now flow through exactly two channels: OAuth (managed by the platform) or manual (`--env` / shell environment).

2. **Slug audit** — replace all `<name-or-id>` with `<slug-or-id>` in `get`, `delete`, `run`, and `connect` commands. Aligns help text with the reference parser's actual behavior.

3. **Rename `discover` to `connect`** — file renames, 15 symbol renames, all callers updated, examples rewritten. Clean break (no deprecation alias — pre-1.0 CLI).

4. **MCP OAuth in CLI** — new `oauth.go` that detects when an MCP server requires OAuth, opens the web console for the user to complete authentication, and polls `getOAuthGrantStatus` until the grant appears. Works for both local (embedded web console on `localhost:8234`) and cloud (`app.stigmer.ai`) backends.

## Implementation Details

### Part 0: env_resolver removal

- Deleted `env_resolver.go` (301 lines) and `env_resolver_test.go` (449 lines)
- Simplified `buildRuntimeEnv` to use only OS env + `--env` overrides
- Replaced `ResolveEnvForDiscovery` in auto-discovery with a simpler `missingSecretEnvVars` check
- Removed `resolveAndMergeAutoEnv`, `applyAutoEnvForAgent` from the `run` and `draft` paths (5 call sites)

### Part 1: rename discover → connect

- 4 file renames via `git mv`
- 15 public symbol renames (`Discover*` → `Connect*`)
- Updated all callers in `root.go`, `apply_file.go`, `apply_project.go`, `server.go`
- Rewrote all help text and examples

### Part 2: slug audit

- Updated `Use:` and `Long:` text in `get.go`, `delete.go`, `run.go`, `connect.go`

### Part 3: MCP OAuth

- New `oauth.go` with `CheckOAuthRequired`, `CheckOAuthGrantExists`, `WaitForOAuthGrant`, `RunOAuthFlow`, `ResolveConsoleURL`, `checkWebConsoleAvailable`
- Console URL resolution: `STIGMER_CONSOLE_URL` env var → local mode `localhost:8234` → cloud default `app.stigmer.ai`
- 5-minute timeout, 3-second polling interval, context-cancelable
- `--env` escape hatch: explicit env overrides bypass the OAuth check

## Benefits

- **Vocabulary alignment**: CLI verb matches backend RPC (`connect`), eliminating confusion across docs, code, and user conversations
- **Simpler credential model**: no magic auto-injection from external tools; credentials are explicit and debuggable
- **~750 lines of complex code removed** (env_resolver + tests), replaced by ~150 lines of focused OAuth code
- **OAuth servers now work from the CLI** without requiring users to visit the web console first
- **Consistent help text**: `<slug-or-id>` matches how the reference parser actually resolves resources

## Impact

- **CLI users**: `stigmer discover` → `stigmer connect` (breaking, pre-1.0)
- **OAuth MCP servers**: now connectable from the CLI (Slack, GitHub, Figma, etc.)
- **Maintainers**: no more vendor-specific credential store code to maintain
- **Auto-discovery at daemon startup**: skips servers with missing secret env vars (was already best-effort, now consistent)

## Related Work

- T01: Generic ApplyHandler framework + CI guards (completed)
- T02: Close all apply gaps — 6 resource kinds (completed)
- T04: @stigmer/ink package and run/resume rewrite (pending)
- Future: Direct-to-auth-URL flow via `OAuthCallbackHandler` enhancement

---

**Status**: ✅ Production Ready
**Timeline**: 1 session (~2 hours)
