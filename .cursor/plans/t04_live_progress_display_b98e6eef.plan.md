---
name: T04 Live Progress Display
overview: Implement structured tool call rendering and an inline activity spinner for agent execution streaming, so users always know what's happening and tool calls are readable and categorized.
todos:
  - id: t04-1-toolrender
    content: Create pkg/toolrender/ — render.go + render_test.go + BUILD.bazel. Structured tool call renderer with category-aware icons.
    status: completed
  - id: t04-2-display
    content: Enhance displayAgentMessage in run_display.go — type-aware rendering for AI (with tool calls), TOOL (concise result), SYSTEM (dimmed).
    status: completed
  - id: t04-3-spinner
    content: Create pkg/spinner/ — spinner.go + spinner_test.go + BUILD.bazel. ANSI line spinner with elapsed time, non-TTY safe.
    status: completed
  - id: t04-4-integration
    content: Integrate spinner in run_stream.go — stop/start around messages, approvals, phase changes. Apply to both agent and workflow streaming.
    status: completed
  - id: t04-5-build
    content: Update BUILD.bazel deps, run bazel build + bazel test, verify all tests pass.
    status: completed
isProject: false
---

# T04: Live Progress & Structured Tool Display

## Three Architecture Decisions (Before We Code)

These deviate from the original T04 plan in the revised plan doc. I want to discuss them before implementation.

### Decision 1: ANSI spinner, not Bubbletea

The original plan says "Bubbletea spinner with elapsed time." I recommend against this.

**Problem with Bubbletea for the spinner:**

- Only one `tea.Program` can own the terminal at a time. The approval prompt (`[pkg/approval/prompt_model.go](client-apps/cli/pkg/approval/prompt_model.go)`) is already a Bubbletea program. Two cannot coexist.
- Bubbletea manages terminal state (cursor position, raw mode). This conflicts with `fmt.Println` calls that the streaming loop uses for messages.
- To make it work, we'd need to stop the Bubbletea spinner before every `fmt.Println` and restart after, or restructure the entire streaming loop into a single Bubbletea model. Both options add significant complexity for a simple spinner.

**ANSI spinner instead:**

- A goroutine writes spinner frames using `\r` (carriage return) to overwrite the current line.
- To clear: write `\r\033[K` (return to start + clear to end of line).
- No terminal ownership — the approval prompt's Bubbletea program starts/stops independently.
- This is the pattern Docker, npm, cargo, and kubectl all use. Battle-tested, predictable, ~80 lines.

**Existing precedent:** The existing `cliprint/progress.go` (Bubbletea-based) works for a different lifecycle: start → run phases → stop. It never interleaves with streaming output. Our spinner must coexist with the streaming loop's `fmt.Println` calls.

### Decision 2: Both new packages in `pkg/`, not `internal/`

The original plan says `internal/cli/spinner/` and `internal/cli/toolrender/`. I recommend `pkg/spinner/` and `pkg/toolrender/`.

**Reasoning:**

- The spinner is a purely generic UI utility — no domain knowledge. Belongs in `pkg/`.
- The tool renderer has tool-name knowledge (same as `approval/formatter.go`), but `approval/formatter.go` is already in `pkg/` and sets the precedent. Per the coding guidelines: "`pkg/` — reusable utilities (no business logic, no imports from `internal/`)."
- Both packages follow the same placement pattern as `[pkg/panel/](client-apps/cli/pkg/panel/panel.go)` and `[pkg/display/](client-apps/cli/pkg/display/terminal.go)`.

### Decision 3: Keep tool categories separate from approval formatter (for now)

`[pkg/approval/formatter.go](client-apps/cli/pkg/approval/formatter.go)` has a `toolCategories` map (~15 entries) mapping tool names to categories. The new `pkg/toolrender/` will need similar knowledge.

**Options considered:**

- **Extract to shared `pkg/toolinfo/**` — clean, DRY, but premature (only 2 consumers, ~15 entries)
- **Duplicate** — small maintenance cost, follows YAGNI
- **Have toolrender import from approval** — wrong dependency direction

**Recommendation:** Duplicate for now. When a third consumer appears or the list exceeds ~30 entries, extract then. This aligns with the T03 decision: "Approval formatter kept separate from future tool call renderer — different purposes."

---

## Data Flow Understanding

The streaming loop in `[run_stream.go](client-apps/cli/cmd/stigmer/root/run_stream.go)` receives full `AgentExecution` state on each gRPC update. Messages arrive in order:

```
AI message (content + tool_calls[]) → TOOL message (result) → TOOL message (result) → AI message → ...
```

- **AI messages** (`MESSAGE_AI`): The `msg.ToolCalls` field contains structured `ToolCall` protos with `Name`, `Args`, `Status`. This is what the tool renderer uses.
- **TOOL messages** (`MESSAGE_TOOL`): The `msg.Content` contains the result text. The message itself doesn't carry the tool name, so we display a concise result summary.
- `**execution.Status.ToolCalls**`: Full tool call list with statuses. Available but not needed in the message display loop — AI messages already carry tool call info.

---

## Implementation Plan

### Subtask 1: `pkg/toolrender/` — Structured Tool Call Renderer

**New file:** `client-apps/cli/pkg/toolrender/render.go` (~130 lines)

```go
// Package toolrender formats tool call information for structured CLI display.

type ToolCallInfo struct {
    Name     string
    Args     map[string]interface{}
    Status   string        // "pending", "running", "completed", "failed"
    Result   string        // tool result text (may be empty)
    Error    string        // error message if failed
    Duration time.Duration // 0 if unavailable
}

// Render returns a single-line structured display of a tool call.
// Example: "📖 Read: inputs/agent-api.proto (1.0 KB)"
func Render(tc ToolCallInfo) string

// RenderResult returns a compact display of a tool result.
// Used for MESSAGE_TOOL messages where we have the result but not the tool name.
// Example: "↳ 1164 chars" or "↳ exit 0 (1.2s)"
func RenderResult(content string) string
```

**Tool categories** (same concept as approval formatter, different rendering):

- Shell/command tools → `🖥  Shell: <command>` + exit code/timing on completion
- File read tools → `📖 Read: <path>` + result size
- File write tools → `📝 Write: <path>` + result size
- File delete tools → `⚠️  Delete: <path>` (warning styling)
- Unknown tools → `🔧 <name>: <first arg value>`

**Key principle:** Accept primitive types (strings, maps), not proto types. Keeps the package decoupled from proto definitions — same pattern as `approval.FormatArgs(toolName, argsPreview string)`.

**Tests:** `render_test.go` (~180 lines) — each tool category, unknown tools, empty/nil args, result formatting, duration display.

### Subtask 2: Enhanced Message Display in `run_display.go`

**Modified file:** `[client-apps/cli/cmd/stigmer/root/run_display.go](client-apps/cli/cmd/stigmer/root/run_display.go)`

Rewrite `displayAgentMessage` to be type-aware:

- **MESSAGE_AI**: Print content. If `msg.ToolCalls` is non-empty, render each tool call below using `toolrender.Render()`. This shows the user what tools the agent is invoking, structured by category.
- **MESSAGE_TOOL**: Instead of dumping raw `msg.Content`, show a concise tool result line using `toolrender.RenderResult()`. Truncate long results with size info.
- **MESSAGE_SYSTEM**: Dimmed styling (using lipgloss) to visually separate from AI and tool messages.
- **MESSAGE_HUMAN**: Keep as-is (user's own input).

**New helper:** `displayToolCalls(toolCalls []*agentexecutionv1.ToolCall)` — iterates over tool calls from an AI message, converts proto `ToolCall` to `toolrender.ToolCallInfo`, and prints each.

**Conversion note:** `ToolCall.Args` is `*structpb.Struct` — convert to `map[string]interface{}` via `args.AsMap()`.

### Subtask 3: `pkg/spinner/` — ANSI Line Spinner

**New file:** `client-apps/cli/pkg/spinner/spinner.go` (~100 lines)

```go
// Package spinner provides a lightweight terminal activity indicator.
// It animates on a single line using ANSI escape codes and is safe
// to use alongside fmt.Println and Bubbletea programs.

type Spinner struct { ... }

func New(w io.Writer) *Spinner     // create spinner writing to w (usually os.Stdout)
func (s *Spinner) Start(label string) // begin animation goroutine
func (s *Spinner) Update(label string) // change label without restart
func (s *Spinner) Stop()              // clear spinner line, stop goroutine
func (s *Spinner) IsActive() bool     // check if spinner is running
```

**Behavior:**

- Animation frames: `⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏` (braille dots, standard CLI pattern)
- Elapsed time shown: `⠹ Agent is thinking... (3s)`
- Frame interval: ~80ms
- `Start()` launches a goroutine; `Stop()` signals it and waits for cleanup
- `Stop()` clears the line with `\r\033[K` before returning
- Non-TTY detection via `[display.IsTerminal()](client-apps/cli/pkg/display/terminal.go)`: no animation, no output
- Thread-safe: `Start`/`Stop`/`Update` can be called from any goroutine

**Tests:** `spinner_test.go` (~120 lines) — start/stop lifecycle, label updates, elapsed time progression, non-TTY mode (no output), concurrent safety.

### Subtask 4: Spinner Integration in `run_stream.go`

**Modified file:** `[client-apps/cli/cmd/stigmer/root/run_stream.go](client-apps/cli/cmd/stigmer/root/run_stream.go)`

Add spinner lifecycle management around the existing streaming loop:

```go
func streamAgentExecution(...) (*agentexecutionv1.AgentExecution, error) {
    // ... existing setup ...
    
    sp := spinner.New(os.Stdout)
    sp.Start("Waiting for agent...")

    for {
        execution, err := stream.Recv()
        // ... error handling ...

        // Phase changes
        if execution.Status.Phase != lastPhase {
            sp.Stop()
            displayAgentPhaseChange(execution.Status.Phase)
            sp.Start(spinnerLabelForPhase(execution.Status.Phase))
            lastPhase = execution.Status.Phase
        }

        // Approval flow
        if needsAgentApprovalPrompt(...) {
            sp.Stop()
            // ... existing approval handling ...
            sp.Start("Resuming after approval...")
        }

        // New messages
        if len(execution.Status.Messages) > messageCount {
            sp.Stop()
            for i := messageCount; i < len(execution.Status.Messages); i++ {
                displayAgentMessage(execution.Status.Messages[i])
            }
            sp.Start("Agent is thinking...")
            messageCount = len(execution.Status.Messages)
        }

        // Terminal state
        if isTerminalAgentPhase(execution.Status.Phase) {
            sp.Stop()
            displayAgentExecutionComplete(execution)
            return execution, nil
        }
    }
}
```

Apply the same pattern to `streamWorkflowExecution`.

**New helper:** `spinnerLabelForPhase(phase) string` — maps execution phases to human-readable spinner labels.

### Subtask 5: BUILD.bazel + Build Verification

- New: `client-apps/cli/pkg/spinner/BUILD.bazel`
- New: `client-apps/cli/pkg/toolrender/BUILD.bazel`
- Modified: `[client-apps/cli/cmd/stigmer/root/BUILD.bazel](client-apps/cli/cmd/stigmer/root/BUILD.bazel)` — add deps for `//client-apps/cli/pkg/spinner` and `//client-apps/cli/pkg/toolrender`
- Run `bazel build` and `bazel test` to verify

---

## What This Does NOT Include (Deferred to T05)

- Word-wrapping AI messages at terminal width (lipgloss word-wrap is a polish item)
- Non-TTY graceful degradation (spinner already handles it; message formatting is T05)
- Execution summary improvements (T05)
- Error panels (T05)

---

## Risk: Tool Call Data Availability

The plan assumes AI messages have `msg.ToolCalls` populated by the backend. If this field is empty in practice (backend doesn't populate it), the structured tool call display degrades gracefully — AI messages display their text content as before, and TOOL messages show concise results. **No architectural risk, just a visual degradation.** I'll verify this early in Subtask 2 and flag it if the field is empty.