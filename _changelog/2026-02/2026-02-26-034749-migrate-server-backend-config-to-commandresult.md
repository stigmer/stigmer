# Migrate Server/Backend/Config Commands to Structured CommandResult

**Date**: February 26, 2026

## Summary

Migrated all server, backend, and config CLI command output from ad-hoc `cliprint`/`fmt.Println` calls to the structured `clioutput.CommandResult` + `Renderer` system. Split the 896-line `server.go` into 5 focused files, and introduced a section-builder composition pattern that enables output reuse across standalone commands and embedded dashboards.

## Problem Statement

The server/backend/config commands used a mix of `cliprint.Info()`, `cliprint.Warning()`, `fmt.Println()`, and `fmt.Printf()` for output — the same ad-hoc pattern that Phase 3.1 eliminated from delete commands. Additionally, `server.go` at 896 lines was 3.5x over the 250-line engineering guideline.

### Pain Points

- No structured output — cannot pipe server status to JSON for monitoring
- Inconsistent output patterns across commands (some use cliprint, some use fmt directly)
- `server.go` monolith: 896 lines mixing command definitions, handler logic, health checks, LLM management, and display helpers
- `showLLMStatus()` called both standalone and embedded in server status — duplicated rendering logic
- Status output goes to stdout (wrong convention — informational output should go to stderr)

## Solution

Applied the CommandResult + Renderer pattern established in Phases 1 and 3.1, and introduced a new **section-builder pattern** for composable output. Split oversized files to meet the 250-line guideline.

## Implementation Details

### Section-Builder Pattern (New)

Functions that add sections to an existing `*CommandResult` rather than printing directly:

```go
func addLLMSections(result *clioutput.CommandResult, cfg *config.Config) {
    sec := result.AddSection("LLM Configuration")
    sec.Field("Provider", "Local ✓ Running")
    // ...
}
```

This enables dual-use: standalone commands create their own result and call the builder, while dashboard commands (like `handleServerStatus`) call multiple builders to compose a rich output.

Applied to: `addLLMSections`, `addComponentSection`, `addAgentRunnerSection`, `addBootstrapSection`.

### File Splits

| Original | Lines | Split Into | Lines |
|---|---|---|---|
| `server.go` | 896 | `server.go` | 224 |
| | | `server_status.go` | 207 |
| | | `server_health.go` | 140 |
| | | `server_llm.go` | 250 |
| `config.go` | 328 | `config.go` | 195 |
| | | `config_values.go` | 141 |

### Migrated Commands

- `stigmer backend status` — backend configuration display
- `stigmer backend set <type>` — backend type change with next-step hints
- `stigmer config set <key> <value>` — configuration update confirmation
- `stigmer config list` — grouped configuration display with sections
- `stigmer server status` — multi-component health dashboard via section-builders
- `stigmer server stop` — stop confirmation
- `stigmer server llm status` — LLM provider status (standalone + embedded)
- `stigmer server llm list` — model listing with current model indicator

### Deliberately Excluded

- `handleServerStart()` / `handleLLMPull()` — use BubbleTea `ProgressDisplay`, different paradigm
- `handleConfigGet()` / `handleConfigPath()` — raw value output, correct for piping
- `server_logs.go` — log streaming, not a command result

## Benefits

- **Structured output**: All migrated commands can emit JSON when `--output json` is wired (Phase 5)
- **Correct I/O convention**: Informational output goes to stderr, data to stdout
- **Composable sections**: `addLLMSections` used by both `server llm status` and `server status` without duplication
- **Maintainable file sizes**: Largest file is 250 lines (down from 896)
- **Consistent vocabulary**: Health symbols (`✓`/`✗`/`○`) embedded in values, matching Phase 1 semantic vocabulary

## Impact

- 8 command handlers migrated to structured output
- 1 file split into 5 (server.go), 1 file split into 2 (config.go)
- Net reduction: 896-line monolith eliminated
- Zero cliprint in 5 of the 7 modified/created files
- All existing tests continue to pass

## Related Work

- Phase 1: `clioutput` package foundation (2026-02-26-025243)
- Phase 2: Delete confirmation fix (2026-02-26-031441)
- Phase 3.1: Delete command migration (2026-02-26-032844)
- Phase 3.3 (next): Apply command migration

---

**Status**: ✅ Production Ready
**Timeline**: Phase 3.2 of CLI Output System Refactor
