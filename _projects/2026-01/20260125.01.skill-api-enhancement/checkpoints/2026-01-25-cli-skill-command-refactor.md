# Checkpoint: CLI Skill Command Refactor Complete

**Date**: 2026-01-25
**Task**: T01.12 - CLI Enhancement (stigmer skill push)
**Status**: Complete

---

## Summary

Refactored the Stigmer CLI to create a dedicated `stigmer skill` command group, removing skill push logic from `apply` and establishing a consistent command hierarchy following industry best practices (kubectl, docker, gh).

---

## What Was Accomplished

### Design Decision: Hierarchical Hybrid Model

Researched CLI best practices and implemented a hybrid command structure:

```
VERB-FIRST (Primary workflows)     NOUN-FIRST (Resource management)
├── apply                          ├── skill    [push]
├── run                            ├── server   [start, stop, status, logs]
├── new                            ├── backend  [set, status]
                                   └── config   [set, get]
```

**Rationale:**
- **Skill is a first-class API resource** deserving its own management group
- Future subcommands (`list`, `get`, `delete`, `versions`) fit naturally under `skill`
- `stigmer skill --help` shows all skill operations (discoverability)
- Follows industry standards: kubectl (`kubectl secret`), docker (`docker image`), gh (`gh pr`)

### New Commands Implemented

```bash
stigmer skill push              # Push from current directory
stigmer skill push ./my-skill/  # Push from specific directory
stigmer skill push --tag v1.0   # Push with specific tag
stigmer skill push --org acme   # Push to specific organization
stigmer skill push --dry-run    # Validate without pushing
```

### Files Created

| File | Lines | Description |
|------|-------|-------------|
| `cmd/stigmer/root/skill.go` | ~230 | Skill command group + push subcommand |

### Files Modified

| File | Change | Description |
|------|--------|-------------|
| `cmd/stigmer/root.go` | +1 line | Register `NewSkillCommand()` |
| `cmd/stigmer/root/apply.go` | -204 lines | Removed artifact mode |
| `internal/cli/artifact/skill.go` | +6/-6 | Fixed field access bugs |
| `COMMANDS.md` | +24 lines | Added skill docs section |
| `backend/.../get_artifact.go` | +1/-1 | Fixed `ctx.Input()` bug |

---

## Bug Fixes (Pre-existing)

### 1. artifact/skill.go - Incorrect Field Access

The `push` RPC returns a `Skill` resource, not a `PushSkillResponse`. Fixed:

```go
// Before (wrong)
response.VersionHash
response.Tag
response.ArtifactStorageKey

// After (correct)
response.Status.VersionHash
response.Spec.Tag
response.Status.ArtifactStorageKey
```

### 2. get_artifact.go - Wrong Method Call

```go
// Before (wrong)
ctx.Request().GetArtifactStorageKey()

// After (correct)
ctx.Input().GetArtifactStorageKey()
```

---

## Code Quality

Per CLI Engineering Standards:

- [x] Each file under 250 lines (skill.go ~230 lines)
- [x] Each function under 50 lines
- [x] Errors wrapped with specific context
- [x] Command handlers are thin (parse -> delegate -> handle)
- [x] Business logic in `internal/cli/artifact/` (reused existing)
- [x] No duplication - reuses `artifact.PushSkill()` function

---

## Build Verification

```bash
$ go build -o /tmp/stigmer-test ./main.go
Build successful

$ /tmp/stigmer-test skill --help
Manage skill artifacts for AI agents.
...
Available Commands:
  push        Push a skill artifact to the registry

$ /tmp/stigmer-test skill push --help
Push a skill directory as an artifact to the Stigmer registry.
...
Flags:
      --dry-run      validate without pushing
      --org string   organization ID (overrides context)
      --tag string   version tag for the skill (default "latest")

$ /tmp/stigmer-test apply --help
Deploy resources from your Stigmer project.
...
For skill artifacts, use 'stigmer skill push' instead.
```

---

## Design Decisions Documented

### Why Noun-First for Skills

1. **First-Class Resource**: Skills are API resources with lifecycle (CRUD)
2. **Scalability**: Future subcommands fit naturally
3. **Discoverability**: `stigmer skill --help` shows all operations
4. **Industry Standard**: Follows kubectl, docker, gh patterns

### Why Keep Verb-First for Apply/Run/New

1. **Primary Workflows**: Most common operations
2. **Simplicity**: `stigmer apply` easier than `stigmer project deploy`
3. **Precedent**: kubectl uses `kubectl apply`, `kubectl run`

---

## Next Steps

1. Commit these changes with appropriate message
2. Update agent-runner documentation with skill architecture
3. Future: Add `stigmer skill list`, `stigmer skill get`, `stigmer skill delete`

---

**Status**: CLI skill command refactor complete
