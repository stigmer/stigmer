---
name: Phase 5 Cleanup Polish
overview: "Phase 5 has three concrete sub-tasks: dead code cleanup in cliprint, a targeted icon fix in server_health.go, and wiring --json/--quiet flags to the 10 mutating commands that already use CommandResult + Renderer. ProgressDisplay migration is deferred to a separate project."
todos:
  - id: dead-code-cleanup
    content: "5.1: Unexport dead cliprint exports, replace deprecated calls in server_llm.go, remove deprecated function definitions"
    status: completed
  - id: icon-fix
    content: "5.2: Fix double-symbol (✗✗ to ✗) in server_health.go getHealthSymbol"
    status: completed
  - id: output-flags-helper
    content: "5.3a: Create output_flags.go with addResultFormatFlags and resolveResultFormat"
    status: completed
  - id: apply-stderr-fix
    content: "5.3b: Migrate resolveApplyOrganization cliprint.PrintInfo calls from stdout to stderr"
    status: completed
  - id: wire-delete-flags
    content: "5.3c: Wire --json/--quiet to delete command (delete.go, delete_cancel.go)"
    status: completed
  - id: wire-apply-flags
    content: "5.3d: Wire --json/--quiet to apply command (apply.go, apply_project.go, apply_file.go)"
    status: completed
  - id: wire-server-flags
    content: "5.3e: Wire --json/--quiet to server stop, server status, server llm status, server llm list"
    status: completed
  - id: wire-backend-config-flags
    content: "5.3f: Wire --json/--quiet to backend status, backend set, config set, config list"
    status: completed
  - id: build-verify
    content: "5.3g: Update BUILD.bazel, run go build/vet/test, verify zero regressions"
    status: completed
isProject: false
---

# Phase 5: Cleanup and Polish

## Scope Assessment

Phase 5 was originally labeled "Small effort" with four sub-tasks. After deep audit:

- **5.1 (dead code)** and **5.2 (icon fix)** are mechanical cleanup
- **5.3 (--json/--quiet flags)** is moderate -- 10 command wiring points plus a new helper file
- **5.4 (ProgressDisplay migration)** is deferred per decision -- multi-day effort, working correctly, no user-facing issue

## 5.1: cliprint Dead Code Cleanup

### Unexport dead exports in [cliprint/progress.go](client-apps/cli/internal/cli/cliprint/progress.go)

These are used internally by ProgressDisplay but have zero external callers:

- **Phase constants**: `PhaseDiscovering`, `PhaseValidating`, `PhaseConnecting`, `PhaseExecuting`, `PhaseDeleting`, `PhaseCompleted` -- lowercase to `phaseDiscovering`, etc.
- **Status types**: `PhaseStatus`, `StatusPending`, `StatusActive`, `StatusComplete` -- lowercase
- **Implementation types**: `ProgressModel`, `NewProgressModel` -- lowercase
- **Dead function**: `RunWithProgress` -- zero callers anywhere, remove entirely

Keep exported (have external callers): `ProgressPhase`, `PhaseDeploying`, `PhaseInitializing`, `PhaseInstalling`, `PhaseStarting`, `ProgressState`, `NewProgressState`, all `ProgressState` methods, `ProgressDisplay`, `NewProgressDisplay`, all `ProgressDisplay` methods.

### Unexport dead color variables in [cliprint/cliprint.go](client-apps/cli/internal/cli/cliprint/cliprint.go)

- `SuccessColor`, `ErrorColor`, `InfoColor`, `WarningColor` -- lowercase (used only internally by `Print`* functions)

### Replace deprecated function calls in [server_llm.go](client-apps/cli/cmd/stigmer/root/server_llm.go)

`handleLLMPull` (lines 200-250) uses 10 deprecated aliases. Mechanical replacement:

- `cliprint.Error(...)` (lines 204, 240) --> `cliprint.PrintError(...)`
- `cliprint.Warning(...)` (lines 212, 218) --> `cliprint.PrintWarning(...)`
- `cliprint.Info(...)` (lines 213, 219-221, 225-226, 248-249) --> `cliprint.PrintInfo(...)`
- `cliprint.Success(...)` (line 246) --> `cliprint.PrintSuccess(...)`

### Remove deprecated function definitions from [cliprint/cliprint.go](client-apps/cli/internal/cli/cliprint/cliprint.go)

After all callers are migrated, delete the 4 deprecated wrapper functions (`Success`, `Info`, `Warning`, `Error` at lines 44-62).

## 5.2: Icon Vocabulary Fix

### Scope: System 1 files only (CommandResult-migrated)

The ✓/⚠/✗ vocabulary from clioutput is the standard for mutating command output. The audit found one violation in the migrated files:

- [server_health.go](client-apps/cli/cmd/stigmer/root/server_health.go) line 118: `"failed"` returns `"✗✗"` (double symbol) -- change to `"✗"` (single, consistent)

### No change needed

- `↻` (starting/restarting) and `○` (stopped) are legitimate extensions used consistently in both [server_health.go](client-apps/cli/cmd/stigmer/root/server_health.go) and [bootstrap/status.go](client-apps/cli/internal/cli/bootstrap/status.go). These represent server states that have no equivalent in the three-symbol base vocabulary. They stay as documented extensions.

### Out of scope

- executiontui, toolrender, run_display.go -- TUI domain with a fundamentally different visual language (emoji for tool categories, rich status indicators, interactive chrome). Enforcing ✓/⚠/✗ there would make the TUI visually impoverished. TUI icon consistency is its own concern.

## 5.3: --json and --quiet Flags for Mutating Commands

### Design

- `--json` (bool, no short flag) -- output CommandResult as JSON to stdout
- `--quiet` / `-q` (bool) -- suppress decorative output, print status line only
- Mutually exclusive via `cobra.MarkFlagsMutuallyExclusive`
- Maps to existing `clioutput.FormatJSON` / `clioutput.FormatQuiet` (renderers already built and tested)

### New file: `output_flags.go` in [root package](client-apps/cli/cmd/stigmer/root/)

Two functions:

```go
func addResultFormatFlags(cmd *cobra.Command, jsonFlag, quietFlag *bool)
func resolveResultFormat(jsonFlag, quietFlag bool) clioutput.OutputFormat
```

### Surprise discovered: stdout corruption risk in apply

[apply.go](client-apps/cli/cmd/stigmer/root/apply.go) `resolveApplyOrganization` (lines 98-123) uses `cliprint.PrintInfo` which writes to **stdout** (via `color.Printf`). In `--json` mode, these informational messages would corrupt the JSON data stream. Must migrate these 4 calls to `fmt.Fprintf(os.Stderr, ...)` before wiring `--json` to apply commands. This is a prerequisite fix, not optional.

### Commands to wire (10 total)


| Command             | Handler function                          | Wiring approach                            |
| ------------------- | ----------------------------------------- | ------------------------------------------ |
| `delete`            | `executeDelete`                           | Add `OutputFormat` to `deleteOptions`      |
| `apply`             | `executeProjectApply`, `executeFileApply` | Add `OutputFormat` to both options structs |
| `server stop`       | `handleServerStop`                        | Add `format` parameter                     |
| `server status`     | `handleServerStatus`                      | Add `format` parameter                     |
| `server llm status` | `handleLLMStatus`                         | Add `format` parameter                     |
| `server llm list`   | `handleLLMList`                           | Add `format` parameter                     |
| `backend status`    | `handleBackendStatus`                     | Add `format` parameter                     |
| `backend set`       | `handleBackendSet`                        | Add `format` parameter                     |
| `config set`        | `handleConfigSet`                         | Add `format` parameter                     |
| `config list`       | `handleConfigList`                        | Add `format` parameter                     |


### Excluded from --json/--quiet

- **config get** / **config path** -- raw value output for piping (design decision #10)
- **server start** / **llm pull** -- ProgressDisplay flow (deferred)
- **get** / **list** / **search** -- System 2, already has `--output table/yaml/json` (DD01)

### Wiring pattern (example: delete)

In [delete.go](client-apps/cli/cmd/stigmer/root/delete.go):

```go
func NewDeleteCommand() *cobra.Command {
    var force bool
    var orgOverride string
    var jsonOutput, quietOutput bool

    cmd := &cobra.Command{
        // ...
        Run: func(cmd *cobra.Command, args []string) {
            err := executeDelete(deleteOptions{
                // ...existing fields...
                OutputFormat: resolveResultFormat(jsonOutput, quietOutput),
            })
            clierr.Handle(err)
        },
    }

    cmd.Flags().BoolVarP(&force, "force", "f", false, "skip confirmation prompt")
    cmd.Flags().StringVar(&orgOverride, "org", "", "organization ID override")
    addResultFormatFlags(cmd, &jsonOutput, &quietOutput)

    return cmd
}
```

Then in `executeDelete`, replace `clioutput.FormatHuman` with `opts.OutputFormat`.

### BUILD.bazel update

Add `"output_flags.go"` to [BUILD.bazel](client-apps/cli/cmd/stigmer/root/BUILD.bazel) srcs list.

## Implementation Order

1. **5.1** first -- removes noise, smaller diff surface
2. **5.2** second -- one-line fix
3. **5.3** last -- largest change, builds on clean foundation

Within 5.3:

1. Create `output_flags.go` with helpers
2. Fix `resolveApplyOrganization` stdout-to-stderr (prerequisite)
3. Wire flags to each command (batch by file)
4. Update BUILD.bazel
5. Verify: `go build`, `go vet`, `go test`

