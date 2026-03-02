# Unified Organization Context and CLI Defaults

**Date**: March 3, 2026

## Summary

Eliminated all hardcoded `"local"` organization fallbacks from the CLI, unified three fragmented org-resolution functions into a single backend-agnostic priority chain, and introduced `stigmer context` commands for explicit organization switching. The CLI now auto-detects and sets the active organization during server startup, delivering zero-friction UX for local users while sharing a single code path with cloud deployments.

## Problem Statement

The CLI had three separate org-resolution functions (`resolveApplyOrganization`, `resolveOrganization`, `resolveOrgID`) with inconsistent priority chains. Each branched on backend type — local mode hardcoded `"local"`, cloud mode read from config — creating two diverging code paths. This conflated connectivity (where the server runs) with tenancy (which organization's resources you work with), making every new resolution site a maintenance trap.

### Pain Points

- Three resolution functions with different priority chains: easy to pick the wrong one, hard to keep consistent
- `resolveOrganization` in verb_helpers.go had a bug: ignored the `--org` flag for local backend
- `ContextConfig.Organization` existed in the config model but was completely dead code
- Adding a new command that needed org required knowing which of the 3 functions to use and whether to branch on backend type
- No way for local users to switch organizations without editing config files manually

## Solution

Replaced all 4 hardcoded `"local"` org fallback sites with a single unified resolution chain: `--org flag > stigmer.yaml metadata.org > config context.organization > error`. This chain applies identically for local and cloud backends. The `context.organization` field in `~/.stigmer/config.yaml` becomes the single persistent source of truth, auto-set during server startup by querying the server for available organizations.

## Implementation Details

**Config layer** (`config.go`): Added `ResolveContextOrganization()` method on `Config` — reads `Context.Organization` first, falls back to `Backend.Cloud.OrgID` for backward compatibility with existing cloud configurations.

**Resolution collapse**: Updated `resolveApplyOrganization` (apply.go), `resolveOrganization` (verb_helpers.go), `resolveOrgID` (run_resolve.go), and `runBootstrapDiscovery` (server.go) to use the unified chain. Removed all `switch` statements on backend type for org resolution.

**Auto-context** (`server.go`, `daemon.go`): After seedpack bootstrap in `handleServerStart`, `autoSetOrgContext` queries `findMyOrganizations` via gRPC. If exactly one org exists, it's persisted to `context.organization`. `EnsureOrgContext` in `daemon.go` provides the same auto-detection for commands that auto-start the daemon.

**New `stigmer context` command** (`context.go`): `show` displays current org/environment/backend; `set --org <slug>` validates the org exists on the server before saving.

**Config keys** (`config_values.go`): `context.organization` and `context.environment` are readable/writable via `stigmer config get/set`.

## Benefits

- **Zero hardcoded org strings**: The magic string `"local"` is gone from all CLI code. The string `"default"` only exists in seedpack data files.
- **Single code path**: Local and cloud use identical resolution logic. No more backend-type branching for org.
- **Zero-friction UX**: On first `stigmer server` run, the org is auto-detected and persisted. No manual configuration needed.
- **Bug fix**: The `--org` flag now works consistently in local mode (was previously ignored by `resolveOrganization`).
- **Extensible**: Adding new resolution sites requires one call to `cfg.ResolveContextOrganization()`, not a 15-line switch block.

## Impact

- **Local users**: Seamless — `stigmer server` auto-sets context. Org switching via `stigmer context set --org`.
- **Cloud users**: Backward compatible — `Backend.Cloud.OrgID` continues to work. Can migrate to `context.organization` at their pace.
- **Maintainers**: One resolution function instead of three. No backend-type branching for org concerns.

## Related Work

- Follows T01.6 (seedpack Organization bootstrap) which established `metadata.org: default` in the seedpack project manifest
- Builds on T01.5 (Organization OSS controllers) which provides the `findMyOrganizations` RPC used for auto-detection
- Precedes T01.8 (skill docs) and T01.9 (product docs) which will update remaining `org: local` references in documentation

---

**Status**: Production Ready
**Timeline**: Session 10 of the org-tenancy-portable-resources project
