# `stigmer server reset` Command

**Date**: February 27, 2026

## Summary

Added `stigmer server reset` as a first-class subcommand for returning the local Stigmer environment to a clean slate. Previously, users had to manually `rm -rf ~/.stigmer` (losing their configuration) and hope they remembered to stop services first. The new command stops all services, removes runtime state, preserves user configuration by default, and cleans up Docker containers -- all in one safe, confirmed operation.

## Problem Statement

The server lifecycle had a gap: users could start, stop, and check status, but there was no proper way to reset to a fresh state.

### Pain Points

- The only documented workaround (`rm -rf ~/.stigmer`) was buried in Troubleshooting
- That workaround destroyed user configuration (API keys, LLM preferences) along with data
- Users could forget to stop services first, leaving orphaned processes and Docker containers
- No Docker container cleanup was performed

## Solution

Introduced `stigmer server reset` following the existing subcommand pattern (`stop`, `status`, `logs`, `setup`). The command distinguishes between **user configuration** (preserved) and **runtime state** (removed), matching the mental model of a "factory reset."

## Implementation Details

### Domain Layer: `daemon/reset.go`

Core `Reset()` function with separated cleanup concerns:
- `removeDataDir` -- databases, PID files, workspace, artifacts
- `removeTemporalState` -- Temporal SQLite DB, PID/lock files
- `removeDownloadedBinaries` -- Temporal CLI, Ollama binaries
- `removeRootLogs` -- log directory and LLM PID file
- `removeDockerContainer` -- agent-runner Docker container
- `removeConfigFile` -- config.yaml (only with `--include-config`)

Returns a `ResetResult` struct for structured output reporting.

### Command Layer: `server_reset.go`

Thin Cobra handler following CLI coding guidelines:
- Interactive confirmation via existing `clioutput.Confirmer` interface
- `--force` flag skips confirmation (CI/automation)
- `--include-config` flag opts into removing `config.yaml`

### Flags

| Flag | Purpose |
|------|---------|
| `--force` | Skip confirmation prompt |
| `--include-config` | Also remove config.yaml |

### README Updates

- Added `reset` to "Managing the Server" quick reference
- Updated CLI Reference table
- Replaced manual `rm -rf ~/.stigmer` recipe in Troubleshooting with the proper command

## Benefits

- **Discoverable**: First-class subcommand instead of a buried workaround
- **Safe by default**: Preserves API keys and LLM preferences; requires opt-in for config removal
- **Complete**: Stops services, cleans data, removes Docker containers in one operation
- **Works in broken states**: Operates whether the server is running, stopped, or in a broken state

## Impact

All local-mode users gain a proper reset workflow. The README Troubleshooting section is now accurate and safe. No breaking changes -- purely additive.

## Related Work

- Interactive LLM setup wizard (same session, same branch)
- CLI output system modernization (recent)

---

**Status**: Production Ready
