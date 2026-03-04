# Two-Lane Output Design: Interactive TUI + Inline/JSON Streams

**Date**: March 3, 2026

## Summary

Implemented a three-mode output system for agent execution streaming: auto-detecting TTY capability to choose between the interactive Bubbletea TUI (default), an inline streaming renderer with correct stdout/stderr separation, and a newline-delimited JSON event stream for scripting and CI. This makes `stigmer run` and `stigmer draft` usable in pipes, dumb terminals, and programmatic contexts for the first time.

## Problem Statement

Agent execution always launched a Bubbletea alt-screen TUI regardless of terminal environment. Piped or dumb terminals received garbled output. There was no structured output format for scripting, CI pipelines, or tool integration.

### Pain Points

- `stigmer run agent x | cat` produced garbled alt-screen escape sequences
- CI/CD pipelines couldn't consume execution output programmatically
- `TERM=dumb` environments (some Docker containers, Emacs shell) got broken rendering
- No way to extract AI agent responses as pipeable data separate from status chrome
- The existing `messageStreamRenderer` operated on proto messages, not the event pipeline, and was unused in production

## Solution

Three output modes selected by flag or auto-detection:

- **Interactive** (default on TTY): Existing Bubbletea alt-screen TUI — unchanged
- **Inline** (`--no-tui` or auto-detected non-TTY): New event-based renderer streaming AI content to stdout and status/progress to stderr
- **JSON** (`--json`): NDJSON event serializer emitting every event as a self-contained JSON line on stdout

The event pipeline (`streamToEvents` / `snapshotToEvents`) is unchanged — the same channel of `executiontui.Event` objects feeds all three consumers.

## Implementation Details

### New Files

- **`output_mode.go`** (82 lines): `OutputMode` enum, `resolveOutputMode()` with TTY detection + `TERM=dumb` + flag precedence, `registerOutputModeFlags()` helper. Flags `--json` and `--no-tui` are mutually exclusive.

- **`run_stream_inline.go`** (258 lines): `inlineRenderer` with event consumption loop handling all 17 event types. AI streaming with byte-level delta deduplication. Tool call lifecycle badges via `toolrender.RenderWithBadge`. Approval handling via the existing `approval.Prompter` interface. stdout/stderr discipline: AI content → stdout (pipeable data), everything else → stderr.

- **`run_stream_json.go`** (234 lines): `jsonRenderer` serializing each event as `{type, ts, payload}` NDJSON. Empty strings omitted from payloads for clean output. Approvals auto-resolved via `defaultAction` with stderr warning when unset. Tool call payloads include args, result, duration, and error when available.

### Modified Files

- **`run_stream.go`**: Refactored `streamAgentExecution` to accept `OutputMode` and branch into `streamAgentInteractive` (existing TUI), `streamAgentInline`, and `streamAgentJSON`. Shared epilogue extracted into `streamAgentEpilogue`.

- **`run_session.go`**: Added `outputMode` parameter through `executeRunSession`, `openSession`, and `resumeSession`. Non-interactive modes skip follow-up and subject fetch. Interactive TUI extracted into `resumeSessionInteractive`.

- **`run_agent_exec.go`**: Added `OutputMode` to both `preparedAgentExec` and `resolvedAgentExecInput` structs.

- **`run.go`**: Registered `--json` and `--no-tui` flags, resolved output mode, added OUTPUT MODES help section with examples.

- **`draft_handler.go`**: Registered flags and threaded output mode through `executeDraft`.

### Design Decisions

- **`--json` (boolean) over `--output json` (enum)**: Avoids conflict with `draft --output` (directory path) and matches the existing `output_flags.go` pattern.
- **`--no-tui` over `--no-alt-screen`**: More descriptive — users know what a TUI is; "alt-screen" is a Bubbletea implementation detail.
- **New event-based renderers instead of reusing `messageStreamRenderer`**: The existing renderer operates on `[]*agentexecutionv1.AgentMessage` (proto messages), not `executiontui.Event` types. Different input types, different state machines.
- **stdout/stderr separation baked in from day one**: Subsumes Phase 3.1 for the inline/JSON paths. AI content is the "data" (pipeable), everything else is status.
- **Follow-up disabled in non-interactive modes**: Conversational mode requires an input composer. Non-interactive sessions run to completion and exit — correct for scripting and pipe contexts.

## Benefits

- **Pipe-friendly**: `stigmer run agent x -m "write a poem" | cat` now works — AI content flows cleanly
- **CI/CD integration**: `stigmer run agent x --json | jq '.payload.content'` for programmatic event consumption
- **Auto-detection**: No flags needed for the common case — stdout piped to a file or another process automatically selects inline mode
- **Zero TUI regression**: The interactive path is identical — only the branching point changed
- **33 new tests**: Comprehensive coverage of output mode resolution, inline renderer (stdout/stderr routing, AI streaming, tool badges, phase changes, todos, sub-agents, approval), and JSON renderer (NDJSON validity, event types, payload structure, approval auto-resolve)

## Impact

- **Users**: Agent execution output is now usable in pipes, scripts, CI runners, and dumb terminals
- **Integrations**: NDJSON output enables programmatic consumption of execution events
- **Platform**: Establishes the stdout/stderr discipline pattern for all future CLI output

## Related Work

- Phase 2.1 (Comprehensive Error Handler) — complements this with structured error classification
- Phase 3.1 (stdout/stderr separation) — partially subsumed for the inline/JSON paths
- Phase 1.3 (Dead Stream Connection Detection) — `streamError` events now appear correctly in all three output modes

---

**Status**: ✅ Production Ready
**Timeline**: Single session
