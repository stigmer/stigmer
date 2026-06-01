# Fix Cursor Harness Skill Artifact Extraction

**Date**: June 1, 2026

## Summary

The Cursor harness now downloads and extracts full skill ZIP artifacts (references, scripts, etc.) alongside SKILL.md during agent setup. Previously, only the SKILL.md file was written to the workspace, causing agents to fail when skills referenced companion files in subdirectories like `references/`.

## Problem Statement

When the Cursor harness provisioned skills for agent execution, it only wrote `spec.skillMd` as `SKILL.md` to the workspace. The deep-agent harness correctly downloaded the full ZIP artifact and extracted all files (references, scripts, etc.), but the Cursor path was missing this step entirely.

### Pain Points

- Skills with `references/` subdirectories (e.g., `garden-design-makeover` with `references/database-schema.md`) failed on the Cursor harness because companion files were never written to disk
- The agent would read SKILL.md, see a reference to `references/database-schema.md`, attempt to read it, and fail — falling back to less informed behavior
- This was a known scope gap from the May 1 blueprint propagation work that deferred artifact materialization

## Solution

Extracted the ZIP parsing logic from `skill-writer.ts` into a shared `zip-extract.ts` module, then updated `skill-resolver.ts` to download and extract skill artifacts during Cursor harness setup.

## Implementation Details

### New shared module: `shared/zip-extract.ts`

Pure ZIP parsing utility — no I/O, no `WorkspaceBackend` coupling. Exposes a single `extractZipFileEntries()` API that returns parsed entries as `{ path, content }` pairs. Consumers bring their own write mechanism. Supports stored (method 0) and deflated (method 8) entries, with an `exclude` option for filtering.

### Refactored: `shared/skill-writer.ts`

Replaced ~155 lines of private ZIP parsing code with thin wrappers over the shared module. No exported signature changes — all 27 existing tests pass unchanged.

### Updated: `execute-cursor/skill-resolver.ts`

Two changes:
- `resolveSkills()` now downloads the artifact ZIP via `client.getSkillArtifact()` when `skill.status.artifactStorageKey` exists. Wrapped in nested try/catch so download failure is non-fatal (SKILL.md alone is still useful).
- `writeSkill()` now accepts optional `artifactBytes` and extracts ZIP entries (excluding SKILL.md) to the skill directory, creating intermediate directories as needed.

### Test coverage

- `shared/__tests__/zip-extract.test.ts`: 12 unit tests covering stored/deflated entries, directory skipping, basename and full-path exclusion, and graceful handling of empty/malformed/non-ZIP input
- `execute-cursor/__tests__/skill-resolver.test.ts`: 4 integration tests using real temp directories — artifact extraction, no-artifact fallback, download failure fallback, and spec.skillMd precedence over ZIP copy

## Benefits

- Skills with companion reference files now work correctly on the Cursor harness
- ZIP parsing logic is shared between both harnesses — single source of truth
- `skill-writer.ts` is 155 lines lighter with no behavior change
- Artifact download failure degrades gracefully to SKILL.md-only (existing behavior preserved)

## Impact

- **Agent execution**: Skills like `garden-design-makeover` with `references/database-schema.md` now have all files available when running on the Cursor harness
- **Workflows**: Multi-agent workflows (e.g., daily-notification-plan) that use skills with reference files now succeed on the first agent call
- **Deep-agent path**: Internal refactor only — behavior and signatures unchanged

## Related Work

- May 1 blueprint propagation (skill-resolver.ts creation)
- DD-7 from unified runner migration (deferred skill-aware artifact publishing — still deferred, this fix is about provisioning)

---

**Status**: Production Ready
**Timeline**: Single session
