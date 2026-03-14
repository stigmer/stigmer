# Port API Key CRUD to OSS CLI and Remove Cloud CLI

**Date**: March 14, 2026

## Summary

Ported the API key management commands (create, get, list, delete, fingerprint) from the cloud CLI into the OSS CLI, then permanently removed the entire `stigmer-cloud/client-apps/cli/` directory (~28,000 lines, ~100 files). This eliminates the embedded Auth0 client secret from the cloud repository and completes the CLI consolidation — the OSS CLI now fully supersedes the cloud CLI.

## Problem Statement

The Stigmer platform had two CLI implementations: the original cloud CLI in `stigmer-cloud/client-apps/cli/` and the OSS CLI in `stigmer/client-apps/cli/`. After porting authentication (PKCE OAuth), backend wiring, and all resource management commands to the OSS CLI, the cloud CLI existed only as dead code — with one exception: API key management had never been ported.

### Pain Points

- Duplicate CLI codebases creating maintenance confusion
- Embedded Auth0 client secret (`haPGCQa...`) in the cloud CLI's source code
- Outdated `FEATURE_COMPARISON.md` showing features as missing that were implemented months ago
- Cloud CLI Makefile targets pointing to a CLI that should no longer be built

## Solution

Two-phase approach: port the missing API key functionality first, then cleanly remove the entire cloud CLI.

**Phase A** — Port API key CRUD to OSS CLI using the registry-based verb routing pattern, with a dedicated `stigmer apikey` command group for operations that don't fit the unified verb model (create and fingerprint).

**Phase B** — Delete the entire `stigmer-cloud/client-apps/cli/` directory and clean up all references.

## Implementation Details

### API Key Domain Package (`internal/cli/apikey/`)

Created five files following the established OSS CLI domain package pattern:

- **`get.go`** — `GetFromBackend(conn, ref)` delegates to `ApiKeyQueryController.Get`
- **`list.go`** — `ListFromBackend(conn)` delegates to `ApiKeyQueryController.FindAll` (API keys are not search-indexed, so this bypasses the unified SearchService)
- **`delete.go`** — `DeleteOptions` / `Delete(opts)` delegates to `ApiKeyCommandController.Delete`
- **`create.go`** — `CreateOptions` / `Create(opts)` delegates to `ApiKeyCommandController.Create` with expiration duration parsing (supports `30d`, `6h`, `1y` format)
- **`display.go`** — `DisplayGetResult`, `DisplayListResult`, `DisplayCreateResult` using `display.DisplayProto` / `display.DisplayProtoSlice` for yaml/json/table output

### Two Access Paths

API keys are accessible through both the unified verb system and a dedicated command group:

**Unified verbs** (wired via registry + route switch):
```
stigmer get apikey <id>
stigmer list apikey
stigmer delete apikey <id>
```

**Dedicated command** (standalone cobra command group):
```
stigmer apikey create [--name] [--expires-in 30d] [--never-expires]
stigmer apikey fingerprint <raw-key>
```

The `create` subcommand defaults to 90-day expiration and prominently displays the raw key (shown only once at creation). The `fingerprint` subcommand computes SHA-256 client-side and calls `GetByKeyHash` — the raw key never leaves the client.

### Registry and Route Wiring

- Added `ApiResourceKind_api_key` to `cliRelevantKinds` in `registry.go`
- Added get/list/delete verb support in `verb_support.go`
- Added `case apiresourcekind.ApiResourceKind_api_key:` to `routeGet`, `routeList`, `routeDelete`
- Added `deleteApiKey` handler in `delete_handlers.go` with confirmation prompt

### Cloud CLI Removal

- Deleted `stigmer-cloud/client-apps/cli/` entirely (~100 files, ~28,000 lines)
- Removed `cli-install` and `cli-update-deps` targets from `stigmer-cloud/Makefile`
- Verified the embedded client secret has zero matches in the repo
- Verified zero code/config/build file references to `client-apps/cli`
- Historical references in `_changelog/` documents are preserved (they document past changes)

### Cleanup

- Deleted `FEATURE_COMPARISON.md` from the OSS CLI — it was severely outdated, listing nearly every feature as "missing" when they had all been implemented

## Key Differences from Cloud CLI Port

| Aspect | Cloud CLI | OSS CLI |
|--------|-----------|---------|
| Import path | `buf.build/gen/go/leftbin/stigmer-cloud/...` | `github.com/stigmer/stigmer/apis/stubs/go/...` |
| Output | `cliprint` package | `display.DisplayProto` / `display.DisplayProtoSlice` |
| Connection | `backend.NewConnection()` + manual auth | `backend.NewConnection()` with PerRPCCredentials |
| Error handling | `clierr.Handle()` | `clierr.Handle()` (unified) |
| List mechanism | Direct FindAll RPC | Direct FindAll RPC (not search-indexed) |

## Benefits

- **Single CLI**: One authoritative CLI implementation, eliminating maintenance confusion
- **Secret removed**: Embedded Auth0 client secret permanently gone from cloud repo
- **Feature complete**: API key management now available in the OSS CLI
- **Clean codebase**: ~28,000 lines of dead code removed from stigmer-cloud
- **Consistent UX**: API keys follow the same registry-based verb pattern as all other resources

## Impact

- **OSS CLI users**: Gain API key management capabilities
- **Cloud repo maintainers**: No more dead CLI code to navigate around
- **Security**: Embedded client secret eliminated from source control
- **CI/CD**: Cloud repo Makefile no longer references deleted directory

## Files Changed

### OSS CLI (stigmer repo) — Created
- `client-apps/cli/internal/cli/apikey/get.go`
- `client-apps/cli/internal/cli/apikey/list.go`
- `client-apps/cli/internal/cli/apikey/delete.go`
- `client-apps/cli/internal/cli/apikey/create.go`
- `client-apps/cli/internal/cli/apikey/display.go`
- `client-apps/cli/cmd/stigmer/root/apikey.go`

### OSS CLI (stigmer repo) — Modified
- `client-apps/cli/cmd/stigmer/root.go`
- `client-apps/cli/cmd/stigmer/root/get.go`
- `client-apps/cli/cmd/stigmer/root/list.go`
- `client-apps/cli/cmd/stigmer/root/delete.go`
- `client-apps/cli/cmd/stigmer/root/delete_handlers.go`
- `client-apps/cli/internal/cli/types/registry.go`
- `client-apps/cli/internal/cli/types/verb_support.go`

### OSS CLI (stigmer repo) — Deleted
- `client-apps/cli/FEATURE_COMPARISON.md`

### Cloud repo (stigmer-cloud) — Deleted
- `client-apps/cli/` (entire directory, ~100 files)

### Cloud repo (stigmer-cloud) — Modified
- `Makefile` (removed CLI targets)

## Related Work

- [CLI Auth Commands PKCE Scaffold](2026-03-14-073329-cli-auth-commands-pkce-scaffold.md)
- [CLI PKCE OAuth Login Flow](2026-03-14-074848-cli-pkce-oauth-login-flow.md)
- [CLI Cloud Backend Auth Wiring](2026-03-14-081311-cli-cloud-backend-auth-wiring.md)

---

**Status**: ✅ Production Ready
**Project**: `20260314.01.cli-cloud-auth-pkce` (Task 4 — final task)
