# Seedpack Root Move + CLI Bootstrap Migration

**Date**: February 28, 2026

## Summary

Moved the seedpack from its deeply nested location (`backend/services/stigmer-server/pkg/seedpack/`) to the repository root (`seedpack/`), gutted it from a 660-line resource parser to a 80-line embed wrapper, migrated server bootstrap entirely to a CLI-driven subprocess (`stigmer apply`), and deleted ~1,100 lines of duplicated bootstrap logic. System resources are now applied through the exact same code path as user projects.

## Problem Statement

The seedpack — Stigmer's collection of system skills, agents, and MCP server definitions — suffered from three architectural problems that created maintenance burden and violated the platform's own principles.

### Pain Points

- **Hidden location**: The seedpack was buried at `backend/services/stigmer-server/pkg/seedpack/`, making it invisible to contributors and unusable as a reference project for customers
- **Duplicated logic**: The server-side `bootstrap.go` (~428 lines) reimplemented resource discovery, YAML parsing, and apply logic that already existed in the CLI's `stigmer apply` command — two code paths doing the same thing
- **Monolithic seedpack package**: `seedpack.go` (~660 lines) contained its own manifest discovery, YAML parsing, ZIP creation, provenance handling, and type system — all redundant with CLI capabilities
- **Tight coupling**: The server imported the seedpack and bootstrap packages, creating a dependency chain that made the server aware of resource content at compile time

## Solution

Single code path for everything. The seedpack becomes a thin embed wrapper (files in, files out), and the CLI orchestrates all resource application — including system bootstrap.

### Architecture Change

**Before**: `server.go → bootstrap.Run() → seedpack.DiscoverManifest() → seedpack.CreateSkillZIP() → internal API calls → SQLite bootstrap_state`

**After**: `daemon.EnsureRunning() → ensureSeedpackBootstrapped() → seedpack.ExtractToDir(tmpDir) → stigmer apply subprocess → flag file with content hash`

## Implementation Details

### Part A: Move + Gut Seedpack

1. **Directory move**: `git mv backend/services/stigmer-server/pkg/seedpack/ seedpack/` — first-class repo citizen
2. **Rewrite seedpack.go**: Replaced 660 lines with 80 lines exposing just `ExtractToDir()` and `ContentHash()`. All resource parsing, YAML loading, ZIP creation, and type definitions deleted
3. **Rewrite seedpack_test.go**: Replaced 800 lines with 4 focused tests (~100 lines)
4. **New Go module**: Created `seedpack/go.mod` as `github.com/stigmer/stigmer/seedpack`, added to `go.work`
5. **Project manifest**: Added `seedpack/stigmer.yaml` making it a proper Stigmer project
6. **Enhanced scanner**: Extended `scanSkillDirectories()` to support nested layouts (`skills/{name}/SKILL.md`) alongside flat layouts, with `containsSkillDirectories()` helper for proper YAML exclusion
7. **Script maintenance**: Fixed `REPO_ROOT` in 4 tool scripts, added `06_draft-agent-creator-agent.sh` and `regenerate_all.sh`

### Part B: CLI-Driven Bootstrap

1. **Bootstrap integration**: Added `ensureSeedpackBootstrapped()` to `daemon.EnsureRunning()` — extracts embedded content to temp dir, spawns `stigmer apply --config <tmpDir>` subprocess
2. **Recursion guard**: `STIGMER_SKIP_SEEDPACK_BOOTSTRAP=1` env var prevents infinite loop when the apply subprocess calls `EnsureRunning()`
3. **Idempotency**: Content hash stored in `$dataDir/.seedpack-bootstrapped` flag file — bootstrap skipped when hash matches
4. **Server cleanup**: Removed `bootstrap.NewBootstrapper()` call and import from `server.go`, kept search index rebuild (now decoupled from bootstrap)
5. **Package deletion**: Removed entire `bootstrap/` package (428 lines + tests + BUILD.bazel)

### Part C: Build System

- Updated `seedpack/BUILD.bazel` with new importpath, removed proto/YAML deps
- Updated `server/BUILD.bazel` to remove bootstrap dependency
- Updated `daemon/BUILD.bazel` to add seedpack dependency

## Benefits

- **~1,100 lines deleted, ~300 added**: Net reduction of ~800 lines. Simpler codebase
- **Single code path**: System resources and user resources applied through identical logic — bugs fixed once, not twice
- **Discoverable**: Seedpack at repo root, visible to contributors and customers
- **Proper Stigmer project**: Has `stigmer.yaml`, can be applied with `stigmer apply`, serves as canonical reference
- **Cleaner server**: Server no longer knows about resource content or bootstrap logic — it just serves gRPC
- **Testable**: 4 seedpack tests + 4 new scanner tests, all existing tests pass (62 in apply suite)

## Impact

- **Server**: No longer imports bootstrap or seedpack packages. Search index rebuild preserved at startup
- **CLI daemon**: New dependency on seedpack package (one-way, no cycle risk). Bootstrap happens after daemon starts
- **Build system**: Seedpack is its own Go module in the workspace
- **Contributors**: Seedpack is now a visible, well-documented reference project at repo root

## Related Work

- T02: Declarative track skill directory support (prerequisite — scanner enhancement)
- T01: Architecture review (identified seedpack as hidden, bootstrap as duplicated)
- `2026-02-25-012027-seedpack-auto-discovery-content-hashing.md` — Original seedpack auto-discovery

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~2 hours)
