# Design Decision 001: Conservative Bubbletea Integration Strategy

**Date**: 2026-03-05
**Status**: Accepted
**Context**: Phase 1 implementation of Bubbletea inline renderer

## Decision

Adopt a conservative, incremental integration strategy that diverges from the original T01 plan's "single writer" approach. Bubbletea runs alongside the existing renderer as a silent companion, progressively taking ownership of rendering responsibilities phase by phase.

## Original T01 Plan Assumptions (Superseded)

The original T01 plan assumed:

1. **Single writer**: "All inline output goes through one Bubbletea program. No stdout/stderr split in inline mode."
2. **All output via tea.Println**: Phase 1 described as "all output goes through `tea.Println()` (committed immediately)"
3. **Event loop migration in Phase 1**: "convert `handleEvent` to produce `tea.Cmd`"
4. **Bubbletea owns stdin**: Implicit assumption that Bubbletea handles keyboard input

## What We Discovered

Three API-level constraints invalidated the original assumptions:

1. **`tea.Println` is line-based**: It always appends `\r\n`. Token-by-token AI streaming (the primary output of the CLI) cannot flow through it. This rules out the "all output through Println" approach.

2. **`Update()` cannot block**: Bubbletea's event loop is non-blocking. The existing approval flow (`handleApproval`) blocks for raw terminal input via `pkg/approval/inline_prompter.go`. Moving this into `Update()` requires a full async rewrite of the approval state machine -- too large for Phase 1.

3. **stdout/stderr split is the natural boundary**: The existing renderer already separates `dataW` (stdout, AI content) from `statusW` (stderr, status/tool/approval output). `tea.WithOutput(statusW)` maps perfectly to this boundary, avoiding any disruption to the stdout data path.

## Revised Approach (What We Implemented)

| Aspect | Original Plan | Revised Approach |
|--------|--------------|-----------------|
| Output ownership | Single writer, no split | Bubbletea owns stderr only; stdout stays direct |
| AI streaming | Through tea.Println | Direct to stdout (unchanged) |
| Event loop | Migrate to tea.Update in Phase 1 | Keep existing `for { select {} }` loop; defer migration |
| Stdin | Bubbletea owns it | `tea.WithInput(nil)` -- Bubbletea never reads stdin |
| Status output | All through Println | Through Println when TTY and not in approval flow |
| Approval flow | Migrate in Phase 4 | Phase 1 uses `inApprovalFlow` sentinel for direct writes |
| View() | Empty in Phase 1 | Empty in Phase 1 (same) |

## Why This Is Better

1. **Smaller blast radius**: Phase 1 is truly a no-op from the user's perspective. The existing event loop, approval flow, and stdout path are untouched.

2. **Testability**: Nil program = direct write fallback means all existing tests pass without modification. No test scaffolding needed.

3. **Reversibility**: If Bubbletea integration hits unforeseen issues in later phases, the fallback path is always there -- just don't set the `program` field.

4. **Honest about complexity**: The approval flow rewrite (blocking -> async state machine) is genuinely complex. Deferring it to a dedicated phase with its own planning avoids underestimating the effort.

## Impact on Later Phases

The T01 plan's Phase 2-7 descriptions remain directionally correct but should be re-evaluated at the start of each phase against the revised foundation:

- **Phase 2 (Spinner)**: The spinner can move into `View()` as planned, but Bubbletea still only owns stderr.
- **Phase 3 (Header)**: Same -- header renders in `View()` on stderr.
- **Phase 4 (Approval)**: The most impacted phase. Needs a dedicated planning session to design the async state machine that replaces the blocking `handleApproval`. The `inApprovalFlow` sentinel introduced in Phase 1 will be removed here.
- **Phase 5-7**: Should be re-planned after Phase 4, since the stdout/stderr split question may need revisiting once the approval flow is event-driven.

## Recommendation for T01 Plan

The T01 plan should be updated to status "REVISED" with a note pointing to this design decision. The phase descriptions in T01 remain useful as directional goals but are no longer literal implementation specs.
