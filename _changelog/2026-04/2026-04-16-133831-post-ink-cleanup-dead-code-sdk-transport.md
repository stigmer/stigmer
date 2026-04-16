# Post-Ink Cleanup: Dead Code Removal, SDK Transport Architecture, and Dependency Pruning

**Date**: April 16, 2026

## Summary

Completed the post-Ink migration cleanup for the Stigmer CLI. Import graph analysis revealed that three of the four packages originally marked as "dead" are still actively used — only `pkg/mdrender` was truly dead. Removed ~1,800 net lines of genuine dead code, moved `createNodeTransport` from `@stigmer/ink` to `@stigmer/sdk/node` with aligned interceptors, removed `Conn()` from the Go SDK, and pruned `charm.land/glamour/v2` from the dependency tree.

## Problem Statement

After the Ink migration (Session 9) replaced the Bubble Tea TUI with `@stigmer/ink`, several cleanup items remained:

### Pain Points

- Dead functions and an entire dead file (`run_display_stream.go`) lingered in the CLI command package
- `pkg/mdrender/` was dead but not yet deleted
- `Conn()` on `*stigmer.Client` was a migration escape hatch with zero remaining callers
- `createNodeTransport` lived in `@stigmer/ink` instead of the SDK, forcing Ink to own transport concerns
- The Ink Node transport had a minimal auth-only interceptor, inconsistent with the SDK's richer browser interceptor chain
- `charm.land/glamour/v2` was a dead dependency after `mdrender` removal
- `BUILD.bazel` had ghost entries referencing deleted files

## Solution

Systematic cleanup driven by actual import graph analysis rather than assumptions. Every deletion was verified by repo-wide search to ensure zero remaining callers.

## Implementation Details

### Dead Code Removal (Go CLI)

Deleted `run_display_stream.go` (entire file — `messageStreamRenderer` had zero callers). Relocated `sanitizeSystemContent` to `run_display.go` since `run_stream_events.go` still uses it.

Removed dead functions from four files:
- `run_display.go`: `displayAgentMessage`, `displayAgentPhaseChange`, `formatNonTUIAIText`, and 5 orphaned style definitions
- `run_display_tools.go`: `displayToolCalls`, `spinnerLabelForAgentPhase`
- `run_display_summary.go`: `displayAgentExecutionDetached`
- `run_stream_approval.go`: `handleAgentApprovalPrompt`, `handleToolCallApproval`, `needsAgentApprovalPrompt`, `findUnpromptedApproval`, `countUnresolvedApprovals`

Deleted `pkg/mdrender/` (3 files) — its sole consumer was the dead `displayAgentMessage` chain.

Renamed `run_stream_inline_header.go` → `run_display_header.go` to reflect its actual purpose.

### Go SDK: Conn() Removal

Removed the `Conn() grpc.ClientConnInterface` method from `*stigmer.Client`. The migration (Session 8) eliminated all 27 call sites; zero callers remain. The internal `conn` field stays for `Connect()` and `Close()`.

### Node Transport Architecture

Moved `createNodeTransport` from `@stigmer/ink` to `@stigmer/sdk/node` as a subpath export. The new implementation aligns the interceptor chain with the browser transport:

1. **Auth** — `createAuthInterceptor` (shared with browser)
2. **RPC metadata** — `rpcMetadataInterceptor` (shared with browser)
3. **Error strip** — `errorStripInterceptor` (shared with browser)

The browser-specific `createAuthRedirectInterceptor` (`onUnauthenticated`) is intentionally omitted — Node consumers handle auth failures through error handling, not UI redirects.

`@stigmer/sdk` declares `@connectrpc/connect-node` as an optional peer dependency with `peerDependenciesMeta.optional: true`, so browser consumers don't pull in Node HTTP/2 code. `@stigmer/ink` keeps it as a direct dependency (it always needs it).

### Dependency Pruning

`go mod tidy` removed `charm.land/glamour/v2` and its transitive deps. Confirmed that `bubbletea/v2`, `bubbles/v2`, `lipgloss/v2`, and `charmbracelet/x/ansi` remain — legitimately used by `pkg/picker` (interactive session selector) and `cliprint/progress.go` (daemon startup spinner).

### BUILD.bazel Cleanup

Removed ghost entries: `run_display_stream.go`, `run_stream_inline_bubbletea.go`, non-existent test files, `@land_charm_bubbletea_v2` and `@land_charm_bubbles_v2` deps (no Go files in root/ import them), and `//client-apps/cli/pkg/mdrender`.

## Benefits

- **~1,800 net lines removed**: 89 insertions / 1,875 deletions — smaller binary, less maintenance surface
- **Consistent SDK transport behavior**: Node and browser consumers get the same interceptor chain (auth, metadata, error stripping)
- **Cleaner SDK API**: `Conn()` escape hatch removed — all consumers use typed sub-clients
- **Accurate dependency tree**: Only genuinely needed charmbracelet packages remain
- **No ghost Bazel entries**: BUILD.bazel now matches the actual file tree

## Impact

- **Go CLI**: Compiles clean, all tests pass, `go vet` clean
- **Go SDK**: `Conn()` removed — breaking change for external consumers (none exist yet)
- **@stigmer/sdk**: New `./node` subpath export, 108 tests passing (6 new)
- **@stigmer/ink**: Transport delegated to SDK, 22 tests passing, build clean

## Related Work

- [CLI Ink Integration](2026-04-16-002907-cli-ink-integration-replace-bubbletea-with-ink.md) — The Ink migration this cleanup follows
- [SDK Sub-Client Migration](2026-04-15-221604-cli-sdk-sub-client-migration.md) — The migration that eliminated `Conn()` usage

---

**Status**: ✅ Production Ready
**Timeline**: 1 session
