# Task T01: Clickable File Paths — Analysis & Implementation Plan

**Created**: 2026-03-06
**Status**: PENDING REVIEW
**Type**: Feature Development

> **This plan requires your review before execution.**

## Problem Statement

File paths in compact tool output (`● Read(path)`, `● Write(path)`, etc.) should be clickable OSC 8 hyperlinks that open the file on the user's machine. The escape sequence infrastructure exists in `pkg/toolrender/hyperlink.go` and works, but the **path resolver** cannot map two major categories of paths to local filesystem locations:

1. **`.stigmer/` prefix paths** — e.g., `.stigmer/skills/mcp-server-creator/SKILL.md`. These are a **virtual mount**: the agent's backend intercepts the `.stigmer/` prefix and redirects to the session's platform directory (`~/.stigmer/sessions/<session-id>/platform/`). The `.stigmer/` directory does **not** exist on disk inside the sandbox root.

2. **Git workspace paths** — When `--workspace https://github.com/org/repo` is used, `localWorkspaceRoots()` skips `GitRepoSource` entries entirely, producing `workspaceRoots == nil`. But the git clone **does** exist at `~/.stigmer/data/workspace/sessions/<session-id>/<workspace-name>/`.

## Architecture: How Session Workspaces Work

Each agent session has **two** directories:

```
~/.stigmer/data/workspace/sessions/<session-id>/   ← Sandbox Root
├── mcp-server-planton → /Users/.../mcp-server-planton  (symlink, local workspace)
├── agent-fleet → /Users/.../agent-fleet                 (symlink, local workspace)
└── some-git-repo/                                       (git clone, git workspace)
    └── README.md

~/.stigmer/sessions/<session-id>/platform/         ← Platform Dir
└── skills/
    └── mcp-server-creator/
        └── SKILL.md
```

**Path mapping in the agent:**
| Agent path | Actual filesystem path |
|------------|------------------------|
| `mcp-server-planton/README.md` | `{sandbox_root}/mcp-server-planton/README.md` → via symlink → user's local path |
| `.stigmer/skills/mcp-server-creator/SKILL.md` | `{platform_dir}/skills/mcp-server-creator/SKILL.md` |
| `some-git-repo/main.go` | `{sandbox_root}/some-git-repo/main.go` (git clone) |

The **sandbox root** is set up by `daemon_process.go:buildAgentRunnerEnv()`:
- `SANDBOX_ROOT_DIR` = `~/.stigmer/data/workspace`
- Per-session: `{SANDBOX_ROOT_DIR}/sessions/{session_id}/`

The **platform dir** is computed by the agent-runner:
- `~/.stigmer/sessions/{session_id}/platform/`

## Root Cause Analysis

### 1. No session-aware path resolution

The CLI's `resolveWorkspacePath` only knows about `WorkspaceRoots` (user's local workspace paths from `localWorkspaceRoots()`). It has no concept of:
- The sandbox root (where all agent files actually live)
- The platform dir (where `.stigmer/` virtual-mount files live)

### 2. `localWorkspaceRoots()` skips git entries

```go
// run.go:23-33 — Only LocalPathSource contributes; GitRepoSource skipped
func localWorkspaceRoots(entries []*sessionv1.WorkspaceEntry) []string {
    for _, entry := range entries {
        if lp := entry.GetSource().GetLocalPath(); lp != nil { // ← git entries skipped
```

For local-only sessions with basename matching, this accidentally works. But for git workspaces, or when the stat-probe can't find a `.stigmer` dir inside workspace roots, it fails.

### 3. `.stigmer/` is a virtual mount, not a real directory

The agent intercepts `.stigmer/` paths via `platform_mount.py` and redirects to the platform dir. The CLI resolver tries to find `.stigmer/` as a real subdirectory under workspace roots — it doesn't exist.

## Design: Session-Aware Path Resolution

Add two new fields to `CompactOptions` alongside existing `WorkspaceRoots`:

```go
type CompactOptions struct {
    HyperlinksEnabled bool
    WorkspaceRoots    []string // existing: user's local workspace paths
    SandboxRoot       string   // NEW: ~/.stigmer/data/workspace/sessions/<session-id>/
    PlatformDir       string   // NEW: ~/.stigmer/sessions/<session-id>/platform/
    StatFunc          func(string) (os.FileInfo, error)
}
```

**Resolution order in `resolveWorkspacePath`:**

```
1. Absolute path?           → use directly (existing)
2. .stigmer/ prefix?        → strip prefix, join with PlatformDir, stat-probe
3. Workspace roots (local)  → basename-match + stat-probe (existing)
4. Sandbox root?            → join directly, stat-probe (follows symlinks)
5. Not resolved             → plain text (graceful degradation)
```

Layer 2 handles the virtual mount. Layer 4 is the universal fallback that covers git clones, symlinked local paths, and any other files in the sandbox. Layer 3 is preserved because it resolves to the user's **real** local path (not the symlink path), which is slightly better for `file://` URIs.

## Implementation Plan

### Phase 1: Wire session paths to CompactOptions

**Files to modify:**
- `client-apps/cli/pkg/toolrender/render_compact.go` — Add `SandboxRoot` and `PlatformDir` to `CompactOptions`
- `client-apps/cli/cmd/stigmer/root/run_stream_inline.go` — Populate new fields when constructing `CompactOptions`
- `client-apps/cli/cmd/stigmer/root/run_stream_inline_types.go` — Add fields to `inlineRenderConfig`
- `client-apps/cli/cmd/stigmer/root/run_stream.go` — Thread session ID through
- `client-apps/cli/cmd/stigmer/root/run_session.go` — Compute sandbox root + platform dir from session ID

**Path computation:**
```go
func sessionPaths(sessionID string) (sandboxRoot, platformDir string) {
    configDir, _ := config.GetConfigDir() // ~/.stigmer
    dataDir := filepath.Join(configDir, config.DefaultDataDir) // ~/.stigmer/data
    sandboxRoot = filepath.Join(dataDir, "workspace", "sessions", sessionID)
    platformDir = filepath.Join(configDir, "sessions", sessionID, "platform")
    return
}
```

### Phase 2: Extend `resolveWorkspacePath` with new resolution layers

**File to modify:**
- `client-apps/cli/pkg/toolrender/render_compact.go`

**Changes to `resolveWorkspacePath`:**
1. Add `.stigmer/` prefix check: strip prefix, join with `PlatformDir`, stat-probe
2. Add sandbox root fallback: join directly, stat-probe

```go
func resolveWorkspacePath(relPath string, opts CompactOptions) string {
    // Existing: workspace roots (basename match + stat-probe)
    if resolved := resolveAgainstWorkspaceRoots(relPath, opts.WorkspaceRoots, opts.StatFunc); resolved != "" {
        return resolved
    }

    // NEW: .stigmer/ virtual mount → platform dir
    if opts.PlatformDir != "" && strings.HasPrefix(filepath.ToSlash(relPath), ".stigmer/") {
        remainder := relPath[len(".stigmer/"):]
        candidate := filepath.Join(opts.PlatformDir, remainder)
        if statCheck(candidate, opts.StatFunc) {
            return candidate
        }
    }

    // NEW: sandbox root fallback (git clones + symlinked local paths)
    if opts.SandboxRoot != "" {
        candidate := filepath.Join(opts.SandboxRoot, relPath)
        if statCheck(candidate, opts.StatFunc) {
            return candidate
        }
    }

    return ""
}
```

### Phase 3: Add tests

**File to modify/create:**
- `client-apps/cli/pkg/toolrender/render_compact_test.go` — New test cases

**Test cases:**
1. `.stigmer/skills/my-skill/SKILL.md` with `PlatformDir` set → resolves to platform dir path
2. `.stigmer/skills/nonexistent` → graceful degradation (plain text)
3. `repo-name/README.md` with git workspace (no local roots, sandbox root set) → resolves via sandbox root
4. `repo-name/README.md` with local workspace roots → still resolves via basename match (existing behavior preserved)
5. Absolute path → unchanged (existing)
6. Unresolvable relative path → plain text (existing)

### Phase 4: Verification

1. Manual test with local workspace session: file paths clickable ✓
2. Manual test with `.stigmer/skills/...` path: clickable, opens platform dir file ✓
3. Manual test with git workspace: clickable, opens sandbox clone ✓
4. Verify BubbleTea `tea.Println` passes OSC 8 sequences (iTerm2/Ghostty/WezTerm)
5. Verify `HyperlinksEnabled` returns `true` (add `--verbose` debug line)
6. Test re-commit (Ctrl+O) preserves hyperlinks in redrawn scrollback

## Files Touched (Summary)

| File | Phase | Change |
|------|-------|--------|
| `pkg/toolrender/render_compact.go` | 1, 2 | Add `SandboxRoot`, `PlatformDir` to `CompactOptions`; extend `resolveWorkspacePath` |
| `cmd/stigmer/root/run_stream_inline.go` | 1 | Populate new `CompactOptions` fields |
| `cmd/stigmer/root/run_stream_inline_types.go` | 1 | Add `sandboxRoot`, `platformDir` to `inlineRenderConfig` |
| `cmd/stigmer/root/run_stream.go` | 1 | Thread session ID through to inline renderer |
| `cmd/stigmer/root/run_session.go` | 1 | Compute session paths from session ID |
| `cmd/stigmer/root/run.go` | 1 | Add `sessionPaths` helper |
| `pkg/toolrender/render_compact_test.go` | 3 | New test cases for `.stigmer/` and sandbox root resolution |

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| BubbleTea strips OSC 8 sequences | Manual verification in Phase 4; BubbleTea raw mode should pass through |
| Platform dir doesn't exist yet (session still starting) | Stat-probe will fail, graceful degradation to plain text |
| Sandbox root contains symlinks (local workspaces) | `os.Stat` follows symlinks; `file://` URIs with symlink path still open correctly |
| Session ID not available in all render paths | Falls back to existing `WorkspaceRoots` behavior when `SandboxRoot`/`PlatformDir` are empty |

## Success Criteria

1. `● Read(.stigmer/skills/mcp-server-creator/SKILL.md)` → clickable, opens `~/.stigmer/sessions/<id>/platform/skills/mcp-server-creator/SKILL.md`
2. `● Read(mcp-server-planton/README.md)` with local workspace → clickable (preserves existing behavior via workspace roots)
3. `● Read(mcp-server-planton/README.md)` with git workspace → clickable, opens `~/.stigmer/data/workspace/sessions/<id>/mcp-server-planton/README.md`
4. Unresolvable paths remain plain text (no broken `file://` URIs)
5. `STIGMER_HYPERLINKS=off` disables all links (existing behavior preserved)

## Next Task Preview

**T02: Implementation** — Wire session paths through to `CompactOptions` and extend `resolveWorkspacePath`.

---

**Please review this plan.** Once approved, I'll proceed with implementation.
