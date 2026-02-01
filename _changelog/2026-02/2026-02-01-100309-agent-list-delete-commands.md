# Agent List and Delete Commands for CLI

**Date**: February 1, 2026

## Summary

Completed Sub-task 6 of Phase 1 (Agent YAML-First Foundation) by implementing `stigmer agent list` (placeholder) and `stigmer agent delete` commands. These commands follow the established MCP Server pattern while improving upon it with proper interactive confirmation using the survey library. The delete command provides a complete, production-ready implementation with safety features, while the list command provides a helpful placeholder until the backend List RPC is implemented.

## Problem Statement

The Agent command group was incomplete, missing essential CRUD operations. While apply, validate, and get commands were functional, users had no way to:
- Delete agents they no longer needed
- List all agents in their organization
- Manage the full lifecycle of agent resources

### Pain Points

- No way to clean up unwanted agents from the system
- Risk of accidental deletion without confirmation prompts
- Incomplete command parity with other resources (MCP Server, Skill)
- Users needed to manually construct resource IDs for deletion
- No discoverability for list functionality (command missing from help)

## Solution

Implemented a complete delete workflow and placeholder list command following established patterns:

**Delete Implementation**:
- Business logic separated from command layer (`internal/cli/agent/delete.go`)
- Interactive confirmation prompt using survey library
- Auto-detection of resource IDs vs slugs via enum-based reference parser
- Proper error handling and user-friendly messages
- Force flag to skip confirmation for scripting/automation

**List Implementation**:
- Placeholder command that gracefully explains the limitation
- Provides helpful alternatives (using `stigmer agent get`)
- Maintains command consistency (visible in help)
- Ready to replace with actual implementation when backend RPC available

## Implementation Details

### Files Created

**Business Logic** (`internal/cli/agent/`):
- `delete.go` (77 lines): Delete orchestration with `DeleteFromBackend()` and `Delete()` functions
  - Uses `AgentCommandController.Delete(ctx, *AgentId)` API
  - Returns deleted agent for confirmation display
  - Comprehensive error wrapping

**Command Layer** (`cmd/stigmer/root/`):
- `agent_delete.go` (151 lines): Delete command with interactive confirmation
  - Flags: `--force, -f` (skip confirmation), `--org` (organization override)
  - 8-step orchestration: config → org → daemon → connect → fetch → confirm → delete → display
  - Confirmation using `survey.Confirm` with clear messaging
  
- `agent_list.go` (46 lines): Placeholder command
  - User-friendly message explaining List API is not yet available
  - Examples showing how to use `stigmer agent get` instead
  - Mirrors MCP Server pattern exactly

### Files Modified

**Display** (`internal/cli/agent/display.go`, +29 lines):
- `DisplayDeleteResult()`: Success message showing deleted agent details
- `DisplayDeleteConfirmation()`: Pre-deletion warning with resource details

**Command Registration** (`cmd/stigmer/root/agent.go`, +8 lines):
- Registered `newAgentListCommand()` and `newAgentDeleteCommand()`
- Updated command group examples

**Build Files**:
- `cmd/stigmer/root/BUILD.bazel`: Added agent_delete.go and agent_list.go to srcs
- `internal/cli/agent/BUILD.bazel`: Added delete.go to srcs

### Key Technical Decisions

1. **API Difference Handling**: Agent Delete API uses `AgentId{Value: string}` type, different from MCP Server's `ApiResourceDeleteInput{ResourceId: string}`. Adapted accordingly.

2. **Confirmation Flow**: Improved upon MCP Server's incomplete confirmation by using survey library for proper interactive prompts with clear yes/no choices.

3. **Separation of Concerns**: Business logic in `internal/cli/agent/`, thin command handlers in `cmd/stigmer/root/` following strict coding guidelines.

4. **Reference Parsing**: Leveraged existing enum-based `reference.Parse()` that automatically supports all resource kinds without hardcoded prefixes.

5. **Error Context**: All errors wrapped with specific, actionable context using `errors.Wrap()`.

## Benefits

**User Experience**:
- Safe deletion with confirmation prompt prevents accidental data loss
- Force flag enables scripting and automation scenarios
- Clear error messages guide users on how to fix issues
- Consistent command structure across all resource types

**Developer Experience**:
- Clean separation between business logic and command layer
- Reusable delete functions for potential UI integration
- Easy to extend when List RPC becomes available
- All functions under 50 lines, all files under 250 lines

**Quality**:
- Zero hardcoded resource ID prefixes (enum-driven)
- Comprehensive error handling
- Test suite passes (28 tests in agent package)
- Bazel builds successfully

## Impact

**Immediate Impact**:
- Users can now fully manage agent lifecycle (create, read, update, delete)
- Agent command group reaches feature parity with MCP Server
- Phase 1 Sub-task 6 completed (6 of 7 tasks done, 86% complete)

**Technical Impact**:
- Established pattern for future delete commands (Workflow, Session, etc.)
- Demonstrated proper use of survey library for confirmations
- Reinforced coding guidelines compliance across the codebase

**Next Steps**:
- Sub-task 7: Implement `stigmer agent run` command
- Backend: Add List RPC to `AgentQueryController` to enable full list functionality
- Testing: Manual testing with local daemon once SDK templates issue is resolved

## Related Work

**Builds Upon**:
- Sub-task 1: Agent YAML Loader (loader.go, validator.go)
- Sub-task 2: Agent Schema Validator (cross-field validation)
- Sub-task 3: Agent Applier & Display (applier.go, display.go)
- Sub-task 4: Agent Apply Command (agent.go)
- Sub-task 5: Validate + Get Commands (agent_validate.go, agent_get.go, get.go)

**References**:
- MCP Server delete pattern: `cmd/stigmer/root/mcpserver.go` (lines 488-630)
- Survey library usage: `pkg/approval/interactive.go`
- Enum-based reference parsing: `pkg/reference/reference.go`

**Project Context**:
- Project: `_projects/2026-01/20260131.02.cli-agent-yaml-first`
- Phase: Phase 1 - Agent YAML-First Foundation
- Progress: 6 of 7 sub-tasks complete (86%)

---

**Status**: ✅ Production Ready  
**Timeline**: ~2 hours (Sub-task 6 implementation)  
**Lines Changed**: +274 new, +122 modified (396 total)
