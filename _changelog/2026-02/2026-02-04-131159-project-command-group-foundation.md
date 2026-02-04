# Project Command Group Foundation

**Date**: February 4, 2026

## Summary

Implemented the `stigmer project` command group with `info` and `validate` subcommands, completing T04.6 of Phase 4 (Project Entity). This provides local-only project management commands that leverage the existing project internal package infrastructure for track detection, validation, and display.

## Problem Statement

The Stigmer CLI needed a command group for managing Project resources - the aggregate root for the Dual-Track Interface. While the project internal package (loader, validator, display, detect) was already implemented, there was no CLI surface to expose these capabilities to users.

### Pain Points

- No way for users to view local `stigmer.yaml` configuration
- No CI-friendly validation command for project configurations
- Track detection logic existed but wasn't exposed through CLI
- Users had no visibility into whether they were in Atomic or Project Track

## Solution

Created a new `project` command group (alias: `proj`) with two local-only subcommands:

1. **`stigmer project info`** - Display local stigmer.yaml configuration with table/yaml/json output formats
2. **`stigmer project validate`** - CI-friendly validation with exit codes (0=valid, 1=invalid)

Both commands leverage the track detection logic to find and load `stigmer.yaml` from the current directory or parent directories.

## Implementation Details

### Files Created

**`client-apps/cli/cmd/stigmer/root/project.go`** (236 lines)

Factory function pattern following established CLI patterns:

```go
// NewProjectCommand creates the project management command group.
func NewProjectCommand() *cobra.Command {
    cmd := &cobra.Command{
        Use:     "project",
        Aliases: []string{"proj"},
        Short:   "Manage Stigmer projects",
        // ...
    }
    cmd.AddCommand(newProjectInfoCommand())
    cmd.AddCommand(newProjectValidateCommand())
    return cmd
}
```

Key components:
- `newProjectInfoCommand()` - Info subcommand with `--output` and `--dir` flags
- `newProjectValidateCommand()` - Validate subcommand with `--dir` flag
- `executeProjectInfo()` - Orchestration: DetectTrack → Display
- `executeProjectValidate()` - Orchestration: DetectTrack → Validate → DisplaySuccess
- `displayNoProjectFound()` - Helpful guidance for Atomic Track mode

### Files Modified

**`client-apps/cli/cmd/stigmer/root.go`**
- Added `root.NewProjectCommand()` registration

**`client-apps/cli/cmd/stigmer/root/BUILD.bazel`**
- Added `project.go` to sources
- Added `//client-apps/cli/internal/cli/project` to deps

### Command Behavior

**Info Command** (`stigmer project info`):
- Detects track using `project.DetectTrack()`
- If TrackAtomic: Displays helpful message about Atomic Track mode
- If TrackProject: Displays project configuration in requested format

**Validate Command** (`stigmer project validate`):
- Detects track using `project.DetectTrack()`
- If TrackAtomic: Returns error (exit code 1)
- If TrackProject: Runs cross-field validation via `project.Validate()`
- Displays success message via `project.DisplayValidationSuccess()`

### Zero New Internal Package Code

The implementation is pure orchestration - all logic reused from existing infrastructure:
- `project.DetectTrack()` - Walk-up directory detection
- `project.Validate()` - Cross-field validation
- `project.DisplayProjectInfo()` - Table/YAML/JSON output
- `project.DisplayValidationSuccess()` - CI-friendly success message

## Benefits

- **User Visibility**: Users can now see their project configuration locally
- **CI Integration**: Validate command provides CI-friendly exit codes
- **Track Awareness**: Users understand whether they're in Atomic or Project Track
- **Consistent UX**: Follows established CLI patterns (factory functions, aliases, flags)
- **Extensibility**: Clear extension points for Phase 5 remote commands (get, apply, delete)

## Impact

### Users
- Can validate project configurations before deployment
- Can view project details in multiple formats
- Receive helpful guidance when no project exists

### CLI Architecture
- Project command group aligns with Agent, Workflow, McpServer patterns
- 236-line implementation comparable to agent.go (262 lines)
- All functions under 50 lines per engineering standards

### Phase 4 Progress
- T04.6 complete (88.9% of Phase 4)
- Only T04.7 (Integration and Documentation) remains

## Verification

| Check | Result |
|-------|--------|
| gofmt | Pass |
| go vet | Pass |
| go build (project.go) | Pass |
| Project internal package build | Pass |
| Project tests (81 tests) | Pass |

## Related Work

- **T04.5**: Track Detection Logic - `detect.go` providing `DetectTrack()` function
- **T04.4**: Project Display - `display.go` providing display functions
- **T04.3**: Project Validator - `validator.go` providing `Validate()` function
- **T04.2**: Project Loader - `loader.go` providing `Load()` function
- **Phase 5 Preview**: Remote commands will add get, apply, delete subcommands

---

**Status**: ✅ Production Ready
**Phase**: 4.6 of 4.7 (Phase 4: 88.9% complete)
