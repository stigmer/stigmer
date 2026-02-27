# Virtual Platform Mount — Zero-Pollution Filesystem Isolation

**Date**: February 28, 2026

## Summary

Implemented the virtual platform mount (AD-01 v3) that physically isolates platform files (skills, inputs) outside the user's workspace directory. The backend's path resolution layer routes `.stigmer/*` paths to an external platform directory while the workspace remains completely unmodified. This eliminates the previous approach of writing platform files directly into the workspace and then excluding them via git pathspecs.

## Problem Statement

When Stigmer provisions a workspace for agent execution, it writes platform files (skills, input attachments) alongside the user's project files. For `local_path` workspace sources — where the workspace root *is* the user's actual project directory — this pollutes the project with platform artifacts.

### Pain Points

- `bin/skills/` and `.stigmer-inputs/` directories appeared in the user's project
- Required `.git/info/exclude` manipulation to hide platform files from git
- Required `git diff` pathspec exclusions (`':!.stigmer-inputs' ':!bin/skills'`) to generate clean patches
- The user's `ls`, tree views, and IDE file explorers showed platform noise
- For `local_path` sources, this was a direct modification of files the user owns

## Solution

A virtual mount at the path-resolution layer. Both backend layers (`WorkspaceBackend` for pre-agent setup, `FilesystemBackend` for agent runtime) intercept paths starting with `.stigmer/` and resolve them against an external `platform_dir` instead of the workspace root. The agent sees `.stigmer/skills/`, `.stigmer/inputs/` as if they're in the workspace, but files physically live in `~/.stigmer/sessions/{session_id}/platform/`.

## Implementation Details

### Shared path classifier (DRY)
A pure function `classify_platform_path(rel_path) → (is_platform, remainder)` centralizes the routing decision. Two copies exist (agent-runner and graphton packages can't share imports) with identical logic. Constants `PLATFORM_PREFIX`, `PLATFORM_DIR_NAME`, and `STIGMER_PLATFORM_DIR_ENV` are co-located.

### WorkspaceInitResult dataclass
Replaced the fragile `tuple[WorkspaceBackend, Any | None, bool]` return from `initialize_workspace()` with a frozen dataclass. Named fields (`backend`, `sandbox`, `is_new_sandbox`, `platform_dir`) are self-documenting and extensible.

### Path migration
All platform paths unified under the `.stigmer/` namespace:
- `bin/skills/{name}/` → `.stigmer/skills/{name}/`
- `.stigmer-inputs/{filename}` → `.stigmer/inputs/{filename}`

### Containment enforcement
Both scopes (workspace and platform) have independent containment checks via `Path.resolve()` + prefix comparison. Traversal from one scope into the other is blocked.

### Environment variable injection
When `platform_dir` is set, `$STIGMER_PLATFORM_DIR` is injected into `execute()` calls so shell commands can access platform files at their physical location.

### Conditional backward compatibility
When `platform_dir` is `None` (no session_id, feature gated, or cloud mode), all behavior is identical to before. Git excludes and diff pathspecs are conditionally applied.

### Bug fix
Discovered and fixed a pre-existing bug in `_make_scripts_executable` where `find -name '*.sh' -name '*.py'` (AND — never matches) should be `find -name '*.sh' -o -name '*.py'` (OR).

## Benefits

- **Zero pollution**: `local_path` workspaces have absolutely no platform modifications
- **Clean git**: No `git diff` pathspec exclusions needed when virtual mount is active
- **No git exclude hacks**: `.git/info/exclude` manipulation skipped entirely
- **Unified namespace**: All platform files under `.stigmer/` — clean, discoverable, consistent
- **Shell access**: `$STIGMER_PLATFORM_DIR` gives scripts direct access to platform files
- **Backward compatible**: Feature is structurally gated by `platform_dir` presence
- **114 new tests**: Comprehensive coverage of path routing, containment, env vars, backward compat

## Impact

- **Agent-runner**: 15 files modified, 3 new files, workspace initialization and all pre-agent setup
- **Graphton**: 2 files modified, 1 new file, agent-runtime file operations
- **Test coverage**: 114 new tests; 786 existing agent-runner tests pass, 550 existing graphton tests pass
- **Cloud mode**: Confirmed as no-op — Daytona sandboxes use physical `.stigmer/` dirs (disposable containers, no pollution concern)

## Related Work

- **Parent project**: 20260227.02.workspace-provisioning (T04 spawned this sub-project)
- **Design decision**: AD-01 v3 (evolved from symlink bridge v1/v2 to virtual mount)
- **Research**: Session root filesystem isolation report (`04.report.gpt.md`, `04.report.gemini.md`)

---

**Status**: Production Ready
**Timeline**: Single session (~2 hours)
