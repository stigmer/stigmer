# Fix Skill File Tool Selection Conflict

**Date**: February 15, 2026

## Summary

Fixed a critical tool-selection conflict that prevented agents from reading skill files. The LLM would call `read_file` (deepagents' in-memory tool) instead of `read` (graphton's filesystem tool), causing skill files written to the filesystem to be inaccessible. The solution adds filesystem-backed aliases (`read_file`, `write_file`, `edit_file`) that override deepagents' in-memory tools, ensuring all file operations access the real filesystem regardless of which tool name the LLM chooses.

## Problem Statement

Agents consistently failed to read skill files that were successfully written to the filesystem by `SkillWriter`. The errors showed simple "File not found" messages even though the files existed and were readable via direct backend calls.

### Pain Points

- Skills written by `SkillWriter` to the filesystem were invisible to agents
- `ls` tool worked (showed skill directories) but `read` attempts failed
- Error messages were generic ("File not found") rather than the detailed diagnostics from `FilesystemBackend`
- The issue occurred in both local and Daytona modes
- Four previous fixes (Feb 14-15) addressing path resolution failed to solve the problem

## Solution

The root cause was a **tool selection conflict** between two competing file tool systems:

| Tool Source | Tool Names | Backend | Has Skill Files? |
|-------------|------------|---------|------------------|
| Graphton | `read`, `write`, `edit`, `ls`, `glob`, `grep` | FilesystemBackend (real filesystem) | YES |
| Deepagents | `read_file`, `write_file`, `edit_file` | StateBackend (in-memory) | NO |

When the LLM called `read_file` (deepagents' name), it hit the in-memory backend where skills don't exist. When it called `read` (graphton's name), it hit the filesystem backend where skills do exist.

**Fix**: Register graphton aliases with the same names (`read_file`, `write_file`, `edit_file`) backed by the real filesystem. Since explicit tools take precedence in LangChain's ToolNode resolution, both tool names now route to the filesystem backend.

## Implementation Details

### Phase 1: Diagnostic Logging

Enhanced `_create_read_tool()` in `tool_wrappers.py` to log at `INFO` level with clear "GRAPHTON read tool invoked" messages, making it immediately visible which backend was being used.

### Phase 2: Eliminate Tool Conflict (The Actual Fix)

Added three filesystem-backed aliases in `create_platform_tool_wrappers()`:

```python
# read_file alias -> same filesystem backend as "read"
read_file_alias = _create_read_tool(backend, approval_checker)
read_file_alias.name = "read_file"
tools.append(read_file_alias)

# write_file alias -> same filesystem backend as "write"
write_file_alias = _create_write_tool(backend, approval_checker)
write_file_alias.name = "write_file"
tools.append(write_file_alias)

# edit_file alias -> same filesystem backend as "edit"
edit_file_alias = _create_edit_tool(backend, approval_checker)
edit_file_alias.name = "edit_file"
tools.append(edit_file_alias)
```

Platform tool wrappers now return 10 tools instead of 7:
- 7 primary tools: `read`, `write`, `edit`, `ls`, `glob`, `grep`, `execute`
- 3 aliases: `read_file`, `write_file`, `edit_file`

### Phase 3: Defense-in-Depth for Daytona

Added `lstrip("/")` to `WorkspaceNormalizingBackend._normalize()` so that even absolute paths with leading slashes (e.g., `/bin/skills/...`) are resolved relative to the workspace root, preventing double-prefix bugs in Daytona mode:

```python
def _normalize(self, path: str) -> str:
    # ... existing prefix stripping ...
    # Defense-in-depth: strip leading "/"
    return path.lstrip("/") or "."
```

### Phase 4: Integration Tests

Added `TestToolAliasSkillReads` test class with 6 tests verifying that both `read` and `read_file` tools can read skills written by `SkillWriter` with:
- Relative paths
- Absolute paths
- Leading-slash paths

All tests pass, confirming the fix works for all path formats.

## Benefits

- **100% skill file accessibility**: Skills written by `SkillWriter` are now readable regardless of which tool name the LLM uses
- **No more tool confusion**: Both `read` and `read_file` route to the same filesystem backend
- **Clearer diagnostics**: Enhanced logging immediately shows which tool is being invoked
- **Defense-in-depth**: Additional path normalization in Daytona mode prevents edge cases
- **Regression protection**: Integration tests ensure the fix stays fixed

## Impact

### Immediate Impact

- Agents can now successfully read and activate skills in all execution modes (local, Daytona)
- Skill-based agent workflows unblocked
- `stigmer draft skill` and related commands now work reliably

### Architectural Impact

- Establishes clear pattern for resolving tool naming conflicts between graphton and deepagents
- Documents that explicit tools take precedence over middleware-created tools in LangChain
- Provides precedent for similar conflicts if they arise with other tool categories

### Why Previous Fixes Failed

All four previous fixes (Feb 14-15) addressed **path resolution in backends** rather than **tool selection**. The `FilesystemBackend` path resolution was already correct—it was never invoked because the LLM called the wrong tool. This fix addresses the actual problem: ensuring both tool names route to the correct backend.

## Files Changed

```
backend/libs/python/graphton/src/graphton/core/agent.py                      | 11 +-
backend/libs/python/graphton/src/graphton/core/backends/daytona.py           | 18 ++-
backend/libs/python/graphton/src/graphton/core/tool_wrappers.py              | 45 ++++++-
backend/services/agent-runner/tests/test_integration_skill_pipeline.py       | 149 +++++++++
```

## Related Work

- **Previous path resolution fixes** (Feb 14-15): Chroot-like behavior, workspace-aware SkillWriter, `WorkspaceNormalizingBackend`, progressive disclosure
- **Agent Skills specification**: Progressive disclosure model where agents read skill files on demand
- **SkillWriter implementation**: Writes skills to `bin/skills/{name}/` with proper artifact extraction

---

**Status**: ✅ Production Ready  
**Timeline**: ~3 hours (diagnosis, implementation, testing)
