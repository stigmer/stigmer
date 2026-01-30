# Phase 5.6 Platform Tool Approval - Fix Plan

## Context

This document provides context for fixing issues found in the Phase 5.6 implementation of platform tool approval defaults.

## What Was Implemented

Phase 5.6 added hardcoded approval defaults for sandbox/platform tools so that dangerous operations (write, edit, execute) require approval by default, while safe operations (read, ls, glob, grep) auto-approve.

### Files Modified

1. **`backend/services/agent-runner/worker/activities/graphton/approval_policy.py`**
   - Added `PLATFORM_TOOL_DEFAULTS` constant with 7 tools
   - Added `PLATFORM_SERVER_NAME = "__platform__"` constant
   - Added `is_platform_tool()` and `get_platform_tool_names()` helpers
   - Extended `resolve_tool_approval()` with platform_default priority (4th level)
   - Added `mcp_server` field to `ApprovalRequirement` dataclass

2. **`backend/libs/python/graphton/src/graphton/core/tool_wrappers.py`**
   - Added `create_platform_tool_wrappers()` function
   - Added `_handle_approval_check()` helper
   - Added `_create_read_tool()`, `_create_write_tool()`, `_create_execute_tool()`

3. **`backend/libs/python/graphton/src/graphton/core/agent.py`**
   - Modified `create_deep_agent()` to use platform tool wrappers when `approval_checker` provided
   - When both `approval_checker` AND `sandbox_config` provided:
     - Creates approval-aware platform tool wrappers
     - Adds them to `tools_list`
     - Passes `backend=None` to deepagents (to prevent duplicate tools)

4. **`backend/services/agent-runner/tests/test_status_builder.py`**
   - Added `TestPlatformToolApprovalDefaults` class (10 tests)

### Current Platform Tool Defaults

```python
PLATFORM_TOOL_DEFAULTS = {
    # Safe tools - no approval needed
    "read": {"requires_approval": False},
    "ls": {"requires_approval": False},
    "glob": {"requires_approval": False},
    "grep": {"requires_approval": False},
    
    # Dangerous tools - require approval by default
    "write": {"requires_approval": True, "message": "Write file: {{args.path}}"},
    "edit": {"requires_approval": True, "message": "Edit file: {{args.path}}"},
    "execute": {"requires_approval": True, "message": "Execute command: {{args.command}}"},
}
```

### Current Policy Chain

```
1. auto_approve_all = true     → No approval (bypasses everything)
2. agent_override              → Per-agent MCP tool overrides
3. mcp_default                 → MCP server default policies
4. platform_default (NEW)      → Hardcoded defaults for sandbox tools
5. none                        → No approval required
```

---

## Critical Issues Found

### Issue 1: Incomplete Platform Tool Coverage (CRITICAL)

I defined 7 tools in `PLATFORM_TOOL_DEFAULTS` but only created wrappers for 3:

| Tool | Defined | Wrapper Created | Backend Support |
|------|---------|-----------------|-----------------|
| read | ✅ | ✅ | ✅ `backend.read()` |
| write | ✅ | ✅ | ✅ `backend.write()` |
| execute | ✅ | ✅ | ✅ `backend.execute()` |
| edit | ✅ | ❌ **MISSING** | ❌ No method |
| ls | ✅ | ❌ **MISSING** | ⚠️ Has `list_files()` |
| glob | ✅ | ❌ **MISSING** | ❌ No method |
| grep | ✅ | ❌ **MISSING** | ❌ No method |

**Impact**: By passing `backend=None` to deepagents when `approval_checker` is provided, users **lose access to edit, ls, glob, grep** tools entirely.

### Issue 2: Backend Methods Available

Looking at `backend/libs/python/graphton/src/graphton/core/backends/filesystem.py`:

```python
class FilesystemBackend:
    def read(self, path: str) -> str           # ✅ Available
    def write(self, path: str, content: str)   # ✅ Available
    def execute(self, command: str, ...)       # ✅ Available
    def list_files(self, path: str = ".")      # ⚠️ Could be used for ls
    # edit, glob, grep - NOT available
```

**Question**: Where do edit, glob, grep come from? deepagents must provide them internally.

### Issue 3: Code Duplication

The approval checking logic in `_handle_approval_check()` duplicates the same logic in `create_approval_aware_tool_wrapper()` (for MCP tools). This violates DRY.

### Issue 4: Missing Tests for Tool Wrappers

Only tested policy resolution. Did NOT test:
- `create_platform_tool_wrappers()` function
- Individual tool wrappers (read, write, execute)
- Integration with LangGraph interrupt/resume
- Error handling paths

### Issue 5: Misleading Documentation

The docstring for `create_platform_tool_wrappers()` says it creates "read, write, execute" but `PLATFORM_TOOL_DEFAULTS` suggests there should be 7 tools.

---

## Fix Plan

### Phase 1: Investigate deepagents Tool Creation (~30 min)
- [ ] Determine exactly what tools deepagents creates from a backend
- [ ] Document the tool names and signatures
- [ ] Decide approach based on findings

### Phase 2: Fix the Tool Coverage (~1.5 hours)

**Option A (Recommended)**: Implement wrappers for all tools that require approval
- Implement `_create_edit_tool()` - edit files (dangerous, needs approval)
- Let deepagents handle ls, glob, grep (safe, no approval needed)
- Update `create_platform_tool_wrappers()` to only add tools we wrap
- Pass `backend` to deepagents so it can create ls, glob, grep

**Option B**: Implement all 7 wrappers
- Requires implementing edit, ls, glob, grep ourselves
- Most control but most work

**Option C**: Hybrid - let deepagents create tools, post-process to add approval
- Complex but preserves all functionality

### Phase 3: Refactor to Eliminate Duplication (~45 min)
- [ ] Extract shared approval logic into a reusable helper that both MCP and platform tools use
- [ ] Ensure consistent behavior across tool types

### Phase 4: Add Comprehensive Tests (~1 hour)
- [ ] Unit tests for `create_platform_tool_wrappers()`
- [ ] Unit tests for each tool wrapper
- [ ] Integration tests with mock backend
- [ ] Tests for error handling paths

### Phase 5: Documentation and Cleanup (~30 min)
- [ ] Fix docstrings to match actual behavior
- [ ] Update project documentation
- [ ] Add inline comments explaining design decisions

---

## Key Files to Reference

### Policy Resolution
- `backend/services/agent-runner/worker/activities/graphton/approval_policy.py`
  - Lines 44-102: `PLATFORM_TOOL_DEFAULTS`, `is_platform_tool()`, `get_platform_tool_names()`
  - Lines 267-283: `ApprovalRequirement` dataclass (now has `mcp_server` field)
  - Lines 287-447: `resolve_tool_approval()` with platform_default priority

### Tool Wrappers
- `backend/libs/python/graphton/src/graphton/core/tool_wrappers.py`
  - Lines 618-865: Platform tool wrapper creation functions

### Agent Creation
- `backend/libs/python/graphton/src/graphton/core/agent.py`
  - Lines 448-476: Platform tool wrapper integration in `create_deep_agent()`

### Backend
- `backend/libs/python/graphton/src/graphton/core/backends/filesystem.py`
  - Full file: Shows available backend methods

### Tests
- `backend/services/agent-runner/tests/test_status_builder.py`
  - `TestPlatformToolApprovalDefaults` class: 10 tests for policy resolution

---

## Quality Standards

Remember these are critical components of a world-class platform:

1. **No code duplication** - Extract shared logic into reusable helpers
2. **Complete implementation** - Don't leave gaps that break functionality
3. **Comprehensive tests** - Unit tests, integration tests, error handling
4. **Clear documentation** - Docstrings must match actual behavior
5. **Consistent patterns** - Follow existing code patterns in the codebase
6. **No regressions** - Ensure all existing functionality still works

---

## Commands to Run Tests

```bash
# Run platform tool approval tests
cd /Users/suresh/scm/github.com/stigmer/stigmer/backend/services/agent-runner
poetry run pytest tests/test_status_builder.py::TestPlatformToolApprovalDefaults -v

# Run all approval policy tests
poetry run pytest tests/test_status_builder.py::TestApprovalPolicyResolution -v
poetry run pytest tests/test_status_builder.py::TestPlatformToolApprovalDefaults -v
```

---

## Next Steps

1. Start new conversation with this document
2. Investigate what deepagents actually creates from backend
3. Choose and implement the fix approach
4. Add comprehensive tests
5. Update documentation
