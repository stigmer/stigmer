# Directory Artifact Support for Execution Artifacts

**Date**: March 20, 2026

## Summary

Implemented full-stack directory artifact support across the Stigmer platform — from proto definitions through backend handlers to SDK detection hooks. Directory artifacts (ZIPs produced by agent executions) are now self-describing, individually browsable, and pushable as skills without leaving the browser. This enables the skill-creator agent's output to flow directly into the Library.

## Problem Statement

Directory artifacts (kind=DIRECTORY, stored as ZIPs) were opaque blobs. The frontend could not detect whether a directory was a skill package, preview individual files within it, or push it as a skill without downloading the entire ZIP to the browser.

### Pain Points

- No way to detect skill packages from directory artifacts — `SKILL.md` was invisible inside the ZIP
- No API to preview individual files within a ZIP — only "Download ZIP" was available
- Pushing skills from execution artifacts required downloading the ZIP client-side and re-uploading — CORS issues for SDK consumers, bandwidth waste, and 512KB content limit
- `StigmerResourceKind` included `"Skill"` in the YAML detection path, creating a false positive path with no corresponding `apply()` action

## Solution

Three capabilities delivered through a single coordinated change across proto, agent runner, backend (Go + Java), and SDK:

1. **Detection**: `ExecutionArtifact.entries` field makes directory artifacts self-describing — the agent runner populates file paths at ZIP creation time
2. **Preview**: `GetArtifactContentRequest.entry_path` enables extracting a single file from a ZIP archive server-side
3. **Skill Push**: `pushFromExecutionArtifact` RPC reads the ZIP from artifact storage (server-to-server) and delegates to the existing push pipeline

## Implementation Details

### Proto Layer
- `ExecutionArtifact.entries` (`repeated string`, field 9): relative file paths within a directory artifact's archive, populated by the agent runner at creation time
- `GetArtifactContentRequest.entry_path` (`string`, field 4): when set, backend extracts the specified file from the ZIP instead of returning raw ZIP bytes
- `PushSkillFromExecutionArtifactRequest`: org, execution_id, storage_key, optional tag — references an existing artifact by storage key
- `SkillCommandController.pushFromExecutionArtifact()`: new RPC returning `Skill`

### Agent Runner (Python)
- `_list_zip_entries_sandbox()`: runs `zipinfo -1` on the ZIP in the sandbox, filters directories, returns file-only entries
- `_list_dir_entries()`: uses `Path.rglob("*")` for local mode, collects relative paths with forward-slash normalization
- Both functions populate `artifact.entries` before the artifact is returned to the execution status

### Backend — Go (stigmer-server)
- `extractZipEntry()`: reads a single file from an in-memory ZIP archive via `archive/zip`
- `GetArtifactContent`: when `entry_path` is set, extracts the entry from the downloaded ZIP, detects content type from entry path instead of storage key
- `PushFromExecutionArtifact`: validates storage_key prefix, downloads from execution artifact storage (60s timeout), constructs `PushSkillRequest`, delegates to `Push()`
- `SkillController`: new `executionArtifactStorage` field, `SetExecutionArtifactStorage()` setter, wired in `server.go`

### Backend — Java (stigmer-cloud)
- `LoadArtifactContentStep`: when `entry_path` is set, downloads full ZIP (no range limit), extracts entry via `ZipInputStream`, applies truncation and content type detection from entry path
- `SkillPushFromExecutionArtifactHandler`: full pipeline handler (11 steps) — validate, authorize, validate prefix, download from execution storage, extract SKILL.md, parse frontmatter, store in skill storage, find/create skill, archive version, persist, create IAM policies

### SDK (@stigmer/react)
- `isSkillPackage(artifact)`: synchronous check — `kind === DIRECTORY && entries.includes("SKILL.md")`
- `detectSkillPackage(artifact, skillMdContent)`: parses SKILL.md YAML frontmatter, extracts name and description
- `useDetectSkillPackage(artifact, executionId)`: React hook combining entries check with lazy SKILL.md content fetch via `entry_path`
- `useArtifactContent` extended with optional `entryPath` parameter
- Removed `"Skill"` from `StigmerResourceKind` — skills are packages, not YAML resources

### SDK Clients (All Languages)
- Go, Java, Python, TypeScript SDK clients regenerated with `pushFromExecutionArtifact` method on skill client

## Benefits

- **Instant detection**: Skill package detection requires zero RPCs — `entries` field is already in execution status
- **No CORS risk**: Server-side skill push avoids pre-signed URL CORS issues for third-party platform builders
- **No bandwidth waste**: ZIP never touches the browser — backend reads from artifact storage and pushes directly
- **Individual file preview**: Frontend can fetch any file from a ZIP archive without downloading the full archive
- **Clean type system**: YAML detection (Agent, McpServer) and package detection (Skill) are separate, type-safe paths
- **Backward compatible**: `entries` is `repeated string` — empty by default for older artifacts, graceful degradation

## Impact

- **SDK consumers**: New detection hooks (`isSkillPackage`, `detectSkillPackage`, `useDetectSkillPackage`) and extended `useArtifactContent` with `entryPath`
- **Platform builders**: Can detect and push skills from execution artifacts embedded in their UIs
- **Execution artifacts UI** (T02.3–T02.8): Can now render directory artifacts with skill detection badges and "Push Skill" CTAs
- **Agent runner**: All future directory artifacts will be self-describing via `entries`

## Related Work

- Builds on Session 13–15 work: T02.1 (`useExecutionArtifacts`, `useArtifactContent`), T02.2 (`detectStigmerResource`, `useDetectStigmerResource`)
- Enables T02.3 (`useApplyResource`) to include skill push support alongside Agent/McpServer apply
- Enables T02.4 (`ArtifactCard`) to render directory artifacts with skill detection badges
- Plan reference: `directory_artifact_support_c403095b.plan.md`

---

**Status**: ✅ Production Ready (D1–D6, D8 complete; D7 deferred to T02.3)
**Timeline**: 1 session
