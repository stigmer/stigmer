# T02: Enhance Declarative Track — Skill Directories + Subdirectory Scanning

**Status**: COMPLETED
**Created**: 2026-02-28

## Objective

Enhance `stigmer apply` (declarative track) to:
1. Auto-detect and push skill directories (subdirectories containing `SKILL.md`)
2. Scan one level of subdirectories for YAML resource files (e.g., `agents/`, `mcp-servers/`)

Without these, the declarative track cannot handle real-world projects like the seedpack.

## Changes Made

### File: `client-apps/cli/cmd/stigmer/root/apply_declarative.go`

**New functions:**
- `scanSkillDirectories(projectDir)` — finds immediate subdirectories with SKILL.md
- `isSkillDirectory(dir)` — checks for SKILL.md presence using `artifact.HasSkillFile()`
- `pushSkillDirectory(dir, conn, orgID)` — pushes via `skill.Push()`, returns `ApiResourceReference`
- `collectYAMLFiles(dir)` — collects YAML files from a single directory (non-recursive)

**Modified functions:**
- `scanResourceFiles(projectDir)` — now scans one level of subdirectories for YAML files, excluding skill directories
- `executeDeclarativeApply()` — added Phase 5a (push skills before YAML resources), updated Phase 1 to scan for both YAML files and skill directories

**New imports:** `artifact`, `skill`, `grpc`

### File: `client-apps/cli/cmd/stigmer/root/apply_declarative_test.go`

**New tests (8):**
- `TestScanResourceFiles_ScansImmediateSubdirectories`
- `TestScanResourceFiles_ExcludesSkillDirectories`
- `TestScanResourceFiles_SubdirYAMLsHaveAbsolutePaths`
- `TestScanSkillDirectories_FindsSkillDirs`
- `TestScanSkillDirectories_IgnoresNonSkillDirs`
- `TestScanSkillDirectories_MultipleSkills`
- `TestScanSkillDirectories_IgnoresFiles`
- `TestScanSkillDirectories_EmptyDirectory`

**Modified test:** `TestScanResourceFiles_SkipsSubdirectories` → replaced with `TestScanResourceFiles_ScansImmediateSubdirectories`

## Test Results

All 84 tests pass (including the 8 new/modified tests):
```
go test ./cmd/stigmer/root/ -run "TestScan|TestDetect|TestCountMembers|TestBuild" -v
PASS (1.241s)
```

## Design Decisions

1. **Skills pushed before YAML resources** — agents may reference skills, so push order matters
2. **One-level subdirectory scanning, not recursive** — keeps the mental model simple while supporting organized layouts
3. **Skill directories excluded from YAML scanning** — SKILL.md directories are a different resource type; their internal YAML files are skill content, not Stigmer resources
4. **Tag "latest" for declarative push** — consistent default; can be overridden in future
