# AD-01: Virtual Platform Mount — Zero-Pollution Filesystem Isolation

**Date**: 2026-02-28
**Revised**: 2026-02-28 (v3 — virtual mount, zero pollution)
**Status**: Proposed (pending plan review)
**Context**: Phase 4 of workspace-provisioning — platform-file isolation
**Research**: `research.session-root-filesystem-isolation/04.report.gpt.md`

## Decision

Platform files (skills, inputs) are physically stored in an external `platform_dir` that is completely separate from the workspace `root_dir`. The backend's path resolution layer presents them under a virtual `.stigmer/` prefix — the agent sees them as if they're in the workspace, but they physically live elsewhere. **The user's project directory is never modified.**

Shell access to platform files is provided via the `$STIGMER_PLATFORM_DIR` environment variable, injected into every `execute()` call.

This follows the same pattern as Cursor and Windsurf, which act as a view layer between the agent and the filesystem — the tool layer serves content from wherever it physically lives, transparently.

## Evolution of This Decision

This decision went through three iterations:

### v1: Symlink bridge + `normpath` containment
- `.stigmer` symlink in workspace pointing to external platform dir
- Traversal guard changed to `normpath` (string-only, no symlink following)
- **Rejected**: Deep research identified `normpath` as a security vulnerability — agent-created symlinks bypass it

### v2: Symlink bridge + `resolve()` with allowlisted roots
- `.stigmer` symlink in workspace pointing to external platform dir
- Traversal guard keeps `resolve()` but adds allowlist of permitted roots
- **Rejected by user**: Still modifies user's project directory (symlink + `.git/info/exclude`). For `local_path` sources, any modification is pollution.

### v3: Virtual platform mount (selected)
- No symlink, no modification to user's directory
- Backend routes `.stigmer/*` paths to external `platform_dir` at the path-resolution layer
- Shell access via `$STIGMER_PLATFORM_DIR` env var
- **Selected**: True zero pollution for all source types

## Alternatives Considered

| Option | Fatal Flaw |
|--------|-----------|
| A. Session-root container | Agent can't reach platform files (`../` blocked) |
| B. Expanded backend scope | CWD vs root_dir mismatch |
| C-v1. Symlink + normpath | Security vulnerability (agent-created symlink escape) |
| C-v2. Symlink + allowlisted roots | Still pollutes user's project directory |
| D. Dual-scope backend | Over-engineered protocol change |
| E. FUSE overlay | Heavy dependency, macOS impractical |
| **F. Virtual platform mount** | **Selected** |

## Consequences

### Positive
- **Zero pollution**: user's project directory is never modified by the platform, regardless of source type
- **Clean separation**: workspace (user's code) and platform (skills, inputs) never share a directory
- **No traversal guard relaxation**: both scopes use `resolve()` with containment — existing security model preserved
- **Backward compatible**: backends without `platform_dir` behave identically to before
- **Follows industry pattern**: same approach as Cursor/Windsurf (tool layer as view layer)

### Trade-offs
- **Shell access requires env var**: `cat .stigmer/skills/SKILL.md` doesn't work via shell; agent uses `cat $STIGMER_PLATFORM_DIR/skills/SKILL.md` or (preferably) the `read` tool
- **`list_files(".")` must merge**: root directory listing needs to inject the virtual `.stigmer` entry alongside real workspace entries
- **Four backend implementations**: LocalWorkspaceBackend, DaytonaWorkspaceBackend, FilesystemBackend, WorkspaceNormalizingBackend all need the virtual mount rule

### Mitigations for shell access trade-off
- Agent primarily reads skills via `read()` tool (the normal activation path documented in Agent Skills spec)
- System prompt instructs agent to use `read` for platform files and `$STIGMER_PLATFORM_DIR` for shell execution of skill scripts
- Skill scripts are the exception, not the rule — most skills are SKILL.md instruction files only
