# Checkpoint 01: Architecture Review Complete + Declarative Track Enhanced

**Date**: 2026-02-28
**Tasks Completed**: T01 (Architecture Review), T02 (Declarative Track Enhancement)

## Summary

Completed a thorough architecture review of three recently merged projects (declarative track, workspace provisioning, platform file isolation) and fixed the two critical gaps in the declarative track.

## What Was Accomplished

### T01: Architecture Review
- Verified all three projects are merged to `main` (no branch issues)
- Audited integration surfaces — all compose cleanly
- Identified 13 gaps across 3 severity levels
- Mapped the full end-to-end dependency chain
- Created prioritized roadmap: T02 → T03 → T04 → T05/T06

### T02: Declarative Track Enhancement (CODE COMPLETE)
Two critical gaps fixed:

1. **Skill directory support**: `scanSkillDirectories()` detects subdirectories with `SKILL.md` and pushes them via `skill.Push()` before applying YAML resources. Skills are pushed first because agents may reference them.

2. **Subdirectory YAML scanning**: `scanResourceFiles()` now scans one level of subdirectories for YAML files. This supports organized project layouts like the seedpack's `agents/` and `mcp-servers/` directories. Skill directories are excluded from YAML scanning.

Files changed:
- `client-apps/cli/cmd/stigmer/root/apply_declarative.go` (enhanced)
- `client-apps/cli/cmd/stigmer/root/apply_declarative_test.go` (8 new/modified tests)

All 84 tests pass.

## What's Next

| Task | Status | Description |
|------|--------|-------------|
| T03 | PENDING | Convert seedpack into a Stigmer project (add stigmer.yaml, fix scripts) |
| T04 | PENDING | Add `--workspace` flag to CLI for workspace provisioning |
| T05 | PENDING | End-to-end testing (8 scenarios, depends on T03+T04) |
| T06 | PENDING | Customer-facing documentation |

**Recommended next**: T03 (seedpack as project) — it validates T02 with a real project and becomes the reference for customers.

## Uncommitted Code Changes

The T02 changes are in the working tree but NOT committed:
- `client-apps/cli/cmd/stigmer/root/apply_declarative.go`
- `client-apps/cli/cmd/stigmer/root/apply_declarative_test.go`

These should be committed and PR'd before starting T03.
