# Skill Version History Backend Implementation

**Date**: May 9, 2026

## Summary

Implemented the complete backend infrastructure for skill version history across both Stigmer OSS (Go/SQLite) and Stigmer Cloud (Java/MongoDB). This includes a new `message` field on push requests, version metadata population, aligned archival semantics between editions, the `listVersions` RPC handler, and a CLI `-m` flag — enabling the frontend version timeline and diff viewer that were built in Phases 4C and 4D.

## Problem Statement

The frontend had a fully-built version timeline component (`VersionTimeline`) and multi-file diff viewer (`SkillDiffDialog`), but the backend had no `listVersions` handler implementation. The `useSkillVersions` hook was gracefully degrading by catching `UNIMPLEMENTED` (code 12) and showing empty state. Additionally, push requests had no way to carry a human-authored version message, and Cloud archival semantics diverged from OSS.

### Pain Points

- `listVersions` RPC returned `UNIMPLEMENTED` in both editions — version timeline showed nothing
- No `message` field on `PushSkillRequest` — no way to annotate what changed in a push
- Cloud Java archived the **previous** skill (skipping first push and same-hash), while OSS Go archived the **new** skill on every push — behavioral divergence
- `metadata.version` (`ApiResourceMetadataVersion`) existed but was unused by any push handler
- CLI `stigmer push skill` had no `-m`/`--message` flag

## Solution

Delivered as 5 sequential tasks across two repositories (`stigmer` OSS and `stigmer-cloud`), following proto-first design and maintaining behavioral consistency between editions.

## Implementation Details

### T1: Proto Change + Codegen
- Added `string message = 6` to `PushSkillRequest` in `io.proto`
- Regenerated all stubs: Go, TS, Python, Java, Dart via `make codegen` (OSS) and `make protos` (Cloud)
- Non-breaking additive change — frontend `useSkillVersions` already maps `SkillVersionEntry.message`

### T2: Wire `metadata.version` Through Push Handlers
- **OSS Go** (`PopulateSkillFieldsStep`): Sets `metadata.version.id` = content hash, `.message` = request message, `.previous_version_id` = existing skill's hash
- **Cloud Java** (`UpdateSkillState`): Same three fields via `ApiResourceMetadataVersion.newBuilder()`
- Leveraged existing `ApiResourceMetadataVersion` infrastructure instead of adding a redundant `version_message` to `SkillStatus`
- Fixed `fmt.Printf` warning → structured `log.Warn()` in OSS archival step

### T3: Align Cloud Archival Semantics
- Renamed `ArchiveCurrentVersion` → `ArchiveNewVersion`
- Moved archive step **after** `UpdateSkillState` in pipeline (was before)
- Removed `isNew` skip and same-hash skip — archives on every push, matching OSS
- Extracted 3x duplicated `normalizeToSlug` to a single `private static` method

### T4: `listVersions` Handler (Both Editions)
- **OSS Go** (`list_versions.go`): 2-step pipeline — `ResolveSkillBySlugStep` + `LoadAndMapVersionsStep`
- **Cloud Java** (`SkillListVersionsHandler.java`): 4-step pipeline — `ResolveSkillBySlug` + `Authorize` (FGA `can_view`) + `LoadAndMapVersions` + `SendResponse`
- Field mapping from archived `Skill` → `SkillVersionEntry`: version_hash, pushed_at, pushed_by, tag, is_current, git_provenance, message, artifact_storage_key
- Cursor-based in-memory pagination (base64-encoded offset), default page_size=50, max=100

### T5: CLI `-m` / `--message` Flag
- Added `StringVarP(&message, "message", "m", ...)` to push command
- Threaded through `pushOptions` → `PushOptions` → `SkillArtifactOptions` / `RemotePushOptions` → `PushSkillRequest.Message`
- Displayed in `DisplayPushResult` when non-empty

## Benefits

- **Version timeline works end-to-end** — frontend `useSkillVersions` hook will receive real data as soon as backend deploys
- **Version messages** — users can annotate pushes with `stigmer push skill -m "Added PDF extraction tool"`
- **Behavioral consistency** — Cloud and OSS now archive identically (new skill, every push)
- **Clean architecture** — used existing `ApiResourceMetadataVersion` instead of introducing a skill-specific versioning field, setting the pattern for future Agent/MCP versioning
- **Code quality** — fixed structured logging, extracted duplicated code, clean pipeline ordering

## Impact

- **Backend**: Both Go and Java backends now serve the `listVersions` RPC
- **CLI**: New `-m`/`--message` flag on `stigmer push skill`
- **Frontend**: Version timeline and diff viewer will activate automatically (graceful degradation → real data)
- **Proto**: Non-breaking additive field on `PushSkillRequest`

## Related Work

- Phase 4 T05-C: Skill Version Timeline (frontend, session 14)
- Phase 4 T05-D: Multi-File Diff Viewer (frontend, session 15)
- Phase 4 T05-E: Backend API Requirements Doc (session 16)
- DD-T05E-backend-api-requirements.md (design spec this work implements)

---

**Status**: ✅ Production Ready
**Timeline**: Single session implementation
