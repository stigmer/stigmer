# Seedpack Auto-Discovery and Content-Hash Bootstrap

**Date**: February 25, 2026

## Summary

Replaced the manually maintained `manifest.json` in the seedpack package with convention-based filesystem auto-discovery and content-hash change detection. Resources embedded in the server binary are now automatically discovered by walking directory structures, and re-bootstrap is triggered only when actual file content changes -- eliminating two classes of bugs where resources exist but aren't bootstrapped.

## Problem Statement

The seedpack bootstrap mechanism relied on a hand-maintained `manifest.json` that explicitly listed every skill, system agent, and MCP server to be bootstrapped at server startup. A manually bumped `version` string controlled whether re-bootstrap would run.

### Pain Points

- **Silent omission**: The `agent-creator` skill existed in the embedded filesystem but was never bootstrapped because it wasn't listed in `manifest.json`. This class of bug is invisible -- the skill files are present in the binary, yet the server silently skips them.
- **Manual version bumping**: Forgetting to bump `manifest.version` after adding or changing a resource caused the bootstrap to skip entirely, even when the manifest itself was updated.
- **Redundant bookkeeping**: Resource metadata (name, path) was duplicated between the filesystem layout and the manifest, violating DRY and creating drift risk.
- **Coupled concerns**: Build-time vendoring configuration (git URLs, commit SHAs) was mixed into the same file used for runtime discovery.

## Solution

Adopted a convention-over-configuration model with three pillars:

1. **Directory-based auto-discovery**: Resources are identified by their position in the embedded filesystem using fixed conventions (`skills/{name}/SKILL.md`, `agents/{name}.yaml`, `mcp-servers/{name}.yaml`).
2. **Content-addressed change detection**: A deterministic SHA256 hash over all embedded resource files replaces the manual version string. Any file change (add, modify, remove) produces a different hash and triggers re-bootstrap.
3. **Separation of build-time and runtime concerns**: Vendoring configuration moved to a dedicated `tools/vendor-sources.json`, keeping runtime code free of source URLs and commit SHAs.

## Implementation Details

### Auto-Discovery (`seedpack.go`)

- **`DiscoverManifest()`** replaces `LoadManifest()`. Walks the embedded `embed.FS` to build a `Manifest` struct dynamically.
- **`discoverSkills()`** scans `skills/` for subdirectories containing `SKILL.md`, creating a `SkillEntry` with name derived from the directory name and a per-skill `ContentDigest`.
- **`discoverAgents()`** and **`discoverMcpServers()`** scan their respective directories for `.yaml` files, extracting `metadata.name` via a lightweight YAML parser.
- **`computeSeedpackHash()`** produces a short (12-char) deterministic SHA256 over every file in `skills/`, `agents/`, and `mcp-servers/`, using sorted paths for reproducibility.
- **`computeSkillDigest()`** hashes all files within a single skill directory for per-resource change detection.

### Bootstrap Integration (`bootstrap.go`)

- The `KeySeedpackVersion` constant was renamed to `KeySeedpackContentHash` to reflect the new semantics.
- On startup, the bootstrap compares the stored content hash against the freshly computed one. If they match, the entire bootstrap is skipped. If they differ, each resource is individually checked and applied.

### Manifest Struct Simplification

Removed fields that were artifacts of the manual approach: `SchemaVersion`, `Version`, `CreatedAt`, `Description`, and `SkillSource`. Added `ContentHash` as the single version indicator.

### Build Tooling

- **Deleted** `manifest.json` from the seedpack root.
- **Created** `tools/vendor-sources.json` with the vendoring configuration previously embedded in the manifest.
- **Updated** `01_vendor_skill.sh` to read from `vendor-sources.json` instead of `manifest.json`.
- **Updated** `embed.go` and `BUILD.bazel` to remove `manifest.json` references.

### Test Coverage

- Rewrote `seedpack_test.go` with tests for discovery, hash determinism, sorted output, and individual resource verification.
- Updated `bootstrap_test.go` to use content-hash assertions and verify both `skill-creator` and `agent-creator` are discovered.
- Added `TestExtractYAMLMetadataName` and `TestComputeSkillDigest` for the new helper functions.

## Benefits

- **Zero-maintenance discovery**: Adding a new skill, agent, or MCP server to the embedded filesystem is the only step needed -- no manifest edits, no version bumps.
- **Automatic change detection**: Content hashing guarantees re-bootstrap when (and only when) embedded files actually change.
- **Eliminated silent omissions**: Every correctly placed resource is discovered. The `agent-creator` bug is structurally impossible with this approach.
- **Cleaner separation of concerns**: Runtime code doesn't know about git repositories or commit SHAs; build tooling doesn't interfere with discovery logic.

## Impact

- **Server bootstrap**: All embedded resources are now reliably bootstrapped on every server start where content has changed.
- **Developer experience**: Contributors adding new seedpack resources no longer need to update a manifest or remember to bump a version.
- **Build pipeline**: The vendor script continues to work unchanged in behavior, just reads from a dedicated config file.

## Related Work

- [Seedpack Infrastructure Phase 1](2026-02-08-122424-seedpack-infrastructure-phase-1.md)
- [Seedpack Bootstrap State Machine](2026-02-08-135010-seedpack-bootstrap-state-machine.md)
- [Vendor Skill Creator Seedpack Foundation](2026-02-08-115619-vendor-skill-creator-seedpack-foundation.md)
- [Seedpack Simplification Runtime ZIP](2026-02-23-231256-seedpack-simplification-runtime-zip.md)
- [Bootstrap MCP Server Integration](2026-02-23-195432-bootstrap-mcp-server-integration.md)

---

**Status**: ✅ Production Ready
