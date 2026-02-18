# Task T01: Research & Design — Conversational Agent Execution UX

**Created**: 2026-02-17
**Status**: Planning
**Type**: Research → Design

---

## Problem Statement

The Stigmer CLI currently treats agent executions as **single-shot operations**: a command like `stigmer draft skill` creates an execution, streams output via a Bubbletea TUI, handles approval prompts, and exits. There is no mechanism for:

1. **User-initiated input during execution** — the agent cannot ask the user a question and receive an answer mid-execution.
2. **Conversational flow** — the user cannot provide follow-up instructions, corrections, or additional context while the agent is working.
3. **Agent-triggered sub-executions** — an agent cannot trigger another `stigmer run` or `stigmer draft` as part of its work.
4. **Session continuity** — each command is fully independent; there are no persistent sessions across commands.

Agents are conversational by nature, but the current CLI UX does not reflect that.

## Current Architecture (Summary)

```
stigmer draft skill / stigmer run <agent>
  └─ createAgentExecution() ← gRPC
  └─ streamAgentExecution() ← gRPC streaming subscription
      └─ Background goroutine: streamToEvents()
          ├─ Reads gRPC stream updates
          ├─ Converts proto → TUI events
          └─ Handles approval prompts (approve/skip/reject)
      └─ Bubbletea TUI
          ├─ Renders messages, tool calls, system events
          ├─ Auto-follows streaming output
          ├─ Handles user input (approval, scrolling, cancel)
          └─ Exits on terminal phase (completed/failed/cancelled)
```

**Key files:**
- `client-apps/cli/cmd/stigmer/root/run_stream.go` — streaming entry point
- `client-apps/cli/cmd/stigmer/root/run_stream_events.go` — gRPC → TUI events
- `client-apps/cli/pkg/executiontui/model.go` — Bubbletea TUI model
- `client-apps/cli/cmd/stigmer/root/draft_skill_handler.go` — draft skill handler

**What already works well:**
- Real-time streaming via gRPC
- Rich TUI with scrollable viewport, expandable tool calls
- Inline approval prompts (blocks execution until user decides)
- `--detach` mode for fire-and-forget
- `--auto-approve` for non-interactive CI usage

## Research: How Similar Tools Handle This

### Claude Code CLI (Anthropic)
- **Full REPL** — `claude` starts an interactive session; `claude "query"` for one-shot
- **Mid-execution input** — uses `AskUserQuestion` tool; pauses until user responds
- **Permission modes** — `plan` / `normal` / `auto-accept`, plus `--allowedTools` for pattern-based auto-approval
- **Keyboard shortcuts** — `Ctrl+C` cancel, `Esc+Esc` rewind/summarize, `Ctrl+O` toggle verbose
- **Non-interactive** — headless mode with `--output-format stream-json`

### GitHub Copilot CLI
- **Conversational with steering** — can queue messages while agent is thinking
- **Plan mode** — `Shift+Tab` toggles; analyzes and builds plan before code
- **Three-tier approval** — approve once / approve for session / reject with alternative instructions
- **Inline feedback** — when rejecting, user can provide corrective instructions

### Aider
- **REPL with modes** — `/ask` (discuss), `/code` (execute), `/architect` (two-model planning)
- **Slash commands** — `/add`, `/commit`, etc. for navigation
- **Binary approval** — interactive prompts or `--yes` auto-approve
- **Non-interactive** — `--message` / `--message-file` with `--yes`

### OpenAI Codex CLI
- **Full TUI** — Bubbletea-based (similar to current Stigmer TUI)
- **Rules-based approval** — `.rules` files with `allow` / `prompt` / `forbidden` decisions
- **Sandbox modes** — `none`, `network-none`, `workspace-read`, `workspace-write`
- **Slash commands** — `/model` to switch models mid-session

### Cline CLI
- **Interactive + headless** — auto-detects TTY, `-y` for auto-approve
- **Plan/Act toggle** — `Tab` key switches modes
- **Pipeable** — `git diff | cline -y "explain" | cline -y "commit message"`
- **Parallel agents** — multiple isolated instances via terminal panes

### Common Patterns Observed

| Pattern | Tools | Relevance to Stigmer |
|---------|-------|---------------------|
| REPL/chat loop | Claude, Aider, Codex, Cline | High — core missing feature |
| `AskUser` tool for mid-execution input | Claude, Codex, Copilot | High — agents need this |
| Plan/Act modes | Copilot, Cline, Aider | Medium — useful for complex tasks |
| Slash commands | Aider, Codex, Cline | Medium — power user feature |
| Tiered approval (once/session/reject-with-feedback) | Copilot, Claude | High — better than binary |
| Non-interactive/CI mode | All | Already exists (`--detach`, `--auto-approve`) |
| Piping/composition | Cline | Low — nice-to-have |
| Keyboard shortcuts for control | Claude, Copilot | Medium — enhances TUI |

## Proposed Design Approach

### Key Design Decisions to Make

1. **REPL vs. Enhanced Single-Shot**
   - Option A: Add a REPL mode (`stigmer chat <agent>`) that wraps executions in a conversation loop
   - Option B: Enhance existing `run`/`draft` to support conversation within the current TUI
   - Option C: Hybrid — the TUI seamlessly transitions between execution phases and user input

2. **User Input Mechanism**
   - How does the user type a message while the agent is streaming output?
   - Split-pane (input at bottom, output scrolls above)? — similar to chat apps
   - Pause streaming, show input prompt, resume?
   - Input queue (user types while agent works, message sent when agent pauses)?

3. **Agent-Initiated Questions**
   - Backend support: Does the agent execution protocol support an "ask user" event type?
   - If not, what backend changes are needed? (gRPC bidirectional streaming? New event type?)
   - How does this render in the TUI? (Distinct visual treatment, input prompt appears)

4. **Agent-Triggered Sub-Executions**
   - Can an agent trigger another execution (e.g., `stigmer run` within a `stigmer draft`)?
   - How is this modeled? Nested executions? Chained executions?
   - UX for nested executions — inline in same TUI? New TUI? Tab-like switching?

5. **Session Continuity**
   - Should conversations persist across CLI invocations?
   - Session ID that can be resumed? (`stigmer resume <session-id>`)
   - Or is each CLI invocation a self-contained conversation?

6. **Backward Compatibility**
   - Existing `stigmer run` / `stigmer draft` behavior must not break
   - Non-interactive mode (`--auto-approve`, `--detach`) must continue to work
   - New conversational features should be opt-in or seamlessly integrated

### Proposed UX Model (Hypothesis)

```
┌─────────────────────────────────────────────────────┐
│ stigmer draft skill --attach context.md             │
│                                                     │
│ ▶ Execution started (exec-abc123)                   │
│                                                     │
│ 🤖 Agent: Reading input files...                    │
│   ├─ [tool] read_file: context.md ✓                 │
│   └─ [tool] read_file: schema.proto ✓               │
│                                                     │
│ 🤖 Agent: I have a question about the skill scope.  │
│   Should this skill handle both creation and         │
│   updating of resources, or creation only?           │
│                                                     │
│ ❓ Agent is waiting for your input                   │
│ ┌─────────────────────────────────────────────────┐ │
│ │ > Creation only for now, we'll add update later │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ 🤖 Agent: Got it. Generating creation-only skill... │
│   ├─ [tool] write_file: SKILL.md                    │
│   │  [a] Approve  [s] Skip  [r] Reject  [d] Detach │
│   ...                                               │
│                                                     │
│ ✅ Execution completed                               │
│                                                     │
│ Continue the conversation? (Enter to type, Esc exit) │
│ ┌─────────────────────────────────────────────────┐ │
│ │ > Actually, can you also add error handling?     │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ 🤖 Agent: Starting follow-up execution...           │
│ ▶ Execution started (exec-def456)                   │
│   ...                                               │
└─────────────────────────────────────────────────────┘
```

## Task Breakdown

### Phase 1: Deep Analysis (This Task — T01)
- [ ] **T01.1**: Document the current execution event types in the gRPC streaming protocol — what events flow from backend → CLI today?
- [ ] **T01.2**: Analyze the agent-runner service to understand if/how an agent can pause for user input — is there an existing mechanism or does the protocol need extension?
- [ ] **T01.3**: Document the Bubbletea TUI architecture — what would need to change to support an input mode alongside the streaming viewport?
- [ ] **T01.4**: Catalog all existing CLI flags and modes that affect execution UX (`--detach`, `--auto-approve`, `--approve-default`, `--model`, etc.)

### Phase 2: Design (T02)
- [ ] **T02.1**: Design the conversational execution protocol — new gRPC event types, bidirectional streaming changes, session model
- [ ] **T02.2**: Design the TUI UX — wireframes for input mode, agent questions, follow-up conversations, nested executions
- [ ] **T02.3**: Design the CLI command structure — new commands vs. enhanced existing commands, new flags
- [ ] **T02.4**: Design backward compatibility strategy — how existing workflows remain unaffected
- [ ] **T02.5**: Design non-interactive/CI mode for conversational executions

### Phase 3: Implementation Planning (T03)
- [ ] **T03.1**: Break the design into implementable work packages with dependency ordering
- [ ] **T03.2**: Identify backend changes needed (agent-runner, execution service, gRPC protos)
- [ ] **T03.3**: Identify CLI changes needed (TUI, command handlers, streaming)
- [ ] **T03.4**: Define testing strategy — how to test conversational UX in CLI

## Success Criteria

1. **Research deliverable**: This document, enriched with findings from T01 analysis (Phase 1)
2. **Design deliverable**: A clear UX design document with wireframes and protocol specifications (Phase 2)
3. **Implementation plan**: A phased implementation plan with ordered work packages (Phase 3)

## Open Questions

1. Does the backend agent execution protocol already support any form of "ask user" or "wait for input" event? Or is this purely a new capability?
2. Can gRPC streaming be made bidirectional for executions (CLI → backend messages during streaming)?
3. Should follow-up messages create new executions or continue the same execution?
4. How do other Stigmer clients (web UI, API) handle conversational agents? Should the protocol be client-agnostic?
5. What is the relationship between "sessions" and "executions" in the current model?

## Notes

- The current TUI (Bubbletea) is well-suited for enhancement — it already handles complex rendering with scrollable viewports and interactive prompts
- The approval mechanism (approve/skip/reject) is a precedent for user interaction during execution — extending this to free-form input is a natural evolution
- gRPC bidirectional streaming would be the cleanest protocol extension, but unary "send message" RPCs could work as a simpler alternative
- This is a research-first project; implementation should not begin until the design is reviewed and approved

---

*This plan is pending review. Feedback will be captured in T01_1_review.md.*
