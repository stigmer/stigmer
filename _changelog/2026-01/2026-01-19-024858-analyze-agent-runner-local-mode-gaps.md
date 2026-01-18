# Analyze Agent Runner Local Mode Functionality Gaps

**Date**: 2026-01-19 02:48:58  
**Type**: Analysis & Documentation  
**Scope**: Agent Runner Local Mode  
**Related Project**: `_projects/2026-01/20260119.01.agent-runner-local-mode/`

## Summary

Conducted comprehensive analysis of agent-runner local mode implementation to identify functionality gaps compared to cloud mode. Identified that skills were the **only** feature explicitly disabled in local mode. Created detailed documentation of findings for future reference.

## Context

The agent-runner supports two execution modes:
- **Cloud Mode (`MODE=cloud`)**: Uses Daytona sandboxes, full cloud infrastructure
- **Local Mode (`MODE=local`)**: Uses filesystem backend for local development

This analysis was requested to identify any functionalities being skipped or disabled specifically in local mode.

## Analysis Performed

### 1. Code Review

Analyzed `backend/services/agent-runner/worker/activities/execute_graphton.py` (537 lines) to identify mode-specific conditional logic:

**Mode-Aware Code Sections**:
- Lines 178-220: Sandbox management (filesystem vs Daytona)
- Lines 226-271: Skills handling (cloud vs local) ⚠️ **Skills disabled in local mode**
- Lines 271-323: Environment merging (no mode restrictions) ✅
- Lines 324-361: Graphton agent creation (mode-aware, both functional) ✅
- Lines 390-435: Execution streaming (identical in both modes) ✅

### 2. Skills Functionality Gap

**Finding**: Skills were explicitly disabled in local mode with this logic:

```python
# Line 226-269 (OLD)
if skill_refs and not worker_config.is_local_mode():
    # Skills only supported in cloud mode with Daytona sandbox
    # In local mode, skills would need to be written to local filesystem
    # This will be implemented in a future iteration
    ...
elif skill_refs and worker_config.is_local_mode():
    activity_logger.warning(
        f"Skills not yet supported in local mode - skipping {len(skill_refs)} skill(s)"
    )
```

**Why Disabled**: SkillWriter only supported Daytona sandbox uploads, not filesystem writes.

**Impact**: Agent executions in local mode skip configured skills, limiting local development and testing.

### 3. Other Functionalities Review

**✅ Fully Supported in Both Modes**:
1. **Environments** - Agent base environments, environment reference merging, runtime overrides (no mode restrictions)
2. **Sandbox Management** - Mode-aware, both fully functional (filesystem vs Daytona)
3. **Graphton Agent Creation** - Works with both backends
4. **Execution Streaming** - LangGraph event streaming, status building, identical behavior

**⏳ Not Yet Implemented** (not mode-specific):
1. **MCP Servers** - `mcp_servers={}` (line 354) - not implemented in either mode
2. **Sub-agents** - `subagents=None` (line 356) - not implemented in either mode

**Conclusion**: Skills were the **only** functionality being skipped specifically in local mode. Everything else either works in both modes or isn't implemented yet.

## Documentation Created

### SKILLS_LOCAL_MODE_IMPLEMENTATION.md

Created comprehensive documentation file analyzing skills support:

**Contents**:
- Problem statement (skills disabled in local mode)
- Analysis of SkillWriter architecture
- Behavior comparison (local vs cloud)
- Complete functionality review
- Testing guidance
- Security considerations

**Location**: `_projects/2026-01/20260119.01.agent-runner-local-mode/SKILLS_LOCAL_MODE_IMPLEMENTATION.md`

**Purpose**: Reference document for future implementation of skills in local mode.

### Updated Project Notes

Added section T2.1 to `notes.md`:
- Detailed technical notes on skills gap
- Analysis findings
- Documentation created
- Rationale for current state

## Implementation Status

**Skills in Local Mode**: Remains disabled (Daytona-only)
- Analysis identified the gap and documented approach
- Implementation deferred (user decision)
- Skills continue to work in cloud mode (existing behavior preserved)

## Files Changed

**Created**:
- `_projects/2026-01/20260119.01.agent-runner-local-mode/SKILLS_LOCAL_MODE_IMPLEMENTATION.md`

**Modified**:
- `_projects/2026-01/20260119.01.agent-runner-local-mode/notes.md`

## Impact

**Immediate**:
- Clear understanding of local mode functionality gaps
- Documented approach for future skills implementation
- No code changes (analysis only)

**Future**:
- Documentation serves as blueprint for enabling skills in local mode
- Analysis confirms no other functionality gaps exist

## Testing

No testing required - analysis and documentation only.

## Next Steps

**For Local Mode Skills Support** (future):
1. Enhance SkillWriter to support filesystem backend
2. Write skills to `{SANDBOX_ROOT_DIR}/skills/*.md` in local mode
3. Test skill accessibility in filesystem sandboxes
4. Verify agent can read skills using `read_file` tool

**Current Focus**: T3 - Update Agent Runner main to connect to Stigmer Daemon gRPC

## Learnings

1. **Comprehensive Analysis**: Reviewing entire execution flow (537 lines) confirmed only one functionality gap
2. **Documentation Value**: Detailed analysis documents serve as blueprints for future implementation
3. **Mode Awareness**: Understanding mode-specific logic helps identify gaps systematically
4. **Skills Architecture**: SkillWriter is tightly coupled to Daytona SDK - abstraction needed for multi-backend support

## Related

- **Project**: `_projects/2026-01/20260119.01.agent-runner-local-mode/`
- **ADR**: `docs/adr/20260119-011111-workflow-runner-config.md` (MODE vs ENV distinction)
- **Config**: `backend/services/agent-runner/worker/config.py` (T2 implementation)
- **Graphton**: FilesystemBackend implementation (T1 implementation)
