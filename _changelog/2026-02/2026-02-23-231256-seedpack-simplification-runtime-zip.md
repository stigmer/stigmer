# Seedpack Simplification: Remove Artifacts, Create ZIPs at Runtime

**Date**: February 23, 2026

## Summary

Simplified the seedpack structure by removing the pre-built `artifacts/` directory and the `drafts/` directory, eliminating ~3,600 lines of duplicated content. Bootstrap now creates skill ZIP archives at runtime from the embedded skill source files, making the seedpack clean, maintainable, and script-driven.

## Problem Statement

The seedpack had accumulated structural complexity that made it harder to maintain and reason about:

### Pain Points

- **Pre-built ZIP artifacts** (`artifacts/skill-creator.zip`) duplicated content already present in `skills/skill-creator/` — the binary carried both the source files and a ZIP of those same files
- **The `drafts/agent-drafter/` directory** contained duplicated proto files and documentation that had already diverged from the canonical proto definitions in `apis/`
- **Tool scripts were unnumbered**, giving no indication of execution order
- **The `skill-creator-agent`** had no access to platform resources (MCP servers, skills) during skill drafting, limiting the quality of generated skills
- **The `stigmer-mcp-server`** was missing the `org: local` field in its metadata, inconsistent with the `ApiResourceReference` schema

## Solution

Replaced the pre-built artifact approach with runtime ZIP creation during bootstrap. Moved canonical documentation next to the proto definitions. Made the seedpack entirely script-driven with numbered tool scripts.

## Implementation Details

### Runtime ZIP Creation (`seedpack.go`)

Replaced `LoadSkillArtifact()` with `CreateSkillZIP()`:
- Walks the embedded skill directory using `ListSkillFiles()`
- Creates a ZIP archive in memory using `archive/zip`
- Returns raw bytes ready for the Push API
- No file I/O — works entirely from the `embed.FS`

### Bootstrap Code (`bootstrap.go`)

Updated `bootstrapSkill()` to:
- Call `seedpack.CreateSkillZIP(entry.Path)` instead of `seedpack.LoadSkillArtifact(entry.ArtifactPath)`
- Use `ContentDigest` for change detection instead of `ArtifactDigest`
- Removed artifact digest verification (content digest from provenance is the source of truth)

### Manifest Schema v4 (`manifest.json`)

- Bumped to schema version 4, version 1.4.0
- Removed `artifact_path` and `artifact_digest` fields from skill entries
- `content_digest` remains as the authoritative change-detection field

### SkillEntry Struct Cleanup

Removed `ArtifactPath` and `ArtifactDigest` from the `SkillEntry` struct — the struct now only carries `Name`, `Path`, `ContentDigest`, and `Source`.

### Numbered Tool Scripts

- `vendor_skill.sh` → `01_vendor_skill.sh` (vendor skills from upstream)
- `draft_agent_creator.sh` → `02_draft_agent_creator.sh` (generate agent-creator skill)
- Execution order is now self-documenting

### Vendor Script Cleanup (`01_vendor_skill.sh`)

Removed the entire artifact creation section (ZIP generation, artifact digest calculation, `zip` dependency check). The script now focuses purely on vendoring source files and generating provenance.

### Skill-Creator Agent Enhancement

Added `mcp_server_usages` to `skill-creator-agent.yaml` with read-only access to `stigmer-mcp-server`, enabling the agent to query available MCP servers, skills, agents, and workflows during skill drafting.

### Agent Resource Guide

Created `apis/ai/stigmer/agentic/agent/docs/agent-resource-guide.md` — a comprehensive guide for creating Agent YAML files, placed next to the canonical proto definitions rather than buried in the seedpack.

### MCP Server Metadata Fix

Added `org: local` to `stigmer-mcp-server.yaml` metadata, aligning with the `ApiResourceReference` schema that requires the `org` field.

## Benefits

- **~3,600 lines removed** — eliminated duplicated proto files, stale documentation, and pre-built artifacts
- **Single source of truth** — skill content exists only in `skills/`, no parallel ZIP copy
- **Simpler binary** — no artifact blobs embedded; ZIPs are created on demand
- **Script-driven workflow** — numbered scripts make the seedpack setup self-documenting
- **Platform-aware skill drafting** — skill-creator-agent can now query real platform resources
- **Clean directory structure** — seedpack contains only `agents/`, `mcp-servers/`, `skills/`, and `tools/`

## Impact

- **Server bootstrap**: Behavior unchanged — skills are still pushed as ZIPs via the Push API. The only difference is the ZIP is created at runtime instead of being loaded from a pre-built file.
- **Seed pack maintainers**: Simpler workflow — run numbered scripts in order, no need to manage artifact files.
- **Skill drafting**: The skill-creator-agent now has MCP server access, improving the quality of generated skills.

## Related Work

- Previous session established the skill-creator-agent and seedpack MCP server integration
- The `agent-resource-guide.md` consolidates information from multiple proto files into a single authoritative document for agent creation

---

**Status**: ✅ Production Ready
**Timeline**: Single session
