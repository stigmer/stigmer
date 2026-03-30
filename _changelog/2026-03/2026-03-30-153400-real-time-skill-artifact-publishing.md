# Real-Time Skill Package Artifact Publishing

**Date**: March 30, 2026

## Summary

Enhanced the `InlinePublisher` to detect skill directories in real time during agent execution and publish the entire skill directory as a single `DIRECTORY` artifact (ZIP), enabling the frontend's "Skill detected" badge to appear during streaming — not only after the post-stream safety net runs. Also updated the `skill-creator` agent instructions to stop rewriting all files on modification, since the platform now deterministically handles complete skill directory packaging.

## Problem Statement

When an agent created or modified a skill package, the real-time artifact experience was broken for skills. The `InlinePublisher` only knew how to publish individual files as `FILE` artifacts. The frontend's `useDetectSkillPackage` hook requires a `DIRECTORY` artifact with `SKILL.md` in its `entries` list — a structure that was only produced by the post-stream `auto_publish_written_files` safety net *after* execution completed.

### Pain Points

- Skills did not get the real-time "Skill detected" artifact card during streaming, unlike MCP Servers which appeared instantly
- The `skill-creator` agent carried an LLM-level workaround: its modification mode instructed the LLM to rewrite *all* files in the skill package even if only one file changed, to ensure the post-stream safety net would see all files and group them correctly
- This rewrite-everything approach was slow, token-expensive, and error-prone for large skill packages

## Solution

Made the `InlinePublisher` "skill-aware" so it detects when a file write lands inside a skill directory and publishes the entire directory as a `DIRECTORY` artifact instead of the individual file. This gives skills the same real-time artifact experience that MCP Servers already have.

## Implementation Details

### InlinePublisher Enhancement (`inline_publisher.py`)

- Added `_skill_roots: set[str]` — an in-memory cache of discovered skill root directories
- When a `SKILL.md` file is written, its parent directory is immediately registered as a skill root
- Added `_find_skill_root()` — walks ancestor directories from the written file path upward, checking the cache first, then falling back to `workspace_backend.file_exists()` to find directories containing `SKILL.md`
- Split publishing into two strategies: `_publish_skill_directory()` (zips and uploads the entire directory) and `_publish_single_file()` (original per-file behaviour)
- Exposed `published_skill_roots` property for the post-stream safety net
- Every subsequent file write inside the same skill root re-zips and re-uploads the directory to the **same storage key**, and `add_artifact` upserts by `sandbox_path` so the frontend always sees exactly one artifact card that updates in place

### Directory-Level Dedup in Auto-Publish (`attachments.py`)

- Added `_is_already_published()` helper that checks both exact path matches and ancestor directory matches (e.g. `"my-skill/SKILL.md"` is covered when `"my-skill"` is in the published set)
- The `auto_publish_written_files` safety net now correctly skips all files that were already subsumed by an inline-published skill directory

### Skill-Creator Agent Instructions (`skill-creator.yaml`)

- Removed the "rewrite all files" workaround from modification mode
- Agent now only writes files that actually need changes — the platform deterministically packages the full directory

## Benefits

- **Real-time UX parity**: Skills now get the same instant "detected" badge during streaming as MCP Servers
- **Token savings**: The `skill-creator` agent no longer rewrites unchanged files during modification
- **Correctness**: Directory packaging is handled deterministically by the platform, not by LLM instruction-following
- **Dedup**: The post-stream safety net correctly skips files already covered by inline directory publishes

## Impact

- **Frontend**: No changes needed — `useDetectSkillPackage` already handles `DIRECTORY` artifacts with `SKILL.md` in entries; now it fires during streaming instead of only post-execution
- **Backend**: `InlinePublisher` gains skill-awareness; `auto_publish_written_files` gains directory-level dedup
- **Agents**: `skill-creator` modification mode becomes more efficient and less error-prone
- **Storage**: Skill directory ZIPs are re-uploaded to the same key on each file write within the skill (overwrite, not accumulate)

## Related Work

- MCP Server real-time artifact detection (existing `detectStigmerResource.ts`)
- Frontend skill detection hooks (`useDetectSkillPackage`, `detect-skill-package.ts`)
- Post-stream `auto_publish_written_files` safety net

---

**Status**: Production Ready
**Timeline**: Single session
