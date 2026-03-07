# Split `stigmer run` and `stigmer resume` into Dedicated Commands

**Date**: March 8, 2026

## Summary

The overloaded `stigmer run` command — which previously handled both new agent/workflow executions and session resumption — has been split into two focused commands following Domain-Driven Design principles. `stigmer run` now exclusively starts new executions with smart agent resolution and an interactive picker, while the new `stigmer resume` command handles re-opening existing sessions. A reusable generic TUI picker component (`pkg/picker`) was introduced to power interactive selection in both commands.

## Problem Statement

`stigmer run` served two fundamentally different intents: "create a new execution" and "continue an existing conversation." This violated the Single Responsibility Principle and created UX confusion — users had to know whether a string was a session ID or an agent reference, and the command's help text and error messages were overloaded.

### Pain Points

- Ambiguous command semantics: `stigmer run ses-xxx` and `stigmer run agent my-agent` shared the same entry point despite being different domain operations
- No interactive discovery: users had to know exact agent slugs or IDs to run anything
- Error messages couldn't clearly direct users because the command conflated creation with continuation
- Help text and examples were bloated trying to document two distinct workflows in one command

## Solution

**Architectural split** into two commands aligned with domain boundaries:

- **`stigmer run`**: New execution creation — supports 0-arg interactive agent browsing, 1-arg smart resolution (slug, org/slug, agent ID, or fuzzy search fallback), and 2-arg explicit type + reference for backward compatibility.
- **`stigmer resume`**: Session continuation — supports 0-arg interactive session browsing, 1-arg direct session ID lookup or text search across recent sessions. Cross-references agent/workflow IDs back to `stigmer run` with actionable error messages.

**Shared infrastructure**: A generic `pkg/picker` Bubbletea component with debounced async search, keyboard navigation, lipgloss styling, and non-TTY fallback powers interactive selection in both commands.

## Implementation Details

### New packages and files

| File | Purpose |
|------|---------|
| `pkg/picker/item.go` | Domain-agnostic `Item` struct for picker entries |
| `pkg/picker/model.go` | Bubbletea `tea.Model` with debounced search, cursor navigation, loading states |
| `pkg/picker/picker.go` | Public `Pick(Config)` API with TTY detection and `ErrNonInteractive` / `ErrCancelled` |
| `pkg/picker/styles.go` | Lipgloss styles for consistent picker rendering |
| `cmd/stigmer/root/resume.go` | Cobra command definition for `stigmer resume` |
| `cmd/stigmer/root/resume_picker.go` | Session search function using `session.List` + client-side filtering |
| `cmd/stigmer/root/run_picker.go` | Agent resolution chain and search function using `search.Search` RPC |

### Refactored files

- **`run.go`**: Removed all session handling, updated argument validation to accept 0–2 args, added dispatch to `executeRunInteractive` (0-arg) and `executeRunSmart` (1-arg)
- **`run_session.go` → `resume_session.go`**: Renamed to reflect new ownership by the `resume` command
- **`root.go`**: Registered `NewResumeCommand()` under the "core" command group
- **`pkg/reference/`**: Added `ValidateResourceID`, `ResourceIDKind`, `HasResourceIDPrefix` for strict ULID validation and `ErrIncompleteID` / `ErrNotResourceID` sentinel errors

### User-facing string updates

Over 15 occurrences of `stigmer run <session-id>` in re-attach hints, error messages, and UI headers across `run_stream_inline.go`, `run_stream_inline_render.go`, `run_display_summary.go`, `run_stream_inline_header.go`, `run_stream_inline_approval_display.go`, and `run_stream_events.go` were updated to `stigmer resume <session-id>`. Corresponding test assertions were updated in lock-step.

## Benefits

- **Clear mental model**: "run = create, resume = continue" maps directly to user intent
- **Interactive discovery**: users can type `stigmer run` with no arguments and browse available agents with real-time search
- **Actionable errors**: wrong-type IDs produce cross-command redirects (e.g., "this is a session ID — use `stigmer resume` instead")
- **Reusable picker**: `pkg/picker` is a generic component ready for use in future interactive CLI workflows
- **Backward compatible**: the 2-arg form `stigmer run agent <name>` continues to work unchanged

## Impact

- **CLI users**: Clearer command vocabulary, interactive agent browsing, better error guidance
- **Maintainers**: Separation of concerns makes each command easier to extend independently
- **Documentation**: `COMMANDS.md` updated with new usage forms, migration table includes `stigmer run ses-xxx → stigmer resume ses-xxx`

## Related Work

- Previous session streaming infrastructure (`run_stream_inline.go`, approval flow, follow-up prompt)
- Bubbletea v2 migration (the picker uses `bubbletea/v2` and `bubbles/v2`)
- Resource reference parsing (`pkg/reference`)

---

**Status**: ✅ Production Ready
**Scope**: 7 new files, 15 modified files, ~800 lines added
