# Task T01: Architecture & Design for Interactive CLI Experience

**Created**: 2026-02-14
**Status**: PENDING REVIEW
**Type**: Feature Development — Architecture & Design

> **This plan requires your review before execution.**

---

## The Problem (as experienced today)

When a user runs `stigmer draft skill` (or any command that triggers an agent execution), this is what they experience:

```
ℹ Invoking skill-creator-agent...
ℹ Execution ID: aex-01khdegb65nmndrw54sq8gt7vq

ℹ Waiting for execution to complete...
✓ Streaming agent execution logs

ℹ ⏳ Execution pending...

⚠ ⏸️  Approval required

🤖 Agent: I'll create an agent-drafter skill...  [WALL OF TEXT]

🔧 Tool: read(path='inputs/agent-api.proto') -> 1164 chars
🔧 Tool: read(path='inputs/agent-spec.proto') -> 11679 chars
...

✓ ✅ Execution completed
```

### What's wrong with this:

1. **"Approval required" is a black box.** The user sees "Approval required" but doesn't know *which tool* needs approval, *what arguments* it's using, or *why* approval is needed — until they scroll past the agent's long message to find the approval panel buried below.

2. **No live streaming feel.** The `--follow` flag runs gRPC streaming in a background goroutine (`go streamAgentExecutionLogs`) while `waitForExecution` polls every 2s in the foreground. These race each other. Without `--follow`, there's zero incremental feedback — just silence, then a dump of all messages.

3. **Tool calls are one-liners.** `🔧 Tool: read(path='inputs/agent-api.proto') -> 1164 chars` gives no structure. What *kind* of tool is this? Is it a file read? A shell command? An API call? The user can't distinguish safe operations from dangerous ones.

4. **Dead silence between phases.** Between "Execution pending..." and messages appearing, the terminal shows nothing. No spinner, no elapsed time, no indication the system is alive.

5. **Flat visual hierarchy.** Agent messages, tool calls, phase changes, and approvals all use the same visual weight: `icon label: content`. Nothing stands out. The user can't scan the output to find what matters.

6. **Approval prompt is invisible in the flow.** The Survey prompt ("What would you like to do?") appears inline after the approval details, with no visual separation. If the agent produced a long message before the approval, the prompt might be off-screen.

---

## Root Causes in Code

### 1. Streaming/Polling Race (`draft_skill_handler.go`)

```go
// Lines 67-74: These run concurrently and conflict
if opts.Follow {
    go streamAgentExecutionLogs(exec.Metadata.Id, conn)  // Background: real-time
}
exec, err = waitForExecution(exec.Metadata.Id, conn)     // Foreground: polling
```

The streaming goroutine writes to stdout while the polling loop also writes to stdout. Both check terminal state independently. Neither coordinates with the other.

### 2. Approval Display (`run_display_approval.go`)

```go
// Lines 15-48: Approval is displayed as plain text
func displayPendingApproval(approval *agentexecutionv1.PendingApproval) {
    fmt.Println(strings.Repeat("─", 60))     // Thin separator, easily missed
    cliprint.PrintWarning("APPROVAL REQUIRED")
    fmt.Printf("   Tool: %s\n", approval.ToolName)        // Buried detail
    fmt.Printf("   Message: %s\n", approval.Message)      // No emphasis
    // ... args preview in raw indented JSON ...
}
```

No visual panel, no color differentiation, no clear call-to-action.

### 3. Message Display (`run_display.go`)

```go
// Lines 41-62: All messages use identical format
func displayAgentMessage(msg *agentexecutionv1.AgentMessage) {
    fmt.Printf("%s %s: %s\n\n", icon, label, msg.Content) // Same format for everything
}
```

A 500-character agent message and a 20-character tool result get identical treatment.

---

## Proposed Architecture

### Design Principle: Streaming-First, Information-Rich, Visually Layered

The CLI should feel like watching a live feed of an intelligent system working — not like reading a log file after the fact.

### Phase 1 (T02): Streaming-First Execution Engine

**Goal**: Make real-time streaming the default. Eliminate the polling/streaming race.

**Changes**:

| File | Change |
|---|---|
| `draft_skill_handler.go` | Remove `go streamAgentExecutionLogs` + `waitForExecution` dual path. Replace with a single `runStreamingExecution()` that streams by default, polls only in non-TTY mode. |
| `run_stream.go` | Refactor `streamAgentExecutionLogs` to be the primary execution path, not a background observer. Return the final execution state. |
| `run_handlers.go` | `waitForExecution` becomes the non-TTY fallback only. |
| `draft_skill.go` | Remove `--follow` flag (always stream when TTY). Add `--no-stream` for CI/pipe use. |

**New execution flow**:
```
TTY mode (default):
  createExecution → streamExecution → [handle approvals inline] → return final state

Non-TTY mode (--no-stream or piped):
  createExecution → pollExecution → return final state
```

### Phase 2 (T03): Rich Approval Experience

**Goal**: When approval is needed, the user should instantly understand *what*, *why*, and *what their options are*.

**New approval display**:
```
╭──────────────────────────────────────────────────────────────╮
│  ⚡ APPROVAL REQUIRED                                        │
│                                                              │
│  Tool:  execute_shell                                        │
│  Agent: skill-creator-agent                                  │
│                                                              │
│  Command:                                                    │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ python3 scripts/init_skill.py \                        │  │
│  │   --name "agent-drafter" \                             │  │
│  │   --output outputs/                                    │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │ Working dir: /workspace                                │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  Reason: Agent wants to initialize the skill directory       │
│  Waiting: 3s                                                 │
╰──────────────────────────────────────────────────────────────╯

  ❯ ✅ Approve — Execute the tool
    ⏭️  Skip — Continue without executing
    ❌ Reject — Stop the execution
```

**Key improvements**:
- Box-drawn panel makes the approval visually distinct from everything else
- Tool type categorization (shell, file read, file write, API call) with appropriate icons
- Arguments displayed in context (e.g., shell command shown as a command, not raw JSON)
- Reason/message prominently displayed
- Clear action options with consequences explained

**Changes**:

| File | Change |
|---|---|
| `run_display_approval.go` | Complete rewrite with box-drawing, categorized tool display, smart arg formatting |
| `pkg/approval/interactive.go` | Enhanced prompt with descriptive options and keyboard shortcuts |
| New: `pkg/approval/formatter.go` | Tool-type-aware argument formatter (shell commands, file ops, API calls) |
| New: `internal/cli/panel/panel.go` | Reusable box-drawing panel renderer |

### Phase 3 (T04): Live Progress & Structured Tool Display

**Goal**: The user should always know what's happening.

**3a. Progress indicators**:
```
⏳ Waiting for agent to start... (3s)
▶  Agent is thinking...
🔧 Executing: read(inputs/agent-api.proto)
▶  Agent is thinking...
🔧 Executing: execute_shell(python3 init_skill.py ...)  ← requires approval
```

- Spinner animation during "thinking" phases
- Elapsed time shown during waits
- Current tool execution shown inline

**3b. Structured tool call display**:

Instead of `🔧 Tool: read(path='inputs/agent-api.proto') -> 1164 chars`, show:

```
  📖 Read file: inputs/agent-api.proto (1.0 KB)
```

For shell commands:
```
  🖥  Shell: python3 scripts/init_skill.py --name "agent-drafter"
      ↳ exit code 0 (1.2s)
```

For write operations:
```
  📝 Write file: outputs/SKILL.md (4.2 KB)
```

**Changes**:

| File | Change |
|---|---|
| `run_display.go` | Rewrite `displayAgentMessage` with type-aware rendering. AI messages get word-wrap. Tool messages get structured display. |
| New: `internal/cli/spinner/spinner.go` | Terminal spinner with elapsed time |
| New: `internal/cli/toolrender/render.go` | Smart tool call renderer that parses tool name/args and renders contextually |
| `run_stream.go` | Integrate spinner between message events. Show tool execution inline. |

### Phase 4 (T05): Polish & Graceful Degradation

**Goal**: Handle every environment gracefully. Make the experience feel intentional in every detail.

**5a. Non-TTY graceful degradation**:
- No spinners, no box drawing, no interactive prompts
- Plain text with clear labels
- `--approve-default approve` for CI pipelines
- JSON output mode (`--output json`) for programmatic consumption

**5b. Visual polish**:
- Consistent use of dim/bright colors for visual hierarchy
- Truncation of long content with "show more" hint
- Clean separator lines between execution phases
- Execution summary with timing breakdown

**5c. Error display**:
- Structured error panels (similar to approval panels)
- Clear error categorization (network, auth, agent, tool)
- Actionable suggestions in error messages

---

## Task Breakdown

| Task | Description | Estimated Effort | Dependencies |
|------|-------------|-----------------|--------------|
| **T02** | Streaming-first execution engine | 2-3 days | None |
| **T03** | Rich approval experience with panels | 2-3 days | T02 (streaming must work first) |
| **T04** | Live progress & structured tool display | 2-3 days | T02 |
| **T05** | Polish, non-TTY degradation, error display | 1-2 days | T03, T04 |

### Implementation Order

```
T02 (Streaming Engine) ──→ T03 (Approval UX) ──→ T05 (Polish)
                       └──→ T04 (Progress/Tools) ──┘
```

T03 and T04 can be parallelized after T02 is complete.

---

## Key Technical Decisions to Validate

1. **Bubbletea vs enhanced plain text?**
   - Bubbletea gives us a full TUI model (spinners, panels, scrolling) but adds significant dependency and complexity.
   - Enhanced plain text with ANSI escape codes (via `fatih/color`) is simpler but limited.
   - **Recommendation**: Start with enhanced plain text + a lightweight panel renderer. Evaluate Bubbletea for T05 if we need more interactivity (e.g., scrollable tool output).

2. **Remove `--follow` flag?**
   - Proposal: Always stream when TTY is available. Add `--no-stream` as opt-out.
   - This is a **breaking change** for anyone scripting with `--follow`.
   - **Recommendation**: Deprecate `--follow` (make it a no-op with warning) rather than removing immediately.

3. **Tool argument formatting — how smart?**
   - Parse tool name to determine display format (shell → show command, read → show path, etc.)?
   - Or use generic JSON display with syntax highlighting?
   - **Recommendation**: Start with a small set of known tool types (shell, read, write) with special formatting. Fall back to formatted JSON for unknown tools.

4. **Approval auto-approve timeout?**
   - Should approvals time out and auto-approve/reject after N seconds?
   - Useful for unattended execution but risky.
   - **Recommendation**: No auto-timeout in interactive mode. Add `--approve-timeout 60s` flag for semi-attended use.

---

## Success Criteria for This Task (T01)

- [ ] Architecture is reviewed and approved
- [ ] Key technical decisions are validated
- [ ] Task breakdown is agreed upon
- [ ] Ready to begin T02 (Streaming-First Execution Engine)

## What I Need From You

1. **Review the proposed UX** — Does the approval panel mockup match your vision? Too much? Too little?
2. **Bubbletea vs plain text** — Any preference on TUI approach?
3. **Breaking changes** — Are you comfortable deprecating `--follow`?
4. **Priority** — Which aspect matters most to you right now? (Streaming? Approval clarity? Progress indication?)
5. **Anything I missed** — Any other pain points from your experience with the CLI?
