---
name: Phase 2.3 Shell Compact
overview: Add compact rendering for shell tool calls in the inline CLI experience. Shell completions display as a bullet-style header with the command, followed by truncated output lines (up to 3) with a "... +N more" footer. Running state uses the established dim ellipsis suffix. No exit code parsing — success/failure communicated through structure (output lines vs error marker).
todos:
  - id: render-compact-shell
    content: Add `renderCompactShell`, `isShellLabel`, `maxShellOutputLines` constant, and output truncation logic to `render_compact.go`
    status: completed
  - id: register-shell-compact
    content: Update `RenderCompact` routing and `hasCompactRenderer` registry to include shell/execute labels
    status: completed
  - id: tests-shell-compact
    content: Add ~20 shell compact test functions and update the 2 existing shell fallback tests in `render_compact_test.go`
    status: completed
  - id: verify-build
    content: Run `go vet` and `bazel test` to confirm compilation and all tests pass
    status: completed
isProject: false
---

# Phase 2.3: Shell Tool Compact Rendering

## Design Decisions (Confirmed)

- **No exit code display** (Option A confirmed): Status communicated through structure, matching Claude Code reference and Session 5 design principle ("no badges"). Success = output lines. Failure = error marker.
- **Running state NOT suppressed**: Shell commands have observable latency (unlike reads). The `...`  ellipsis suffix signals liveness. Same rationale as write/edit from Session 5.
- **Command truncation**: Long commands truncated to 60 chars in the header to keep it scannable. 60 is the same limit used for error truncation in read/write renderers. Full command is already visible from the AI message above in scrollback.
- **Output lines limit**: 3 lines (new constant `maxShellOutputLines = 3`), matching the read group truncation pattern (`maxVisibleInGroup = 3`).
- **No inline renderer changes needed**: `renderToolRunning` already calls `RenderCompactRunning`, and `renderToolCompleted` already calls `RenderCompact`. Shell tools will automatically get compact format once registered.

## Target Visual Output

**Success with output:**

```
● Shell(go test ./...)
    ok  pkg/foo  0.5s
    ok  pkg/bar  1.2s
    ok  pkg/baz  0.3s
    … +15 more lines
```

**Success with short output (no truncation):**

```
● Shell(ls *.go)
    main.go
    util.go
```

**Success with no output:**

```
● Shell(mkdir -p tmp)
    (no output)
```

**Failed:**

```
● Shell(go build ./...)
    ✗ compilation failed
```

**Running:**

```
● Shell(go test ./...) …
```

**Long command (truncated):**

```
● Shell(find /Users/suresh/scm/github.com/stigmer/stigmer -t...)
    file1.go
    …
```

## Files to Modify

### 1. `[client-apps/cli/pkg/toolrender/render_compact.go](client-apps/cli/pkg/toolrender/render_compact.go)`

This is the only production code file that changes. All additions follow established patterns.

**New constant:**

- `maxShellOutputLines = 3` — output lines to show before truncation

**New function: `renderCompactShell`**

- Extract command from args via `extractPrimaryArgWithFallbacks`
- Truncate command to 60 chars for header
- Header: `● Shell(<truncated command>)` using bulletStyle + labelStyle (same as read/write)
- Error path: `✗ <error message>` (same pattern as `renderCompactRead`/`renderCompactWrite`)
- Success path: Clean output via `resolveDisplayContent` (which already calls `CleanShellResult` for shell tools), split into lines, show up to `maxShellOutputLines`, add `… +N more lines` footer when truncated
- Empty output: show dim `(no output)` on line 2

**New predicate: `isShellLabel`**

- Returns true for `"Shell"` and `"Execute"` labels (the two labels used by the 6 shell tool names in `toolDisplayMap`)

**Updated `RenderCompact`:**

- Add `isShellLabel(info.label)` branch before the fallback, routing to `renderCompactShell`

**Updated `hasCompactRenderer`:**

- Add `"Shell", "Execute"` to the switch

**New predicate: `IsShellTool` export check** — `IsShellTool` already exists in [render.go](client-apps/cli/pkg/toolrender/render.go) (line 207). No new predicate needed; `isShellLabel` is the internal routing helper.

### 2. `[client-apps/cli/pkg/toolrender/render_compact_test.go](client-apps/cli/pkg/toolrender/render_compact_test.go)`

**New test functions (~20 tests):**

- `TestRenderCompact_Shell_BasicFormat` — command + output lines, correct structure
- `TestRenderCompact_Shell_NoExitCode` — verify no "exit" text in output
- `TestRenderCompact_Shell_OutputTruncation` — >3 lines shows `… +N more lines`
- `TestRenderCompact_Shell_ShortOutput` — <=3 lines, no truncation footer
- `TestRenderCompact_Shell_NoOutput` — "(no output)" on line 2
- `TestRenderCompact_Shell_Failed` — `✗` + error message
- `TestRenderCompact_Shell_FailedEmptyError` — fallback to "failed"
- `TestRenderCompact_Shell_FailedLongError` — error truncation
- `TestRenderCompact_Shell_LongCommandTruncated` — command >60 chars truncated with `...`
- `TestRenderCompact_Shell_NoGutterPreview` — no `│` or `⋮`
- `TestRenderCompact_Shell_NoEmojiBadge` — no `🖥` or `✓` or `⏳`
- `TestRenderCompact_Shell_LegacyResultCleaned` — legacy `Exit code: 0\nSTDOUT:\n...` cleaned
- `TestRenderCompact_Shell_BashAlias` — `bash` tool name gets same treatment
- `TestRenderCompact_Shell_ExecuteAlias` — `execute_command` etc. get same treatment
- `TestRenderCompactRunning_ShellTool_CompactFormat` — bullet + command + `…`
- `TestRenderCompactRunning_ShellTool_LongCommandTruncated` — running state also truncates
- `TestRenderCompactRunning_ShellTool_SingleLine` — verify single line output

**Updated existing test:**

- `TestRenderCompact_ShellTool_FallsBackToRenderWithBadge` — **remove or rename** to verify shell now gets compact format (no longer a fallback)
- `TestRenderCompactRunning_ShellTool_FallsBackToLegacy` — **remove or rename** to verify shell running now gets compact format

### 3. No changes to inline renderer

`[run_stream_inline.go](client-apps/cli/cmd/stigmer/root/run_stream_inline.go)` already routes through `RenderCompact` and `RenderCompactRunning`. Shell tools will automatically pick up compact rendering once registered in `hasCompactRenderer`. Zero coupling — this is the beauty of the graduated entry point pattern.

### 4. No changes to BUILD.bazel

`[BUILD.bazel](client-apps/cli/pkg/toolrender/BUILD.bazel)` already lists `render_compact.go` and `render_compact_test.go`. No new files are created.

## Verification

- `go vet ./client-apps/cli/pkg/toolrender/...` — compile check (full `go test` blocked by pre-existing `run_create.go` issue)
- All new tests pass via Bazel: `bazel test //client-apps/cli/pkg/toolrender:toolrender_test`
- Existing tests unchanged (TUI rendering, `RenderWithBadge`, `Render`, etc.)

## What This Phase Does NOT Change

- `ToolStreamDeltaEvent` handling — still suppressed in inline mode. Live-updating shell output is a future enhancement.
- `ToolCallInfo` struct — no new fields added.
- TUI rendering — alt-screen TUI still uses `RenderWithBadge`/`RenderExpandedWithBadge`.
- Approval flow for shell tools — still uses verbose gutter preview (Phase 3 scope).

