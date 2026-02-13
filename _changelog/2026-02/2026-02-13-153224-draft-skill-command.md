# Draft Skill Command with Artifact Lifecycle Integration

**Date**: February 13, 2026

## Summary

Implemented the `stigmer draft skill` command that enables AI-assisted skill creation using the system `skill-creator-agent`. The command leverages the recently completed artifact lifecycle infrastructure to accept input files via `--attach` flags and automatically download generated skill artifacts. This provides a seamless user experience for creating new SKILL.md files without manual agent invocation or artifact handling.

## Problem Statement

Users need an intuitive way to create skills using the skill-creator-agent without understanding the underlying agent execution and artifact management complexities. The raw workflow required:
1. Manually invoking `stigmer run agent skill-creator-agent`
2. Managing file attachments
3. Waiting for completion
4. Downloading artifacts manually

### Pain Points

- No dedicated command for skill creation
- Users must understand agent execution internals
- Manual artifact management is error-prone
- No clear workflow for providing context files
- Bootstrap organization mismatch (seedpack referenced wrong org)

## Solution

Created a thin wrapper command `stigmer draft skill` that:
- Automatically resolves the system `skill-creator-agent` from the `local` org (created by bootstrap)
- Reuses existing artifact lifecycle infrastructure (`AttachmentProcessor`, `waitForExecution()`, `downloadArtifacts()`)
- Provides an ergonomic CLI interface with `--attach`, `--output`, and `--follow` flags
- Always waits for completion and downloads results (draft commands are synchronous by design)

## Implementation Details

### Files Created

1. **draft.go** - Draft command group with extensible structure for future resource types
2. **draft_skill.go** - Draft skill subcommand with flags and validation
3. **draft_skill_handler.go** - Handler that delegates to existing `runAgent()` infrastructure

### Key Design Decisions

**Thin Wrapper Pattern**: Draft command is not a separate execution path - it's a convenience layer that configures and invokes existing agent execution infrastructure with sensible defaults.

**Organization Fix**: Discovered and fixed inconsistency in seedpack where `skill-creator-agent.yaml` referenced `org: stigmer` but bootstrap creates agents in `org: local`. Updated to match bootstrap behavior.

**Zero Duplication**: Reused 100% of existing infrastructure:
- `connectToBackend()` - Connection handling
- `resolveAgent()` - Agent resolution
- `AttachmentProcessor` - File upload with 4MB threshold
- `createAgentExecution()` - Execution creation
- `waitForExecution()` - Polling with exponential backoff
- `downloadArtifacts()` - Artifact download with URL refresh

### Command Interface

```bash
# Basic usage
stigmer draft skill -m "Create a skill for validating Kubernetes manifests"

# With context files
stigmer draft skill --attach ./example.md --attach ./requirements.md -m "Create X"

# Custom output directory
stigmer draft skill -m "Create X" --output ./my-skill/

# Stream logs during creation
stigmer draft skill -m "Create X" --follow
```

### Integration Points

- **Bootstrap**: Depends on `skill-creator-agent` being created during server bootstrap
- **Artifact Lifecycle**: Uses upload/download infrastructure from artifact lifecycle project
- **Agent Execution**: Standard agent execution flow with attachments

## Benefits

### User Experience
- Single command replaces multi-step manual process
- Intuitive CLI interface with clear flags
- Automatic artifact handling (no manual download)
- Helpful error messages if bootstrap incomplete

### Code Quality
- Zero code duplication (100% reuse)
- Follows existing CLI patterns
- Type-safe with proper error handling
- Clean separation of concerns

### Developer Experience
- Extensible pattern for future draft commands (agent, workflow, mcpserver)
- Self-documenting with comprehensive help text
- Easy to test (thin wrapper over tested components)

## Impact

### Users
- Skill creation workflow reduced from 5+ steps to 1 command
- Context files can be easily provided via `--attach`
- Generated skills automatically saved to desired location

### System
- First implementation of draft command pattern (extensible to other resources)
- Validates that artifact lifecycle infrastructure is production-ready
- Demonstrates clean integration between seedpack bootstrap and CLI

### Codebase
- Adds ~400 lines of focused, well-documented code
- Maintains consistency with existing CLI patterns
- Sets precedent for future AI-assisted creation commands

## Related Work

- **Seedpack Bootstrap** (`_projects/2026-02/20260207.03.cli-platform-capabilities`): Provides the `skill-creator-agent`
- **Artifact Lifecycle** (`_projects/2026-02/20260213.01.agent-artifact-lifecycle`): Provides attachment and download infrastructure
- **CLI Type System**: Follows established verb-first patterns

## Future Extensions

This pattern enables future draft commands:
- `stigmer draft agent` - AI-assisted agent YAML creation
- `stigmer draft workflow` - AI-assisted workflow YAML creation
- `stigmer draft mcpserver` - AI-assisted MCP server configuration

Each requires:
1. A drafter skill (created by skill-creator-agent)
2. A drafter agent (uses the skill)
3. CLI command wiring (following this pattern)

---

**Status**: ✅ Production Ready  
**Timeline**: Single session implementation  
**Lines Added**: ~400 (3 new files)  
**Files Modified**: 3 (root.go, next-task.md, skill-creator-agent.yaml)
