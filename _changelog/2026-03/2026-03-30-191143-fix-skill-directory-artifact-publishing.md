# Fix Skill Directory Artifact Publishing in Daytona Cloud Mode

**Date**: March 30, 2026

## Summary

Fixed a bug in `publish_artifact.py` where skill directories were never published as `DIRECTORY` artifacts in Daytona cloud mode. The root cause was `_list_zip_entries_sandbox` accessing `.stdout` on Daytona's `ExecuteResponse`, which only exposes `.result`. This caused every directory artifact publish to crash silently, preventing the frontend's skill detection ("Push Skill" button) from ever activating during streaming execution.

## Problem Statement

When the skill-creator agent wrote files inside a skill directory (e.g., `infra-chart-composer/SKILL.md`), the frontend displayed a **FILE artifact named "SKILL.md"** instead of a **DIRECTORY artifact named "infra-chart-composer"**. The frontend's `isSkillPackage()` requires `kind === DIRECTORY` AND `entries.includes("SKILL.md")` — a FILE artifact never qualifies, so the "Push Skill" button never appeared.

### Pain Points

- Users could not push skills from the web app after the agent created them
- The bug was completely silent — the `InlinePublisher`'s fire-and-forget error handling swallowed the `AttributeError` with only a warning log
- The post-stream safety net would then publish `SKILL.md` as an individual FILE artifact, masking the real failure
- No integration tests existed to catch this class of Daytona SDK API mismatch

## Solution

Two-line fix in `publish_artifact.py` replacing `.stdout` / `.stderr` with `.result` on Daytona's `ExecuteResponse` object. Added decision-point and traceback logging to `InlinePublisher` for future diagnosability.

## Implementation Details

### Root Cause (`publish_artifact.py`)

Daytona's `sandbox.process.exec()` returns an `ExecuteResponse` with a `.result` attribute (combined stdout), not separate `.stdout` / `.stderr` fields. Two call sites in `_publish_from_sandbox` used the wrong attribute:

1. `_list_zip_entries_sandbox` — `result.stdout.strip().splitlines()` crashed with `AttributeError` on every directory publish
2. Zip error path — `result.stderr` would have crashed if the zip command ever failed (latent bug)

### Logging Improvements (`inline_publisher.py`)

- Added decision-point logging before the skill-root/single-file branch, showing which path was taken and the resolved sandbox path
- Changed the outer `except` to use `exc_info=True` for full traceback instead of just the exception message
- Added `DEBUG`-level logging when `file_exists()` fails in `_find_skill_root` (previously silently swallowed)

### Integration Tests (new)

Created `tests/integration/test_inline_publisher_daytona.py` with 10 tests exercising the full pipeline against a real Daytona sandbox:

- `TestSandboxFileInfo` (2 tests) — proves `sandbox.fs.get_file_info` returns correct `is_dir` values for the rebased path coordinate system
- `TestPublishArtifactDirect` (3 tests) — proves `publish_artifact()` produces DIRECTORY artifacts with correct entries and valid ZIP content
- `TestInlinePublisherEndToEnd` (4 tests) — proves the full `InlinePublisher.publish()` flow including skill root detection, directory publishing, single-file publishing, and root tracking
- `TestFullPipelineR2` (1 test) — optional full round-trip through real Cloudflare R2 storage

All tests are skipped when `DAYTONA_API_KEY` is absent. The R2 test additionally requires R2 credential environment variables.

## Benefits

- Skill directory artifacts are now correctly published as `DIRECTORY` with `SKILL.md` in entries
- Frontend's `isSkillPackage()` detection fires during streaming, enabling the "Push Skill" button
- Integration tests prevent regression — any future Daytona SDK API change will be caught immediately
- Improved logging makes future publish failures diagnosable without guesswork

## Impact

- **Users**: Can now push skills directly from the web app after the agent creates them
- **Agent Runner**: Directory artifact publishing works correctly in Daytona cloud mode
- **Observability**: Operators can trace exactly which publish path was taken and why failures occur

## Related Work

- [Real-Time Skill Artifact Publishing](_changelog/2026-03/2026-03-30-153400-real-time-skill-artifact-publishing.md) — the original feature that introduced skill-aware directory publishing
- [Filesystem Backend Standardization](_projects/2026-03/20260330.02.filesystem-backend-standardization/) — standardized `DaytonaWorkspaceBackend` path normalization (deployed alongside this fix)

---

**Status**: Production Ready
**Timeline**: ~2 hours (diagnosis via integration tests + fix + verification)
