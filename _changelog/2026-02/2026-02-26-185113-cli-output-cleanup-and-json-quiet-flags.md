# CLI Output Cleanup and --json/--quiet Flags

**Date**: February 26, 2026

## Summary

Completed the final phase of the CLI output system refactor: cleaned up dead code in the `cliprint` package, fixed an icon vocabulary violation, and wired `--json` and `--quiet` flags to all 10 mutating commands that use the CommandResult + Renderer pipeline. This completes the transition from ad-hoc `fmt.Println` output to a structured, machine-readable CLI output layer.

## Problem Statement

After four phases of migrating CLI output to the structured `clioutput.CommandResult` system, several cleanup items remained:

### Pain Points

- The `cliprint` package exported 15 symbols with zero external callers, cluttering the API surface
- Four deprecated function aliases (`Success`, `Info`, `Warning`, `Error`) were still called in `server_llm.go`
- The `getHealthSymbol` function used a non-standard double symbol (`✗✗`) for the "failed" state
- Mutating commands (delete, apply, server stop, etc.) hardcoded `FormatHuman` with no way to get machine-readable output for CI/CD scripting
- `resolveApplyOrganization` wrote informational messages to stdout via `cliprint.PrintInfo`, which would corrupt any future JSON output

## Solution

Three focused sub-tasks executed in sequence:

1. **Dead code cleanup**: Unexported all internally-used symbols in `cliprint`, replaced deprecated function calls, removed dead code
2. **Icon vocabulary fix**: Standardized `✗✗` to `✗` for consistency with the `✓`/`⚠`/`✗` vocabulary
3. **--json/--quiet flag wiring**: Created a shared flag registration helper and wired format selection to all 10 mutating commands through their existing Renderer infrastructure

## Implementation Details

### cliprint Dead Code Cleanup

Reduced the public API surface of `cliprint` to only the symbols with external callers:

- **Unexported 4 color variables**: `SuccessColor` → `successColor`, etc. (used only by `Print*` functions)
- **Unexported 6 phase constants**: `PhaseDiscovering`, `PhaseValidating`, `PhaseConnecting`, `PhaseExecuting`, `PhaseDeleting`, `PhaseCompleted` → lowercase (used only by progress model rendering)
- **Unexported type system**: `PhaseStatus`, `StatusPending`/`StatusActive`/`StatusComplete`, `ProgressModel`, `NewProgressModel`, `GetSnapshot` → all lowercase
- **Removed `RunWithProgress`**: Zero callers anywhere in the codebase
- **Removed 4 deprecated wrappers**: `Success`, `Info`, `Warning`, `Error` (after migrating the 10 calls in `server_llm.go`)

Net: `cliprint.go` from 63 to 42 lines. `progress.go` from 315 to 254 lines.

### --json and --quiet Flag Design

Created `output_flags.go` in the root command package with two functions:

- `addResultFormatFlags(cmd, &jsonFlag, &quietFlag)`: Registers `--json` (bool) and `--quiet`/`-q` (bool) on a cobra command, marks them mutually exclusive
- `resolveResultFormat(jsonFlag, quietFlag) clioutput.OutputFormat`: Maps flag values to the existing `FormatJSON`/`FormatQuiet`/`FormatHuman` enum

Flag naming deliberately avoids `--output` to prevent confusion with the `--output table/yaml/json` flag on get/list commands (System 2 per DD01).

### Commands Wired (10 total)

| Command | Wiring approach |
|---|---|
| `delete` | `OutputFormat` field in `deleteOptions` struct |
| `apply` | `OutputFormat` field in both `projectApplyOptions` and `fileApplyOptions` |
| `server stop` | `format` parameter on `handleServerStop` |
| `server status` | `format` parameter on `handleServerStatus` |
| `server llm status` | `format` parameter on `handleLLMStatus` |
| `server llm list` | `format` parameter on `handleLLMList` |
| `backend status` | `format` parameter on `handleBackendStatus` |
| `backend set` | `format` parameter on `handleBackendSet` |
| `config set` | `format` parameter on `handleConfigSet` |
| `config list` | `format` parameter on `handleConfigList` |

### Prerequisite Fix: stdout Corruption

Discovered during planning that `resolveApplyOrganization` in `apply.go` used `cliprint.PrintInfo` which writes to stdout via `color.Printf`. In `--json` mode, these informational messages would interleave with JSON data. Migrated all 4 calls to `fmt.Fprintf(os.Stderr, ...)`, matching the pattern already established in `apply_project.go`. This also removed the `cliprint` import from `apply.go`.

### Exclusions (by design)

- **config get / config path**: Raw value output for piping (design decision #10)
- **server start / llm pull**: BubbleTea ProgressDisplay — deferred to separate project
- **get / list / search**: System 2, already has `--output table/yaml/json` (DD01)

## Benefits

- **CI/CD scripting**: `stigmer delete agent my-agent --json | jq '.status'` now works for all mutating commands
- **Quiet mode**: `stigmer apply --quiet` for scripts that only need exit codes
- **Cleaner API surface**: 15 fewer exported symbols in `cliprint`, 1 dead function removed
- **Consistent vocabulary**: No more double symbols in status output
- **Safer stdout**: Apply command progress messages moved to stderr, preventing future output corruption

## Impact

- **CLI users**: New `--json` and `--quiet` flags available on all mutating commands
- **CI/CD pipelines**: Can now parse structured JSON output from delete, apply, server, backend, and config commands
- **Maintainers**: Cleaner `cliprint` package with minimal exported surface; `output_flags.go` provides a single pattern for future commands

## Related Work

- Builds on Phase 1–4 of the CLI output system refactor (clioutput package, CommandResult migration, display consolidation)
- Implements the System 1 format control from DD01 (Output Format Architecture)
- Completes the project started in `2026-02-26-025243-cli-output-system-foundation.md`

---

**Status**: ✅ Production Ready
**Timeline**: 1 session (Phase 5), part of 8-session refactor project
