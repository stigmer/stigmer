---
name: Consolidate output through Bubbletea
overview: Eliminate the stdout/stderr cursor desync bug by routing ALL visual output through Bubbletea when in TTY mode. AI text streams character-by-character via Bubbletea View() (partial lines) and Println (complete lines), matching today's UX. Stdout writes are only emitted when stdout is piped/redirected (not a TTY), where they cannot affect the terminal cursor.
todos:
  - id: create-aistream-file
    content: "Create run_stream_inline_aistream.go: move AI rendering functions from render.go and add Bubbletea-aware logic (commitAIStreamLines, View() partial, piped stdout fallback)"
    status: completed
  - id: update-types
    content: Add dataIsTTY, aiStreamBuffer, aiStreamPrefix fields to inlineRenderer in run_stream_inline_types.go
    status: completed
  - id: add-messages
    content: Add aiStreamPartialMsg and aiStreamHideMsg to run_stream_inline_messages.go
    status: completed
  - id: update-bubbletea
    content: Add aiStreamActive/aiStreamPartial to model, Update cases, and View() priority in run_stream_inline_bubbletea.go
    status: completed
  - id: clean-render
    content: Remove moved functions from run_stream_inline_render.go
    status: completed
  - id: wire-datatty
    content: Set dataIsTTY in renderInline (run_stream_inline.go) and update stopThinkingSpinner comment
    status: completed
  - id: update-build
    content: Register new file in BUILD.bazel
    status: completed
  - id: verify
    content: Run go vet and all existing tests to confirm no regressions
    status: completed
isProject: false
---

# Consolidate All Visual Output Through Bubbletea

## Problem

AI text goes to stdout directly while tool renders go through Bubbletea on stderr. Both share the same terminal cursor. Bubbletea's View() re-renders (spinner ticks/stops) use ANSI cursor movements that can erase stdout content, causing tool renders to appear on the same line as AI text.

## Solution

When Bubbletea is active, route AI text through Bubbletea:

- **Complete lines** (after each `\n`): committed to scrollback via `program.Println`
- **Partial line** (between newlines): shown live in Bubbletea's `View()` at the terminal bottom
- **Stream end**: commit remaining partial + paragraph gap via `Println("")`

Stdout is only written when it is piped/redirected (not a TTY), where writes go to the pipe and cannot affect the terminal cursor. This preserves the `stigmer run "..." | grep` use case.

## Behavior Matrix

- **Normal TTY** (both stdout+stderr to terminal): AI text via Bubbletea only. No stdout writes. No cursor desync.
- **stdout piped** (`| grep`, `> file`): AI text via Bubbletea (visual) + stdout (pipe data). Safe because piped stdout does not affect terminal cursor.
- **Non-TTY / CI** (program=nil): Unchanged. AI text to stdout, status to stderr. No Bubbletea.

## Files to Change

### 1. NEW: `[run_stream_inline_aistream.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_aistream.go)` (~140 lines)

Extract AI streaming logic from `render.go` into a dedicated file. Contains:

- `renderAIStreamStart` -- when program != nil: set `aiStreamPrefix`, init buffer, send `aiStreamPartialMsg`. When piped, also write to stdout.
- `renderAIStreamDelta` -- when program != nil: append to buffer, call `commitAIStreamLines` for complete lines, send `aiStreamPartialMsg` with partial. When piped, also write to stdout.
- `renderAIStreamEnd` -- when program != nil: commit remaining partial + `Println("")` gap, send `aiStreamHideMsg`, record history. When piped, also write `\n\n` to stdout.
- `finishAIStreamIfNeeded` -- same pattern as `renderAIStreamEnd` but for interrupted streams.
- `renderAIMessage` -- when program != nil: commit full text via `Println` + `Println("")` gap. When piped, also write to stdout.
- `commitAIStreamLines` -- loop: find `\n` in buffer, commit complete line via `Println`, consume from buffer. Prefix applied to first line only.
- `agentPrefix` -- moved from render.go (unchanged).
- `recordAIMessage` -- moved from render.go (unchanged).

### 2. `[run_stream_inline_types.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_types.go)`

Add fields to `inlineRenderer`:

```go
// dataIsTTY is true when the data writer (stdout) is a terminal.
// When false (piped/redirected), AI text is also written to stdout
// for pipe consumers. When true, AI text flows only through Bubbletea.
dataIsTTY bool

// aiStreamBuffer holds the partial (incomplete) line being accumulated
// during AI streaming. Complete lines are committed via program.Println
// as each newline arrives; the remaining bytes stay here until the next
// newline or stream end.
aiStreamBuffer string

// aiStreamPrefix holds the "● " bullet prefix for the first line of an
// AI message. Consumed after the first line is committed, so subsequent
// lines have no prefix.
aiStreamPrefix string
```

### 3. `[run_stream_inline_messages.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_messages.go)`

Add two message types:

```go
// aiStreamPartialMsg updates the partial (incomplete) line shown in
// View() during AI streaming. Sent on every delta so the user sees
// character-level feedback. View() renders this as the live typing line
// at the terminal bottom.
type aiStreamPartialMsg struct {
    partial string
}

// aiStreamHideMsg clears the AI streaming state from the model.
// Sent when the stream ends or is interrupted. View() returns ""
// on the next render, allowing the spinner or other content to appear.
type aiStreamHideMsg struct{}
```

### 4. `[run_stream_inline_bubbletea.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_bubbletea.go)`

Add model state:

```go
type inlineBubbleModel struct {
    // ... existing fields ...
    aiStreamActive  bool   // true during AI text streaming
    aiStreamPartial string // partial line shown in View()
}
```

Add `Update` cases:

```go
case aiStreamPartialMsg:
    m.aiStreamActive = true
    m.aiStreamPartial = msg.partial
    return m, nil
case aiStreamHideMsg:
    m.aiStreamActive = false
    m.aiStreamPartial = ""
    return m, nil
```

Update `View()` priority -- insert between `followUpActive` and `spinnerActive`:

```go
if m.aiStreamActive {
    return m.aiStreamPartial
}
```

### 5. `[run_stream_inline_render.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_render.go)`

- **Remove**: `renderAIStreamStart`, `renderAIStreamDelta`, `renderAIStreamEnd`, `renderAIMessage`, `finishAIStreamIfNeeded`, `agentPrefix`, `recordAIMessage` (all moved to new file).
- **Remove**: the section comment "AI message rendering -- content goes to data writer (stdout)".
- **Update**: the file header comment if needed.
- This brings `render.go` from 375 lines down to ~305 lines.

### 6. `[run_stream_inline.go](client-apps/cli/cmd/stigmer/root/run_stream_inline.go)`

In `renderInline`, set `dataIsTTY` when constructing the renderer:

```go
r := &inlineRenderer{
    cfg:     cfg,
    dataIsTTY: termctl.IsSupported(cfg.data),
    // ... rest unchanged ...
}
```

### 7. `[run_stream_inline_spinner.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_spinner.go)`

Update `stopThinkingSpinner` comment to reflect the new architecture:

```go
// The stop is asynchronous — queued in Bubbletea's message channel.
// This is safe because all visual output (including AI text) flows
// through Bubbletea when a program is active, preserving ordering.
```

### 8. `[BUILD.bazel](client-apps/cli/cmd/stigmer/root/BUILD.bazel)`

Register `run_stream_inline_aistream.go` in the `srcs` list.

## What Does NOT Change

- `**statusf**` -- unchanged, already goes through Bubbletea.
- **Tool rendering** -- unchanged, already goes through `statusf`.
- **History / re-commit** -- unchanged, already entirely through Bubbletea `Println`.
- **Non-Bubbletea path** (program=nil) -- unchanged, all functions fall through to the existing `else` branch with direct stdout/stderr writes.
- **Sub-agent AI messages** -- already go through `statusf` (stderr), not stdout. Unchanged.
- `**--output json` mode** -- unrelated, writes to stdout directly. Unchanged.

## Testing Strategy

- Existing tests use `program=nil` (non-Bubbletea path). They exercise the `else` branches and should pass unchanged.
- New unit test: verify `commitAIStreamLines` correctly splits content at newlines, applies prefix to first line only, and leaves the partial remainder in the buffer.
- Manual verification: run a session that produces AI text followed by grouped reads and confirm the read group starts on its own line.

