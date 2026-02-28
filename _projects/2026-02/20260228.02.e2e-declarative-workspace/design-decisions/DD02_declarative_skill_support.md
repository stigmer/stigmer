# DD-02: Declarative Track Detects and Pushes Skill Directories

**Date**: 2026-02-28
**Status**: Implemented

## Decision

The declarative track (`stigmer apply`) auto-detects subdirectories containing `SKILL.md` and pushes them as skills before applying YAML resources.

## Context

Skills are directories (not YAML files). The original declarative scanner only handled `.yaml/.yml` files, making it impossible to apply a project containing skills.

## Design

1. `scanSkillDirectories()` finds immediate subdirectories with `SKILL.md`
2. Skills are pushed first via `skill.Push()` (agents may reference them)
3. `scanResourceFiles()` excludes skill directories from YAML scanning
4. One level of subdirectory scanning for YAML files (e.g., `agents/`, `mcp-servers/`)

## Alternatives Considered

- **SDK track for projects with skills**: Requires writing code, bad UX
- **Separate `stigmer push skill` step**: Two-step workflow, confusing for beginners
- **Add skills to `stigmer.yaml` manifest**: Over-engineering, breaks convention-over-configuration

## Rationale

Convention-based detection (SKILL.md presence) is consistent with how the CLI already works (`stigmer push skill` validates SKILL.md). Pushing before YAML apply ensures agents can reference skills immediately.
