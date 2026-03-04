# Fix Multi-Local-Path Workspace File Access

**Date**: March 4, 2026

## Summary

Fixed a fundamental design gap where agents could not read, write, or list files when multiple local-path workspace entries were provided via `--workspace` flags. The fix creates symlinks inside the session directory and teaches the `FilesystemBackend` to trust resolved symlink targets through an explicit `allowed_roots` mechanism, making local-path multi-entry behave identically to git multi-entry.

## Problem Statement

The multi-workspace feature was designed with git sources as the primary target. Git entries are cloned into `{session_dir}/{entry_name}/`, creating a directory tree under the sandbox root. Local-path entries were added without equivalent bridging — they returned their absolute host paths as `root_dir`, but nothing placed those paths under the session directory.

### Pain Points

- All file tool calls (`Read`, `Write`, `List`) failed for multi-local-path sessions because the `FilesystemBackend` chroot-like path resolution could never reach paths outside the session directory
- `List(".")` returned only `.stigmer` (1 entry) because the session directory was empty
- Agents fell back to `Execute(cat ...)` as a workaround, bypassing the sandbox security model
- `.gitignore` auto-discovery could not find entries outside the container root
- File trees in the workspace prompt section could not be built for external entries

## Solution

Adopted a symlinks + allowed-roots approach across five layers:

1. **Symlink bridging** (local_path.py): When provisioning in multi-entry mode, create a symlink `{session_dir}/{entry_name} -> host_path` so the directory structure mirrors git multi-entry
2. **Provisioner forwarding** (provisioner.py): Forward `target_subdir` and `backend.root_dir` to the local-path provisioner
3. **Containment extension** (filesystem.py): Add `allowed_roots` parameter to `FilesystemBackend` with path rewriting for absolute host paths and extended containment checks
4. **Config threading** (sandbox_factory.py): Thread `allowed_roots` from config to backend constructor
5. **Root collection** (execute_graphton.py): Collect LOCAL_PATH provision roots and pass as `allowed_roots` in sandbox config

## Implementation Details

### Symlink Creation (local_path.py)

- Added `target_subdir` and `backend_root_dir` parameters to `provision()`
- `_create_entry_symlink()` creates symlinks idempotently — reuses existing symlinks to the same target, replaces stale ones pointing elsewhere
- Symlinks are created inside the session directory (ephemeral, Stigmer-managed), never inside user project directories

### FilesystemBackend (filesystem.py)

- `allowed_roots` accepts either `dict[str, Path]` (entry_name -> host_path) for path rewriting, or `list[Path]` for containment-only
- `_rewrite_allowed_root_path()`: rewrites absolute host paths (e.g. `/Users/dev/repo/file.py`) to entry-relative form (`repo/file.py`) before resolution
- `_is_within_trusted_roots()`: extends containment check to accept paths under `root_dir` OR any allowed root
- `_parse_allowed_roots()`: module-level helper that normalizes both input forms

### Path Resolution Flow

```
Agent calls: Read("/Users/dev/mcp-server-planton/go.mod")
  → _rewrite_allowed_root_path → "mcp-server-planton/go.mod"
  → resolve via root_dir → session_dir/mcp-server-planton/go.mod
  → follows symlink → /Users/dev/mcp-server-planton/go.mod
  → _is_within_trusted_roots → matches allowed_root → PASS
```

## Benefits

- Multi-local-path sessions now work identically to multi-git sessions from the agent's perspective
- Entry-relative paths (`mcp-server-planton/README.md`) work naturally through symlinks
- Absolute host paths (from system prompt) are rewritten transparently
- Sandbox security model is preserved — only explicitly allowed roots are accessible
- Backward compatible — no changes to single-entry or git-only sessions

## Impact

- **Users**: `stigmer draft` and `stigmer run agent` with multiple `--workspace` local paths now work correctly
- **Agents**: File tools (read, write, list, edit) can access all workspace entries without falling back to shell commands
- **Security**: Containment check remains explicit — symlink targets must be in the `allowed_roots` allowlist

## Related Work

- Project 20260304.01: Multi-Source Workspace (introduced the multi-workspace feature)
- Project 20260304.03: Multi-Workspace Agent Polish (T01-T04: tool aliases, relevance, gitignore, prompts)
- T03 known limitation (hierarchical gitignore): local_path entries outside container root now discoverable via symlinks

---

**Status**: Production Ready
**Timeline**: ~2 hours
