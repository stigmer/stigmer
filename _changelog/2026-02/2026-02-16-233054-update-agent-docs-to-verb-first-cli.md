# Update Agent Documentation to Verb-First CLI Command Structure

**Date**: February 16, 2026

## Summary

Updated all agent management documentation to reflect the Stigmer CLI's new verb-first command structure. The CLI recently migrated from noun-first commands (e.g., `stigmer agent list`) to verb-first commands (e.g., `stigmer list agent`), rendering existing documentation incorrect and potentially confusing for users. This update ensures all documentation accurately represents the current CLI interface and provides complete, up-to-date usage examples.

## Problem Statement

The Stigmer CLI underwent a significant architectural change, moving from a noun-first command structure to a verb-first structure. However, documentation in the agent-drafter skill package was not updated to reflect these changes, creating a documentation-code mismatch that could mislead users and developers.

### Pain Points

- Documentation showed outdated command syntax (`stigmer agent list`) that no longer works
- Missing documentation for new commands like `stigmer validate` and `stigmer resources`
- Incorrect information about pagination, flags, and organization context management
- Missing information about new `run` command capabilities (env vars, secrets, attachments, downloads)
- References to non-existent commands like `stigmer context set`

## Solution

Comprehensively updated three key documentation files in the agent-drafter package to align with the current CLI implementation:

1. **managing-agents.md** (inputs) - Complete user guide for managing agents
2. **cli-usage.md** (references) - CLI reference documentation for agent operations
3. **SKILL.md** (outputs) - Agent drafter skill documentation

## Implementation Details

### Command Syntax Migration

Updated all command examples to use the verb-first pattern:

| Old Format | New Format |
|-----------|-----------|
| `stigmer agent list` | `stigmer list agent` |
| `stigmer agent get <name>` | `stigmer get agent <name>` |
| `stigmer agent apply agent.yaml` | `stigmer apply -f agent.yaml` |
| `stigmer agent delete <name>` | `stigmer delete agent <name>` |
| `stigmer agent search "query"` | `stigmer search agent "query"` |
| `stigmer run <agent-name>` | `stigmer run agent <agent-name>` |

### Apply Command Updates

- Documented file mode (`-f` flag) vs project mode (no flag)
- Added `stigmer validate -f` as standalone validation command
- Clarified dry-run functionality with both commands

### List/Search Pagination Corrections

- **List**: Removed incorrect `--page`/`--page-size` flags, replaced with `--limit` (default: 50)
- **Search**: Kept `--page`/`--page-size` flags (still valid for search operations)
- Removed non-existent `--all-orgs` flag

### Run Command Enhancements

Added comprehensive documentation for `stigmer run agent` with all current flags:

- `--message, -m` - Initial prompt
- `--env` - Runtime environment variables (repeatable)
- `--env-file` - Load environment from file (repeatable)
- `--secret` - Secret environment variables (encrypted, repeatable)
- `--secret-file` - Load secrets from file (repeatable, encrypted)
- `--attach` - File attachments as input (repeatable)
- `--download` - Download artifacts on completion
- `--detach` - Fire-and-forget execution
- `--approve-default` - Auto-resolve approval prompts

### Organization Context Management

Replaced references to non-existent `stigmer context` commands with actual `stigmer config` commands:

- `stigmer config set org <org-id>` - Set default organization
- `stigmer config list` - View all configuration
- `stigmer config get org` - Check specific setting

### Additional Commands Documented

- `stigmer resources` - List all resource types
- `stigmer resources --verb run` - Filter by verb support

### Files Updated

1. **backend/libs/go/seedpack/drafts/agent-drafter/inputs/managing-agents.md** (630 lines)
   - Complete user guide with corrected command syntax
   - Added new sections for validation, running agents, and resource discovery
   - Updated organization context management
   - Enhanced tips and best practices

2. **backend/libs/go/seedpack/drafts/agent-drafter/outputs/agent-drafter/references/cli-usage.md** (570 lines)
   - CLI reference with all current commands
   - Complete flag documentation
   - Error handling examples
   - Updated workflow examples

3. **backend/libs/go/seedpack/drafts/agent-drafter/outputs/agent-drafter/SKILL.md** (533 lines)
   - Updated CLI Usage section at bottom
   - Added validation command
   - Corrected all command examples

## Benefits

### For Users
- **Accurate documentation**: All commands work as documented
- **Complete reference**: All current CLI capabilities documented
- **Better learning experience**: Users can follow examples without encountering errors
- **Up-to-date guidance**: Latest CLI features and flags documented

### For Developers
- **Reduced support burden**: Fewer questions about "why commands don't work"
- **Consistent examples**: All documentation uses current syntax
- **Comprehensive coverage**: Complete flag and option documentation

### For the Project
- **Documentation quality**: Maintains high standards of accuracy
- **User confidence**: Users can trust documentation to be current
- **Reduced confusion**: Clear, consistent command examples throughout

## Impact

### User-Facing
- All users referencing agent management documentation will see correct commands
- New users learning the CLI will learn the current syntax from the start
- Existing users will have a clear migration reference

### Development
- Agent-drafter skill now provides accurate CLI guidance
- Documentation can be used as authoritative reference for CLI usage
- Future documentation updates have clear examples to follow

### Documentation Files
- 3 files updated (1,733 total lines)
- All CLI command references corrected
- Comprehensive coverage of CLI capabilities

## Related Work

This update is part of the broader CLI refactoring that introduced the verb-first command structure. The CLI implementation was updated in the client-apps/cli codebase, and this change brings the agent documentation in alignment with that implementation.

Future documentation updates should reference these files as templates for documenting other resource types (workflows, MCP servers, skills, etc.) to ensure consistency across all CLI documentation.

---

**Status**: ✅ Production Ready  
**Scope**: Documentation update (no code changes)  
**Files Changed**: 3 documentation files in agent-drafter package
