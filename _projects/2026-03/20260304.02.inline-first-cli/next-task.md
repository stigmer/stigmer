# Next Task: 20260304.02.inline-first-cli

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260304.02.inline-first-cli

**Description**: Move Stigmer CLI from alt-screen TUI default to inline-first terminal experience inspired by Claude Code. Compact tool rendering (read as filename+line count, write/edit with previews, grouped sub-agents), inline follow-up input, and streamlined approval prompts — all in normal terminal scrollback without alt-screen.
**Goal**: Make the inline rendering mode the default CLI experience with four perfected UI surfaces: (1) Read tool as compact filename+line count, (2) Write/Edit tool with appropriate previews, (3) Sub-agent tool grouping, and (4) Streamlined approval prompts. TUI alt-screen code removed entirely in Phase 5.
**Tech Stack**: Go, gRPC, Cobra, Bubbletea (used by InteractivePrompter and cliprint only — not for TUI)
**Components**: client-apps/cli/cmd/stigmer/root (run_stream_inline.go, output_mode.go, run_stream.go), client-apps/cli/pkg/executiontui (events.go, followup.go — event types only), client-apps/cli/pkg/toolrender (file_preview.go, render.go, render_compact.go, hyperlink.go), client-apps/cli/pkg/termctl (termctl.go)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.02.inline-first-cli/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.02.inline-first-cli/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.02.inline-first-cli/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.02.inline-first-cli/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.02.inline-first-cli/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.02.inline-first-cli/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.02.inline-first-cli/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.02.inline-first-cli/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.02.inline-first-cli/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.02.inline-first-cli/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.02.inline-first-cli/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.02.inline-first-cli/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.02.inline-first-cli/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-03-04 00:23
**Current Task**: All phases complete
**Status**: Complete — Phases 1-5 all done, committed
**Last Session**: 2026-03-04 — Phase 5 committed as `22b67a6b`
**Last Commit**: `22b67a6b refactor(cli): remove alt-screen TUI and dead code across CLI packages`

## Session Progress (2026-03-04, Session 1)

- Phase 1 (Flip Default to Inline) completed
- Removed `--no-tui` flag and `NoTUI` struct field from `outputModeFlags`
- Simplified `resolveOutputMode` to a two-path function: `--json` or inline (default)
- Updated help text, examples, and doctor hints to remove all `--no-tui` references
- Decision: TUI code stays in codebase but unreachable from CLI flags (no `--tui` flag added)
- Tests updated: removed 6 obsolete tests, added `TestResolveOutputMode_NoFlags_AlwaysInline`

### Files Modified (Session 1)
- `client-apps/cli/cmd/stigmer/root/output_mode.go`
- `client-apps/cli/cmd/stigmer/root/output_mode_test.go`
- `client-apps/cli/cmd/stigmer/root/run.go`
- `client-apps/cli/cmd/stigmer/root/doctor_checks_runtime.go`

## Session Progress (2026-03-04, Session 2)

- Phase 2.0 (OSC 8 File Hyperlinks) completed
- Created `pkg/toolrender/hyperlink.go` (81 lines) — foundational OSC 8 hyperlink primitives
- Created `pkg/toolrender/hyperlink_test.go` (257 lines) — 22 test functions with full coverage
- Updated `pkg/toolrender/BUILD.bazel` — added new files and `golang.org/x/term` dep

### Key Design Decisions (Session 2)
- `FileHyperlink(displayPath, absolutePath, enabled)` is pure — takes an `enabled bool` per DI guidelines, no env var reads
- `Hyperlink(displayText, uri)` is generic OSC 8 wrapper exposed for future non-file links (HTTP URLs, issue links)
- `HyperlinksEnabled(w)` co-located in `toolrender/hyperlink.go` (not `display/terminal.go`) to avoid unnecessary cross-package coupling
- `NO_COLOR` conservatively disables hyperlinks (OSC 8 is an escape sequence; users who set NO_COLOR want plain text)
- Uses ESC+backslash (`\033\\`) as String Terminator per modern OSC 8 spec
- `file://` URIs work for local+cloud backend scenarios since CLI always runs locally; future cloud-workspace can set enabled=false

### Files Modified (Session 2)
- `client-apps/cli/pkg/toolrender/hyperlink.go` (new)
- `client-apps/cli/pkg/toolrender/hyperlink_test.go` (new)
- `client-apps/cli/pkg/toolrender/BUILD.bazel` (modified)

## Session Progress (2026-03-04, Session 3)

- Phase 2.1 (Read Tool Compact Rendering) completed
- Created `pkg/toolrender/render_compact.go` (96 lines) — `CompactOptions`, `RenderCompact`, `IsReadTool`, `renderCompactRead`, `buildHyperlinkedPath`, `bulletStyle`
- Created `pkg/toolrender/render_compact_test.go` (289 lines) — 22 test functions covering format, hyperlinks, fallback, errors
- Updated `cmd/stigmer/root/run_stream_inline.go` — added `compactOpts` field, HyperlinksEnabled init, read running suppression, `RenderCompact` routing
- Updated `pkg/toolrender/BUILD.bazel` — added new source and test files
- Committed as `5a87c60c`

### Key Design Decisions (Session 3)
- `RenderCompact` is a graduated entry point: read tools get compact format, all others fall back to `RenderWithBadge`. This enables incremental migration in Phases 2.2-2.4.
- `ToolRunningEvent` suppressed for read tools — reads complete in <100ms, showing both running and completed is redundant noise.
- `CompactOptions` struct follows DI-over-hard-coding: `HyperlinksEnabled` queried once at renderer init, `WorkingDir` left empty for now (most backend paths are absolute).
- `IsReadTool` derives from `toolDisplayMap` label (not hardcoded names), consistent with `IsShellTool` pattern.
- `buildHyperlinkedPath` is a standalone helper for reuse in subsequent compact renderers.
- OSC 8 / `stripANSI` gap confirmed NOT a blocker — compact output goes to stderr, never through width measurement functions.
- Read grouping (3+ sequential reads collapsed) deferred to Phase 2.1b.

### Files Modified (Session 3)
- `client-apps/cli/pkg/toolrender/render_compact.go` (new)
- `client-apps/cli/pkg/toolrender/render_compact_test.go` (new)
- `client-apps/cli/pkg/toolrender/BUILD.bazel` (modified)
- `client-apps/cli/cmd/stigmer/root/run_stream_inline.go` (modified)

## Session Progress (2026-03-04, Session 4)

- Phase 2.1b (Read Tool Consecutive-Event Grouping) completed
- Added `RenderReadGroup` and `renderGroupEntry` to `pkg/toolrender/render_compact.go` (+62 lines)
- Restructured `handleEvent` in `run_stream_inline.go` with pre-switch interception for read buffering (+33 lines net)
- Added 8 new test functions to `render_compact_test.go` (+135 lines)
- Committed as `7b3ad46e`

### Key Design Decisions (Session 4)
- **Consecutive-event grouping** over time-based: events arrive from remote gRPC backend, network latency makes arrival time unreliable. Consecutive ordering is deterministic and testable.
- **Smart truncation**: `maxVisibleInGroup = 3`, show all when count <= 4 (avoid pointless "+1 more"), truncate to 3 + "… +N more" for 5+.
- **Pre-switch interception pattern**: Read completions, read running events, and tool stream deltas intercepted before the main switch in `handleEvent`. The switch only sees events that produce visible output.
- **ToolStreamDeltaEvent excluded from flush**: Concurrent streaming tools (shell) must not break read grouping.
- **`IsReadTool` removed from `renderToolRunning`**: Reads never reach the switch, so the guard is unnecessary.

### Files Modified (Session 4)
- `client-apps/cli/pkg/toolrender/render_compact.go` (modified)
- `client-apps/cli/pkg/toolrender/render_compact_test.go` (modified)
- `client-apps/cli/cmd/stigmer/root/run_stream_inline.go` (modified)

## Session Progress (2026-03-04, Session 5)

- Phase 2.2 (Write/Edit Tool Compact Rendering) completed
- Extended `pkg/toolrender/render_compact.go` (+106 lines, now 280 lines) — 6 new functions: `RenderCompactRunning`, `IsWriteOrEditTool`, `isWriteOrEditLabel`, `hasCompactRenderer`, `completedVerb`, `renderCompactWrite`
- Extended `pkg/toolrender/render_compact_test.go` (+494 lines) — 30 new test functions covering write/edit/create compact format, running state, hyperlinks, fallback, errors
- Changed `cmd/stigmer/root/run_stream_inline.go` (1-line change) — `renderToolRunning` now uses `RenderCompactRunning`
- Committed as `3dfcef8e`

### Key Design Decisions (Session 5)
- **No emoji badges** — Structure communicates state. Result summary line = done. Error line with `✗` = failed. Dim `…` suffix = running. Matches Claude Code's professional aesthetic.
- **Running events NOT suppressed for write/edit** — Writes have observable latency (user confirmed from real Cursor usage). Dim `…` suffix prevents "is it stuck?" anxiety.
- **`RenderCompactRunning`** is a new graduated entry point for running state. Uses `hasCompactRenderer` registry — as Phases 2.3-2.4 add compact renderers, running events automatically get compact formatting.
- **`completedVerb`** maps labels to past-tense verbs (Wrote/Created/Edited) via simple switch.
- **Line count from `resolveDisplayContent`** — Write tools correctly count from args content (the file being written), not the result confirmation message.
- **Waiting-approval state untouched** — Verbose gutter preview intentionally kept for approval decisions. Richer approval UX is Phase 3 scope.

### Files Modified (Session 5)
- `client-apps/cli/pkg/toolrender/render_compact.go` (modified)
- `client-apps/cli/pkg/toolrender/render_compact_test.go` (modified)
- `client-apps/cli/cmd/stigmer/root/run_stream_inline.go` (modified)

## Session Progress (2026-03-04, Session 6)

- Phase 2.3 (Shell Tool Compact Rendering) completed
- Extended `pkg/toolrender/render_compact.go` (+93 lines, now 373 lines) — 4 new functions: `renderCompactShell`, `isShellLabel`, `firstLine`, plus `maxShellOutputLines` constant
- Extended `pkg/toolrender/render_compact_test.go` (+411 net lines) — 25 new test functions covering shell compact format, output truncation, smart cutoff, failures, command truncation, multiline commands, legacy result cleaning, aliases, running state, firstLine helper
- Updated `hasCompactRenderer` to include "Shell" and "Execute" labels
- Updated `RenderCompactRunning` to handle shell tools (command truncation instead of hyperlinked paths)
- Replaced 2 existing shell fallback tests with compact-format equivalents
- No changes to `run_stream_inline.go` — graduated routing picks up shell automatically

### Key Design Decisions (Session 6)
- **No exit code display** — ToolCallInfo has no ExitCode field; parsing from result text is fragile and coupled to backend format. Claude Code reference doesn't show exit codes either. Status communicated through structure: output lines = success, `✗` = failed. Confirmed with user as Option A.
- **Command truncation at 60 chars** — Shell commands can be very long (unlike file paths). Truncated in header for scannability; full command visible from AI message in scrollback.
- **`firstLine` helper** — Defensive sanitization for commands with embedded newlines. Extracts first line before truncation to prevent broken multi-line headers.
- **Smart cutoff** — Same pattern as read groups: show all when count <= maxShellOutputLines + 1 (avoids pointless "+1 more lines" footer).
- **`isShellLabel`** — Internal predicate covering "Shell" and "Execute" labels (the 2 labels mapped from 6 shell tool names in `toolDisplayMap`).
- **`RenderCompactRunning` refactored** — Now shell-aware: uses `truncate(firstLine(...), 60)` for shell tools instead of `buildHyperlinkedPath` (commands aren't file paths).

### Files Modified (Session 6)
- `client-apps/cli/pkg/toolrender/render_compact.go` (modified)
- `client-apps/cli/pkg/toolrender/render_compact_test.go` (modified)

## Session Progress (2026-03-04, Session 7)

- Phase 2.4 (Other Tools Compact Rendering) completed
- Extended `pkg/toolrender/render_compact.go` (+205 lines, now 578 lines) — 3 new renderers: `renderCompactDiscovery`, `renderCompactDelete`, `renderCompactThink`; 2 helpers: `countResultEntries`, `discoverySummary`; 2 predicates: `isDiscoveryLabel`, `isPatternBasedLabel`; `maxThinkLines` constant
- Extended `pkg/toolrender/render_compact_test.go` (+821 lines) — 51 new test functions covering discovery/delete/think compact format, running state, item counting, summary text, hasCompactRenderer coverage
- Refactored `RenderCompact` from if-cascade to switch-on-label (6 branches)
- Refactored `RenderCompactRunning` to handle pattern-based (plain text), path-based (hyperlinked), and label-only (Thinking, no parens) tools
- Updated `hasCompactRenderer` to cover all 11 tool labels — only "Task" remains uncovered (Phase 2.5)
- No changes to `run_stream_inline.go` — graduated routing picked up all new tools automatically

### Key Design Decisions (Session 7)
- **Discovery tools show count-only** — Discovery is reconnaissance input to the agent, not output for the user. Count provides scope awareness without noise. Maintains visual density hierarchy (shell densest, reads lightest). Confirmed via UX/Engineering/Architecture analysis.
- **`countResultEntries` vs `countLines`** — Discovery results need non-empty line counting (skips blank lines, trims trailing newline), unlike `countLines` which is designed for file content. Same split pattern as `renderCompactShell`.
- **`discoverySummary` label-aware** — List uses "N entries" (neutral for files/dirs), Find/Search use "Found N matches" (searching). Proper singular/plural handling.
- **Think bypasses `resolveDisplayContent`** — The think tool's `tc.Result` is a meaningless "ok" acknowledgment. Extracting thought directly from args via `contentArgField` avoids displaying "ok" when thought is empty. Documented as intentional deviation.
- **Think header has no parens** — `● Thinking` instead of `● Thinking()`. The thought is the body, not a parameter. Only tool where the `Label(arg)` pattern is dropped.
- **Pattern-based vs path-based display** — `isPatternBasedLabel` distinguishes Find/Search (plain text patterns, not hyperlinked) from List/Delete (file paths, hyperlinked). Avoids wrapping glob patterns in `file://` URIs.
- **Switch-on-label routing** — Replaced if-cascade with switch for `RenderCompact`. Case lists (`"Write", "Create", "Edit"`) group related labels. Default branch handles Task (Phase 2.5) and unknown tools via `RenderWithBadge`.

### Files Modified (Session 7)
- `client-apps/cli/pkg/toolrender/render_compact.go` (modified)
- `client-apps/cli/pkg/toolrender/render_compact_test.go` (modified)

## Session Progress (2026-03-04, Session 8)

- Phase 2.5 (Sub-Agent Tool Grouping) completed
- Added `IsTaskTool`, `GutterWrap`, `BulletGreen`, `LabelBold` to `render_compact.go` (+55 lines)
- Updated `hasCompactRenderer` to cover all 12 known labels (Task now included)
- Added `RenderCompactRunning` Task branch (`● Task: description …`)
- Introduced `pendingRead` wrapper struct in `run_stream_inline.go` to tag reads with `subAgentID`
- Added 6 pre-switch interceptions: task tool suppression, sub-agent AI redirection to stderr with gutter prefix
- Updated `renderToolRunning`/`renderToolCompleted` to gutter-wrap for sub-agent context
- Rewrote `renderSubAgentStarted` (bullet Task header) and `renderSubAgentCompleted` (Done/Failed footer)
- Updated `flushPendingReads` to extract ToolCallInfo slice and apply `GutterWrap` for sub-agent context
- Added 18 new tests, updated 3 existing tests in `render_compact_test.go` (+267 lines)

### Key Design Decisions (Session 8)
- **Reuse, don't reinvent** — Inner tools use existing `RenderCompact*` + `GutterWrap`, no parallel sub-agent renderers
- **Task tool events suppressed** — Lifecycle events carry richer data than tool events
- **Sub-agent AI on stderr, non-streaming** — Preserves `stdout = main agent data` contract
- **`pendingRead` wrapper** — Minimal structural change enabling gutter-aware flush without breaking buffering invariant
- **Always expanded** — Collapse/expand deferred to Phases 3-4 (terminal cursor control)

### Files Modified (Session 8)
- `client-apps/cli/pkg/toolrender/render_compact.go` (modified)
- `client-apps/cli/pkg/toolrender/render_compact_test.go` (modified)
- `client-apps/cli/cmd/stigmer/root/run_stream_inline.go` (modified)

## Session Progress (2026-03-04, Session 9)

- Phase 3.0 (Terminal Cursor Control Primitives) completed
- Created `pkg/termctl/termctl.go` (113 lines) — 7 public functions: `IsSupported`, `MoveUp`, `ClearDown`, `ClearLine`, `EraseLines`, `Width`, `DisplayRows`
- Created `pkg/termctl/termctl_test.go` (296 lines) — 37 test functions covering ANSI output, no-op guards, atomicity, DisplayRows with wrapping/ANSI/edge cases
- Created `pkg/termctl/BUILD.bazel` — Bazel build targets with `charmbracelet/x/ansi` and `golang.org/x/term` deps

### Key Design Decisions (Session 9)
- **`IsSupported` does NOT check `NO_COLOR`** — Cursor control (collapse after approval) is a UX mechanism, not color decoration. Users who disable color still benefit from content management. Only checks TTY + TERM!=dumb.
- **`EraseLines` is atomic** — Builds full ANSI sequence (`\033[nA\r\033[J`) and writes in a single `Write` call, preventing interleaving with concurrent output.
- **`DisplayRows` uses `charmbracelet/x/ansi.StringWidth`** — Already a dependency. Handles CSI, OSC 8, and Unicode width correctly. No custom ANSI stripping needed.
- **`MoveUp(w, 0)` is a no-op** — ANSI spec treats `\033[0A` as "move up 1" (0 defaults to 1). Guard prevents accidental cursor displacement.
- **Free functions over struct** — Stateless DI-compliant functions. Every function takes `io.Writer` or pure parameters. No `os.Stdout` references. Struct can be added later if call sites become noisy.
- **New package `pkg/termctl/`** — Not an extension of `display/` (which is stdout-hardcoded formatting) or `spinner/` (which has private helpers). Separate concern, separate package.

### Files Created (Session 9)
- `client-apps/cli/pkg/termctl/termctl.go` (new)
- `client-apps/cli/pkg/termctl/termctl_test.go` (new)
- `client-apps/cli/pkg/termctl/BUILD.bazel` (new)

## Session Progress (2026-03-04, Session 10)

- Phase 3.1 (Custom Inline Prompter) completed
- Created `pkg/approval/keyread.go` (178 lines) — `keyCode` type, `keyReader` with persistent goroutine, `readKey` with escape sequence parsing (50ms timeout), `drain` for stale input, priority-select `readByte`
- Created `pkg/approval/inline_prompter.go` (164 lines) — `InlinePrompter` struct (DI: `io.Reader` + `io.Writer`), `Prompt` (Prompter interface), `PromptWithLineCount` (returns decision + line count for Phase 3.3), raw mode lifecycle, `renderMenu`/`rerenderMenu` via `termctl.EraseLines`
- Created `pkg/approval/inline_prompter_test.go` (417 lines) — 30 test functions
- Updated `pkg/approval/BUILD.bazel` — added new files + `termctl` and `golang.org/x/term` deps

### Key Design Decisions (Session 10)
- **Two-file SRP split**: `keyread.go` (byte-to-keycode decoding) and `inline_prompter.go` (prompt orchestration). Each file has one reason to change.
- **Persistent reader goroutine**: One goroutine per prompter lifetime, avoids race conditions from multiple goroutines competing for the same fd. Dormant between prompts (blocked on `Read` in cooked mode), active during prompts (raw mode).
- **Priority-select in readByte**: Two-phase select pattern ensures buffered bytes are consumed before EOF errors. Without this, Go's random channel selection caused a race when the reader goroutine hit EOF while bytes remained in the channel.
- **Menu layout**: Vertical compact, 4 lines total (3 options + 1 hint). Labels: "Yes", "Skip", "Reject". Deviated from original spec's descriptions — approval context is printed by the caller above the menu, descriptions are redundant.
- **Escape sequence disambiguation**: 50ms timeout after `\033` distinguishes standalone Esc from arrow key sequences (`\033[A`, `\033[B`).
- **Stale input draining**: `drain()` empties byte channel before each prompt to prevent buffered keystrokes from triggering unintended selections.
- **Rejection comments deferred**: Text input in raw mode requires readline-like functionality — Phase 4 scope. `Decision.Comment` always empty from `InlinePrompter`.
- **Interface compliance**: `InlinePrompter` implements `Prompter` (drop-in replacement). Phase 3.3 calls `PromptWithLineCount` directly for cursor integration.

### Files Created/Modified (Session 10)
- `client-apps/cli/pkg/approval/keyread.go` (new)
- `client-apps/cli/pkg/approval/inline_prompter.go` (new)
- `client-apps/cli/pkg/approval/inline_prompter_test.go` (new)
- `client-apps/cli/pkg/approval/BUILD.bazel` (modified)

## Session Progress (2026-03-04, Session 11)

- Phase 3.2 (Approval Result Rendering Primitives) completed
- Created `pkg/toolrender/render_approval.go` (269 lines) — 3 public functions: `RenderApprovalResult`, `ApprovalSeparator`, `ApprovalQuestion`; 8 internal helpers: `approvalBullet`, `renderApprovalHeader`, `buildApprovalConnector`, `approvedSummary`, `approvalVerb`, `shouldShowApprovalPreview`, `formatApprovalPreview`, `renderApprovalUnknown`
- Created `pkg/toolrender/render_approval_test.go` (581 lines) — 38 test functions covering all action/tool-type combinations, preview truncation, smart cutoff, hyperlinks, arg fallbacks, separator, question verbs
- Updated `pkg/toolrender/BUILD.bazel` — added new source and test files

### Key Design Decisions (Session 11)
- **Action-colored bullets**: green `●` (approved), red `●` (rejected), dim `●` (skipped). Provides at-a-glance status without reading connector text.
- **No path repetition in `└` connector**: Header already shows path via `Label(path)`. Connector shows only the summary ("Wrote 241 lines", "Rejected", "Skipped"). Consistent with existing compact format.
- **`action` as string, not `approval.Action`**: Uses `"approve"`, `"skip"`, `"reject"` strings (matching `ApprovalResponse` protocol) to avoid `toolrender` depending on `approval` package.
- **Separate `render_approval.go` file**: `render_compact.go` was already 578 lines with a distinct concern (compact status display). Approval rendering is a separate concern (approval flow display) with its own constants, styles, and helper set. Follows SRP pattern: `render.go`, `render_compact.go`, `render_known.go`, `hyperlink.go`, `render_approval.go`.
- **`shouldShowApprovalPreview` predicate**: Centralizes the preview-visibility rules: no preview for skip (user doesn't care), no preview for approved shell (output streams separately in Phase 3.4), no preview for delete (no content body). Keeps `RenderApprovalResult` clean.
- **`formatApprovalPreview` takes raw content**: Decoupled from `ToolCallInfo`/`toolDisplayInfo` so it can serve both known tools (via `resolveDisplayContent`) and unknown tools (via `tc.Result`).
- **`ApprovalQuestion` verb mapping**: Write/Create → "create", Edit → "edit", Shell/Execute → "execute", Delete → "delete", unknown → "run {toolName}". Shell commands truncated to 60 chars with multiline sanitization.
- **Smart cutoff (10+1)**: Shows all lines when count <= 11, truncates to 10 + "… +N more lines" for 12+. Same pattern as shell (3+1), think (3+1), and read groups (3+1).

### Files Created/Modified (Session 11)
- `client-apps/cli/pkg/toolrender/render_approval.go` (new)
- `client-apps/cli/pkg/toolrender/render_approval_test.go` (new)
- `client-apps/cli/pkg/toolrender/BUILD.bazel` (modified)

## Session Progress (2026-03-04, Session 12)

- Phase 3.3 (Rewrite handleApproval — Expand / Prompt / Collapse / Suppress) completed
- Created `cmd/stigmer/root/run_stream_inline_approval.go` (216 lines) — approval orchestrator extracted from `run_stream_inline.go` for SRP compliance. Contains `handleApproval` (entry point dispatching to interactive/non-interactive), `handleNonInteractiveApproval` (fast path), `handleInteractiveApproval` (full expand/prompt/collapse), `resolveApprovalContext` (state lookup with fallback), `buildExpandedView` (header+separator+content+separator), `promptForDecision` (type-assert to InlinePrompter, fallback to Prompter), `handlePromptError`, `printCollapsedResult`, `trackSuppression`
- Created `cmd/stigmer/root/run_stream_inline_approval_test.go` (21 tests) — comprehensive coverage: approve/skip/reject collapse, non-interactive fast path, ToolCompletedEvent suppression, sub-agent gutter-wrapping, prompt error fallback, state lifecycle
- Added 3 public functions to `pkg/toolrender/render_approval.go` (+59 lines): `ExpandedApprovalHeader` (green bullet header for pre-decision view), `ExpandedApprovalContent` (public wrapper around `resolveDisplayContent`), `ShouldSuppressCompletion` (predicate for write/edit/delete suppression)
- Added 17 new tests to `pkg/toolrender/render_approval_test.go` for the 3 new functions
- Structural changes to `run_stream_inline.go`: added `waitingApprovalState` struct, `waitingApproval`, `suppressedToolIDs`, `lastRenderedRunningID` fields; `renderToolRunning` tracks ID; `renderToolWaitingApproval` saves state only (no visual output); pre-switch interception for ToolCompletedEvent suppression
- Updated call sites (`run_agent_exec.go`, `run_session.go`) to use `NewInlinePrompter(os.Stdin, os.Stderr)` for inline mode
- Updated `BUILD.bazel` — added new files and `termctl` dep

### Key Design Decisions (Session 12)
- **SRP extraction**: Approval orchestration is a distinct concern from event dispatch. Extracted to `run_stream_inline_approval.go` (216 lines) keeping `run_stream_inline.go` focused on event routing.
- **Type-assert, don't change interface**: `promptForDecision` type-asserts `cfg.prompter` to `*InlinePrompter` for `PromptWithLineCount`. Falls back to `Prompter.Prompt()` with lineCount=0 (graceful degradation — no collapse on non-InlinePrompter).
- **renderToolWaitingApproval becomes silent**: All visual output moved to `handleApproval` which needs full line count for collapse. Saves `ToolCallInfo` + `subAgentID` + `runningLineRendered` in `waitingApprovalState`.
- **Non-interactive fast path**: When `defaultAction` is set, skips expanded view entirely — erases running line, prints collapsed result directly. No content review needed for predetermined decisions.
- **Selective ToolCompletedEvent suppression**: Write/edit/delete completions suppressed (their `RenderApprovalResult` already shows the summary). Shell completions NOT suppressed (output only arrives via completion event until Phase 3.4). Reject never suppresses (no completion follows). `ShouldSuppressCompletion` predicate in toolrender package.
- **Pre-switch interception ordering**: Approval suppression checked after read grouping but before task tool suppression. Flush pending reads first to avoid losing buffered reads.
- **Prompter call site switching**: `run_agent_exec.go` and `run_session.go` conditionally create `InlinePrompter` vs `InteractivePrompter` based on `outputMode`. `run_handlers.go` (workflow) keeps `InteractivePrompter` (workflow doesn't use inline renderer).

### Files Created/Modified (Session 12)
- `client-apps/cli/cmd/stigmer/root/run_stream_inline_approval.go` (new — 216 lines)
- `client-apps/cli/cmd/stigmer/root/run_stream_inline_approval_test.go` (new — 21 tests)
- `client-apps/cli/cmd/stigmer/root/run_stream_inline.go` (modified — structural changes)
- `client-apps/cli/cmd/stigmer/root/run_agent_exec.go` (modified — prompter switch)
- `client-apps/cli/cmd/stigmer/root/run_session.go` (modified — prompter switch)
- `client-apps/cli/cmd/stigmer/root/BUILD.bazel` (modified — new files + termctl dep)
- `client-apps/cli/pkg/toolrender/render_approval.go` (modified — 3 new public functions)
- `client-apps/cli/pkg/toolrender/render_approval_test.go` (modified — 17 new tests)

## Next Steps

1. ~~Phase 3: Claude Code-Style Approval Flow (REVISED)~~ DONE
   - ~~3.0: Terminal cursor control primitives (pkg/termctl)~~ DONE
   - ~~3.1: Custom inline prompter (arrow-key menu, raw mode, line counting)~~ DONE
   - ~~3.2: Four-state tool rendering (streaming → approval → collapse with └ connector)~~ DONE
   - ~~3.3: Rewrite handleApproval (orchestrate expand/prompt/collapse/suppress)~~ DONE
   - ~~3.4: Shell tool approval variant + enable ToolStreamDeltaEvent streaming~~ DONE
2. ~~Phase 4: Inline follow-up readline + thinking spinner~~ DONE
   - ~~4.0: Thinking spinner (mid-run idle indicator)~~ DONE
   - ~~4.1: Post-completion follow-up readline loop~~ DONE
3. ~~Phase 5: Dead Code Cleanup and TUI Removal~~ DONE
   - ~~5.1: Remove TUI path from root package~~ DONE
   - ~~5.2: Remove TUI-only files from executiontui (~95KB)~~ DONE
   - ~~5.3: Remove dead exports across packages~~ DONE
   - ~~5.4: Overlap consolidation (no migration needed)~~ DONE
   - ~~5.5: Verify and polish~~ DONE

## Session Progress (2026-03-04, Session 13)

- Phase 3.4 (ToolStreamDeltaEvent Streaming) completed
- Created `cmd/stigmer/root/run_stream_inline_streaming.go` (115 lines) — 5 streaming methods + `clearStreamingState` helper: `initPreApprovalStreaming` (pre-approval write/edit typewriter), `initPostApprovalStreaming` (post-approval shell output), `renderToolStreamDelta` (append-only delta rendering), `completeStreamingTool` (erase+compact on completion), `resolveStreamContent` (content extraction with fallback)
- Created `cmd/stigmer/root/run_stream_inline_streaming_test.go` (597 lines) — 32 test functions covering pre-approval streaming, post-approval streaming, delta rendering, completion erasure, sub-agent gutter wrapping, graceful degradation, handleEvent routing, full end-to-end flows
- Modified `cmd/stigmer/root/run_stream_inline.go` (+52 lines) — added streaming state fields (`activeStreamToolID`, `toolStreamedBytes`, `streamHeaderRows`, `streamLineCount`, `streamSubAgentID`); extended `waitingApprovalState` with `contentStreamed`/`streamedRows`; added 3 pre-switch interceptions (conditional ToolStreamDelta routing, streaming tool completion interception, write/edit streaming initiation); `renderToolWaitingApproval` captures streaming state at transition
- Refactored `cmd/stigmer/root/run_stream_inline_approval.go` (+148/-55 lines) — extracted `prepareApprovalDisplay` (content-streamed vs expanded view), `finalizeApproval` (collapse/shell-streaming/suppress); `resolveApprovalContext` returns 5 values; both interactive and non-interactive paths support content-already-streamed and shell post-approval streaming
- Updated `cmd/stigmer/root/run_stream_inline_approval_test.go` (+23 lines) — updated `resolveApprovalContext` tests for new return values; renamed `TestHandleApproval_DoesNotSuppressShellCompletion` to `TestHandleApproval_ShellApproval_InitiatesStreaming` to verify streaming path
- Updated `pkg/toolrender/render_approval.go` (+5/-3 lines) — updated `ShouldSuppressCompletion` docstring to reflect shell completion now handled by streaming interception
- Updated `cmd/stigmer/root/BUILD.bazel` (+2 lines) — added new source and test files
- Committed as `b8dddb12`

### Key Design Decisions (Session 13)
- **`toolStreamedBytes` (not `streamedBytes`)**: Renamed to avoid field collision with existing AI streaming state field in `inlineRenderer`. Both track byte offsets for delta rendering but for different concerns (AI message streaming vs tool content streaming).
- **Full-content row recomputation on each delta**: `streamLineCount = streamHeaderRows + DisplayRows(fullContent, width)` recomputed from the full accumulated content. Avoids partial-line overcounting from summing per-delta row counts. O(n) per delta is acceptable — terminal output is bounded and string scanning is fast.
- **No indentation during shell streaming**: Live output printed raw to match direct execution experience. On completion, `RenderCompact` applies standard indent + dim styling + truncation. Clean visual transition: ephemeral real-time feedback → permanent compact record.
- **Streaming tools bypass `suppressedToolIDs`**: Post-approval shell completions intercepted by `activeStreamToolID` check (before `suppressedToolIDs` check). Natural separation: streaming tools → `completeStreamingTool`, non-streaming approval tools → `suppressedToolIDs`.
- **`resolveStreamContent` prefers `e.Content`**: Shell output arrives in `Content` field. Write/edit content lives in Args (accessed via `ExpandedApprovalContent` fallback). This is defensive and backend-behavior-agnostic.
- **SRP refactoring of `handleInteractiveApproval`**: Extracted `prepareApprovalDisplay` and `finalizeApproval` to keep all functions under 50 lines. Three distinct display paths: content-already-streamed (add separator only), standard expanded view (full render), and post-approval streaming (shell running header).

### Files Created/Modified (Session 13)
- `client-apps/cli/cmd/stigmer/root/run_stream_inline_streaming.go` (new — 115 lines)
- `client-apps/cli/cmd/stigmer/root/run_stream_inline_streaming_test.go` (new — 32 tests)
- `client-apps/cli/cmd/stigmer/root/run_stream_inline.go` (modified — streaming state + routing)
- `client-apps/cli/cmd/stigmer/root/run_stream_inline_approval.go` (modified — refactored with streaming paths)
- `client-apps/cli/cmd/stigmer/root/run_stream_inline_approval_test.go` (modified — updated tests)
- `client-apps/cli/cmd/stigmer/root/BUILD.bazel` (modified — new files)
- `client-apps/cli/pkg/toolrender/render_approval.go` (modified — docstring update)

## Session Progress (2026-03-04, Session 14)

- Phase 4.0 (Thinking Spinner) completed
- Created `cmd/stigmer/root/run_stream_inline_spinner.go` (62 lines) — 4 methods on `inlineRenderer`: `startThinkingSpinner` (guarded activation), `stopThinkingSpinner` (synchronous clear), `resetThinkTimer` (conditional timer reset), `thinkingAllowed` (state predicate)
- Created `cmd/stigmer/root/run_stream_inline_spinner_test.go` (14 tests) — covers `thinkingAllowed` under all state combinations (6 tests), timer reset/stop (2 tests), spinner guards (2 tests), event integration (4 tests including full event loop with idle gap)
- Modified `cmd/stigmer/root/run_stream_inline.go` (+28 lines) — added `spinner`, `thinkTimer`, `phase` fields to `inlineRenderer`; added timer initialization with drain in `renderInline`; added third `select` case for timer fire; `stopThinkingSpinner`/`resetThinkTimer` called on every event; `phase` tracked in `renderPhaseChange`
- Phase 4.1 (Follow-Up Readline Loop) completed
- Created `cmd/stigmer/root/run_stream_inline_followup.go` (83 lines) — `runInlineFollowUpLoop` (outer loop wrapping `renderInline`), `readFollowUpInput` (bufio.Scanner prompt on stderr), `isFollowUpEligible` (allows `completed`/`failed` phases)
- Created `cmd/stigmer/root/run_stream_inline_followup_test.go` (16 tests) — covers `isFollowUpEligible` for all phases (6 tests), `readFollowUpInput` with input/trim/empty/EOF (4 tests), loop flow: nil followUpFn, non-eligible phase, empty input, error, successful follow-up, failed-phase corrective follow-up (6 tests)
- Modified `cmd/stigmer/root/run_stream.go` (+15 lines) — `streamAgentInline` now accepts `orgID`, builds `followUpFn` when session exists, delegates to `runInlineFollowUpLoop`; `streamAgentExecution` passes `orgID` through
- Modified `cmd/stigmer/root/run_session.go` (+12 lines) — `resumeSession` inline path uses `runInlineFollowUpLoop` with `buildFollowUpFn`, fetches final execution by `latestExecID`
- Updated `cmd/stigmer/root/BUILD.bazel` (+4 lines) — added 4 new files (2 source, 2 test)

### Key Design Decisions (Session 14)
- **Reuse `pkg/spinner`**: No new spinner code. Existing spinner handles TTY detection, goroutine lifecycle, and `\r\033[K` clearing. Spinner writes to stderr (cfg.status), consistent with all status output.
- **2-second idle threshold**: Matches TUI's `idleThreshold`. Prevents flicker during rapid tool cycling. Timer reset on every event; only fires after sustained silence.
- **`thinkingAllowed` predicate**: Centralizes the 4-condition guard (phase is `in_progress`, no AI stream, no tool stream, no approval pending). Both `startThinkingSpinner` and `resetThinkTimer` use it.
- **Timer drain on init**: `time.NewTimer(0)` immediately fires; `Stop()` + drain prevents a spurious spinner start at the beginning of the event loop.
- **`bufio.Scanner` over readline library**: Zero new dependencies. OS terminal provides line editing (backspace, arrow keys, Home/End) natively in cooked mode. No raw mode means no conflict with `InlinePrompter`. History recall deferred — can swap `readFollowUpInput` internals later without architectural changes.
- **`isFollowUpEligible` allows `failed` phase**: Matches TUI behavior where users can recover from failures by sending corrective instructions. Only `cancelled`, stream errors, and unknown phases exit.
- **Follow-up loop as outer wrapper**: `runInlineFollowUpLoop` wraps `renderInline`, keeping the event loop single-responsibility. Each iteration creates a fresh `inlineRenderer` — no stale state leaks between executions.
- **Both entry points wired**: `streamAgentInline` (live sessions) and `resumeSession` inline path (replayed history) both use the follow-up loop, matching TUI behavior.
- **`latestExecID` tracking**: The loop returns the most recent execution ID so `streamAgentEpilogue` and `resumeSession` fetch the correct final execution (which may be a follow-up, not the original).

### Files Created/Modified (Session 14)
- `client-apps/cli/cmd/stigmer/root/run_stream_inline_spinner.go` (new — 62 lines)
- `client-apps/cli/cmd/stigmer/root/run_stream_inline_spinner_test.go` (new — 14 tests)
- `client-apps/cli/cmd/stigmer/root/run_stream_inline_followup.go` (new — 83 lines)
- `client-apps/cli/cmd/stigmer/root/run_stream_inline_followup_test.go` (new — 16 tests)
- `client-apps/cli/cmd/stigmer/root/run_stream_inline.go` (modified — spinner/timer/phase integration)
- `client-apps/cli/cmd/stigmer/root/run_stream.go` (modified — orgID passthrough + follow-up loop)
- `client-apps/cli/cmd/stigmer/root/run_session.go` (modified — follow-up loop for resumed sessions)
- `client-apps/cli/cmd/stigmer/root/BUILD.bazel` (modified — new files)

## Session Progress (2026-03-04, Session 15)

- Phase 5 (Dead Code Cleanup and TUI Removal) completed
- **Phase 5.1**: Removed TUI path from root package
  - Deleted `run_tui.go` (80 lines — `runTUIWithProtection`, `restoreTerminal`)
  - Deleted `run_tui_test.go` (178 lines)
  - Removed `streamAgentInteractive` from `run_stream.go` (~70 lines) and `resumeSessionInteractive` from `run_session.go` (~50 lines)
  - Removed `OutputInteractive` constant and its `String()` case from `output_mode.go`
  - Changed switch pattern: inline is now the explicit `default`, JSON is `case OutputJSON`
  - Removed `tea` (Bubbletea) import from `run_stream.go`, `run_session.go`, and `BUILD.bazel` deps
  - Removed `session` import from `run_stream.go` (no longer needed after `streamAgentInteractive` removal)
- **Phase 5.2**: Removed TUI-only files from `executiontui`
  - Deleted 13 source files (~95KB): `model.go`, `update.go`, `handle_events.go`, `view.go`, `blocks.go`, `render_blocks.go`, `render_approval.go`, `approval.go`, `help.go`, `input.go`, `focus.go`, `scroll.go`, `messages.go`
  - Deleted 5 test files (~98KB): `update_test.go`, `render_blocks_test.go`, `approval_test.go`, `help_test.go`, `scroll_test.go`
  - Kept `events.go` (event types) and `followup.go` (FollowUpFn/FollowUpResult types)
  - Rewrote `followup.go` to remove TUI-specific `Model` methods (`handleFollowUpStarted`, `handleFollowUpError`)
  - Rewrote `doc.go` to reflect new scope as event/type definition package
  - Updated all TUI-referencing docstrings in `events.go` to be renderer-agnostic
  - Rewrote `BUILD.bazel` — 3 source files, 1 dep (`toolrender`), no Bubbletea/bubbles/lipgloss deps
- **Phase 5.3**: Removed dead exports across packages
  - `pkg/toolrender/render.go`: Removed 6 dead exports — `DisplayLabel`, `HasDisplayableContent`, `RenderRunning`, `RenderWaitingApproval`, `RenderExpanded`, `RenderExpandedWithBadge`
  - `pkg/toolrender/render_test.go`: Removed corresponding dead test functions (17 tests)
  - `pkg/termctl/termctl.go`: Removed `MoveUp`, `ClearDown`, `ClearLine` (zero callers; speculative Phase 3.0 code)
  - `pkg/termctl/termctl_test.go`: Removed corresponding tests (5 test functions)
  - `pkg/display/table.go`: Deleted entire file (~200 lines) — `ApplyResultTable` and all associated types/functions had zero callers
  - `internal/cli/cliprint/progress.go`: Removed `PhaseReady` constant (zero callers)
  - Updated `pkg/display/BUILD.bazel` to remove `table.go`
- **Phase 5.4**: Overlap consolidation — no migration needed
  - `display.GetTerminalWidth()` callers (2) correctly target stdout and benefit from `MinTermWidth` clamp
  - `tablerender.go` uses it internally — cannot be removed without creating a `display` → `termctl` dependency
  - Different semantics (convenience with clamp vs DI-flexible) justify coexistence
- **Phase 5.5**: Verification
  - `go vet ./client-apps/cli/...` — clean
  - `go build ./client-apps/cli/cmd/stigmer/` — clean
  - `go test ./client-apps/cli/pkg/toolrender/` — all pass
  - `go test ./client-apps/cli/pkg/termctl/` — all pass
  - `go test ./client-apps/cli/pkg/display/` — all pass
  - Root package: 3 pre-existing test failures confirmed (identical before and after changes via `git stash` isolation)

### Key Architectural Decisions (Session 15)
- **TUI alt-screen removed entirely** — Git history preserves it. The shared event system (`events.go`, `followup.go`) remains as the contract between stream producers and rendering consumers. `InteractivePrompter` (workflow approvals) and `cliprint/ProgressDisplay` (server start spinner) both use Bubbletea independently and are unaffected.
- **`RenderResultWithPreview` kept** — Confirmed alive in `run_display_stream.go` (workflow rendering path), not TUI-only.
- **`StateBadge`, `RenderWithBadge` kept** — Used by `render_compact.go` (inline renderer path).
- **Internal helpers preserved** — `formatFullResultWithGutter`, `extractFilename`, `resolveDisplayContent` all have live callers in compact/approval rendering paths.

### Files Deleted (Session 15)
- `client-apps/cli/cmd/stigmer/root/run_tui.go`
- `client-apps/cli/cmd/stigmer/root/run_tui_test.go`
- `client-apps/cli/pkg/executiontui/` — 13 source files + 5 test files
- `client-apps/cli/pkg/display/table.go`

### Files Modified (Session 15)
- `client-apps/cli/cmd/stigmer/root/output_mode.go`
- `client-apps/cli/cmd/stigmer/root/output_mode_test.go`
- `client-apps/cli/cmd/stigmer/root/run_stream.go`
- `client-apps/cli/cmd/stigmer/root/run_session.go`
- `client-apps/cli/cmd/stigmer/root/BUILD.bazel`
- `client-apps/cli/pkg/executiontui/events.go`
- `client-apps/cli/pkg/executiontui/followup.go`
- `client-apps/cli/pkg/executiontui/doc.go`
- `client-apps/cli/pkg/executiontui/BUILD.bazel`
- `client-apps/cli/pkg/toolrender/render.go`
- `client-apps/cli/pkg/toolrender/render_test.go`
- `client-apps/cli/pkg/termctl/termctl.go`
- `client-apps/cli/pkg/termctl/termctl_test.go`
- `client-apps/cli/pkg/display/BUILD.bazel`
- `client-apps/cli/internal/cli/cliprint/progress.go`

## Context for Resume

- **`cmd/stigmer/root/run_stream_inline_spinner.go`** is the thinking spinner module (Phase 4.0). Four methods on `inlineRenderer`: `startThinkingSpinner` (guarded `spinner.Start("Thinking...")`), `stopThinkingSpinner` (synchronous `spinner.Stop()`), `resetThinkTimer` (resets 2s timer when `thinkingAllowed`, stops otherwise), `thinkingAllowed` (returns true when phase is `in_progress`, no AI stream, no tool stream, no approval pending). State tracked via `spinner *spinner.Spinner`, `thinkTimer *time.Timer`, `phase string` on `inlineRenderer`. Timer integrated as third `select` case in `renderInline`'s event loop.
- **`cmd/stigmer/root/run_stream_inline_followup.go`** is the follow-up loop module (Phase 4.1). `runInlineFollowUpLoop(ctx, cfg, followUpFn, executionID)` wraps `renderInline` in a conversational loop — after `DoneEvent`, prompts for input via `readFollowUpInput`, creates follow-up execution via `followUpFn`, swaps channels, and loops. `readFollowUpInput(status)` prints `\n> ` to stderr, reads one line from stdin via `bufio.Scanner`. `isFollowUpEligible(phase, exitErr)` gates on `completed`/`failed` phases with no exit error. Both `streamAgentInline` and `resumeSession` inline path use this loop.
- **`cmd/stigmer/root/run_stream_inline_streaming.go`** is the tool content streaming module (Phase 3.4). Five methods on `inlineRenderer`: `initPreApprovalStreaming` (prints header+separator, sets state for write/edit typewriter), `initPostApprovalStreaming` (prints compact running header, sets state for shell output), `renderToolStreamDelta` (append-only delta rendering, recomputes row count from full content), `completeStreamingTool` (erases streaming output via cursor control, prints compact result), `resolveStreamContent` (prefers `e.Content`, falls back to `ExpandedApprovalContent`). Plus `clearStreamingState` helper. Streaming state tracked via `activeStreamToolID`, `toolStreamedBytes`, `streamHeaderRows`, `streamLineCount`, `streamSubAgentID` on `inlineRenderer`.
- **`cmd/stigmer/root/run_stream_inline_approval.go`** is the approval orchestrator (Phase 3.3 + 3.4). Entry point `handleApproval(r, e)` dispatches to `handleNonInteractiveApproval` or `handleInteractiveApproval`. The interactive path uses `prepareApprovalDisplay` (content-already-streamed: add separator only; non-streamed: full expanded view), prompt orchestration, and `finalizeApproval` (erase + collapse or shell streaming). `resolveApprovalContext` returns 5 values including `contentStreamed` and `streamedRows`. Shell approval calls `initPostApprovalStreaming` instead of `printCollapsedResult`. `trackSuppression` adds to `suppressedToolIDs` for non-shell tools; shell completions are handled by the streaming interception in `handleEvent`.
- **`pkg/toolrender/render_approval.go`** is the approval rendering module (Phase 3.2 + 3.3). Six public functions: `RenderApprovalResult` (collapsed post-decision view), `ApprovalSeparator` (dim separator), `ApprovalQuestion` (contextual question), `ExpandedApprovalHeader` (green bullet pre-decision header), `ExpandedApprovalContent` (full display content for expanded view), `ShouldSuppressCompletion` (predicate: write/edit/create/delete → true, shell → false — shell completions handled by streaming interception).
- **`pkg/approval/inline_prompter.go`** is the new inline-mode approval prompter (Phase 3.1). `InlinePrompter` accepts `io.Reader` (input) + `io.Writer` (output) — fully DI-compliant. `Prompt(ctx, opts)` implements `Prompter` interface (drop-in replacement for `InteractivePrompter`). `PromptWithLineCount(ctx, opts)` returns `(*Decision, int, error)` — the `int` is the exact row count (always `menuLines = 4`) for Phase 3.3 cursor collapse. Non-interactive fast path when `fd == -1` (non-TTY) or `opts.NonInteractive`. Raw mode via `term.MakeRaw`/`term.Restore` with deferred cleanup. Menu re-rendering via `termctl.EraseLines`.
- **`pkg/approval/keyread.go`** is the keystroke decoder for `InlinePrompter`. `keyReader` runs a persistent goroutine that reads one byte at a time from `io.Reader` and sends to a buffered channel (cap 64). `readKey(ctx)` returns typed `keyCode` values (keyUp, keyDown, keyEnter, keyEsc, keyCtrlC, keyOne, keyTwo, keyThree, keyUnknown). Escape sequence parsing uses 50ms timeout to distinguish standalone Esc from arrow keys (`\033[A`/`\033[B`). `drain()` empties the byte channel before each prompt. `readByte` uses a two-phase priority-select pattern: try bytes channel without blocking first, then wait on bytes/errs/ctx — this prevents a race where EOF arrives while unconsumed bytes remain in the channel.
- **`pkg/termctl/`** is the ANSI cursor control package (Phase 3.0). 7 public functions: `IsSupported(w)` (TTY+not-dumb, NO_COLOR excluded), `MoveUp(w, n)`, `ClearDown(w)`, `ClearLine(w)`, `EraseLines(w, n)` (atomic), `Width(w, default)`, `DisplayRows(text, width)`. All stateless, DI-compliant (io.Writer params). Used by Phase 3.2-3.3 for approval collapse and by `InlinePrompter` for menu re-rendering. `DisplayRows` uses `charmbracelet/x/ansi.StringWidth` for ANSI-aware width measurement.
- Pre-existing compile error in `run_create.go:114` (references `WorkspaceSource` from multi-source-workspace project) blocks `go test` for the `root` package. Our changes are isolated and verified correct via `go vet`.
- The `OutputInteractive` constant has been removed from `output_mode.go` — TUI path fully excised. Only `OutputInline` (default) and `OutputJSON` remain.
- **`RenderCompact`** is the graduated entry point for compact completed tool rendering. Every known tool label now has a compact renderer. Task still falls back to `RenderWithBadge` (its visual representation comes from lifecycle events, not RenderCompact). Only unknown/MCP tools lack compact renderers.
- **`RenderCompactRunning`** is the graduated entry point for compact running state. All tools with compact renderers get bullet-style `…` suffix. Display varies by category: shell (truncated command), pattern-based (plain text), path-based (hyperlinked), label-only (Thinking, no parens), Task (`● Task: description …`). Only unknown tools fall back to legacy `⏳`.
- **`hasCompactRenderer`** covers all 12 known labels: Read, Write, Create, Edit, Shell, Execute, List, Find, Search, Delete, Thinking, Task.
- `CompactOptions` is initialized once in `renderInline()` with `HyperlinksEnabled` from `cfg.status` and an empty `WorkingDir` (relative path resolution deferred until working directory is available from execution context).
- **Read grouping**: `handleEvent` intercepts read completions before the switch and buffers them in `pendingReads` (as `pendingRead` structs carrying `subAgentID`). `flushPendingReads()` renders as group (>= 3) or individually (< 3), applying `GutterWrap` when `subAgentID != ""`. Flush triggers on any non-read visible event, context cancel, or channel close. `ToolStreamDeltaEvent` does NOT flush (no visible output).
- **ToolRunningEvent for reads**: Suppressed (intercepted before switch). For all other tools: NOT suppressed — uses `RenderCompactRunning`.
- **Sub-agent tool grouping (Phase 2.5)**: Task tool events (ToolRunning/ToolCompleted for "task") suppressed in pre-switch — lifecycle events (`SubAgentStarted`/`SubAgentCompleted`) handle header/footer. Sub-agent AI events redirected: Start/Delta suppressed, End/Message emitted to stderr with `GutterWrap`. All sub-agent tool events (`renderToolRunning`/`renderToolCompleted`) gutter-wrapped when `SubAgentID != ""`. `GutterWrap(s)` prepends dim `  │ ` to each line. `BulletGreen`/`LabelBold` expose package-private styles for lifecycle handlers.
- **Shell output truncation**: `maxShellOutputLines = 3` with smart cutoff. Think uses `maxThinkLines = 3` with same pattern.
- **Discovery result counting**: `countResultEntries` counts non-empty lines (not `countLines`). `discoverySummary` maps label to human-readable text.
- **Think content extraction**: Directly from `contentArgField` ("thought") arg, bypassing `resolveDisplayContent` to avoid showing meaningless "ok" result.
- **OSC 8 / `stripANSI` gap**: NOT a blocker — compact output goes to stderr via `statusf`, never through width measurement.
- **Bazel test blocked** by pre-existing `com_github_alecthomas_chroma_v2` repository resolution issue. All tests verified via `go test` directly.

## Blockers

None.

## Quick Commands

After loading context:
- "Show project status" - Get overview of progress
- "Create PR" - Create a pull request for the branch

## Quick Resume
To continue this project, drag this file into chat:
`@_projects/2026-03/20260304.02.inline-first-cli/next-task.md`

---

*This file provides direct paths to all project resources for quick context loading.*
