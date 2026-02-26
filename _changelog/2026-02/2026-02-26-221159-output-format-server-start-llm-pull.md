# Add --json/--quiet Flag Support to server start and server llm pull

**Date**: February 26, 2026

## Summary

Added `--json` and `--quiet` output format flags to the last two mutating CLI commands (`server start` and `server llm pull`), completing structured output coverage across all 12 mutating commands. ProgressDisplay (BubbleTea spinner) is conditionally skipped in non-human modes, while climsg operational progress stays on stderr — preserving the Unix contract of format flags controlling stdout, not suppressing all feedback.

## Problem Statement

`server start` and `server llm pull` were the only 2 of 12 mutating commands without `--json`/`--quiet` flag support. This meant scripts and CI/CD pipelines couldn't get structured output from these commands for automation.

### Pain Points

- `stigmer server --json` was not supported — no way to programmatically get server PID, port, or data directory after start
- `stigmer server llm pull MODEL --json` was not supported — no structured confirmation of model readiness
- Warning paths in `handleLLMPull` used bare `climsg` calls instead of `CommandResult`, inconsistent with the identical warnings in `handleLLMList`
- ProgressDisplay (BubbleTea) would still render in non-interactive contexts, conflicting with piped output

## Solution

Applied the established `addResultFormatFlags`/`resolveResultFormat`/`CommandResult` pattern to both commands:

- **ProgressDisplay**: Format-aware — only created in human mode; `nil` is passed to `StartOptions.Progress` in JSON/quiet mode, leveraging existing nil guards in `daemon.StartWithOptions`
- **climsg**: Format-agnostic — operational progress stays on stderr in all modes (no suppression)
- **CommandResult**: Format-aware — structured output rendered at command completion

This follows the bounded context separation established in the domain analysis: format flags control the Command Result context, not the Operational Progress context.

## Implementation Details

### server.go — `handleServerStart`

- Registered `--json`/`--quiet` flags on the `server` command
- Updated `handleServerStart` signature to accept `clioutput.OutputFormat`
- Conditional ProgressDisplay creation with three nil-safe touch points (creation, error-path stop, success-path stop)
- Final output section: human mode preserves existing climsg flow; JSON/quiet mode builds `CommandResult` with PID, port, data directory

### server_llm.go — `handleLLMPull`

- Registered `--json`/`--quiet` flags on the `server llm pull` command
- Updated `handleLLMPull` signature to accept `clioutput.OutputFormat`
- Migrated warning paths (non-ollama provider, LLM not running) from bare `climsg` to `CommandResult` + `Renderer` — matching `handleLLMList` patterns
- Pre-operation climsg messages conditional on human mode
- Final success uses `CommandResult` for all modes

### output_format_test.go — Integration Tests

- 2 flag wiring tests: `server` and `server llm pull`
- 1 JSON warning path test: `llm pull non-ollama provider`
- 1 quiet stdout-empty test: `llm pull non-ollama`

## Benefits

- All 12 mutating commands now support `--json`/`--quiet` — complete scriptability
- `stigmer server --json | jq .pid` is now possible for CI/CD automation
- `stigmer server llm pull MODEL --quiet` runs silently for scripted model setup
- Warning paths in `handleLLMPull` are consistent with `handleLLMList`
- No changes to downstream packages (`daemon.go`, `progress.go`, `clioutput/`, `climsg/`)

## Impact

- **CLI users**: Can now script server start and model pull operations with structured output
- **CI/CD pipelines**: Can parse server details after startup for automated workflows
- **Codebase**: Completes the output format migration — every mutating command follows the same pattern

## Related Work

- Prior: stderr redirect for ProgressDisplay and bare `fmt.Println` calls (Steps 1-2 of T01)
- Prior: Output format integration tests for existing commands
- Prior: `clioutput` package and `CommandResult` system foundation

---

**Status**: ✅ Production Ready
**Timeline**: Steps 3-4 and 6 of T01 (ProgressDisplay Output Correctness)
