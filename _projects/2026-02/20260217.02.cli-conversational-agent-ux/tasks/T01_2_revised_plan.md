# T01 Revised Plan: Conversational Agent UX — MVP

**Created**: 2026-02-18
**Status**: Pending Approval
**Revision**: Based on deep research report + developer feedback

---

## Design Decisions (Informed by Research)

The deep research report covered Claude Code CLI, Codex CLI, Copilot CLI, Aider, Cline CLI, Warp, Kiro CLI, Gemini CLI, Cursor, Windsurf, Jules, and Devin. Below are the design decisions for Stigmer's MVP, with rationale drawn from those findings.

### Decision 1: User-Facing Abstraction = "Session"

**Choice**: Use **session** as the user-facing concept. Executions are purely internal.

**Rationale**: "Session" is the dominant abstraction across the ecosystem — Claude Code, Codex, Copilot, Kiro, and Gemini all use it. Cline uses "task" (goal-scoped container), which is also valid, but "session" is more broadly recognized and maps naturally to "I'm having a conversation with the agent."

**What this means**:
- A user runs `stigmer draft skill` → a **session** starts
- Within that session, multiple internal executions may happen — the user never sees them
- The user sees a continuous conversation, not discrete runs
- Session has an ID for resumability, but it's shown only when needed (e.g., in `stigmer list sessions`)

### Decision 2: Hide Execution Internals Completely

**Choice**: No execution IDs, no lifecycle phase transitions (started/completed/failed) in the main transcript.

**Rationale**: The research report explicitly calls out "leaking internals" as an anti-pattern. The best tools show state through affordances (streaming indicator, input prompt appearing), not narration ("Execution started", "Execution completed"). Codex and Claude Code both expose internal IDs only as power-user features for scripting/debugging, never in the primary UX.

**What the user sees**:
```
$ stigmer draft skill --attach context.md

  Reading your inputs...
    ✓ context.md
    ✓ schema.proto

  I have a question about the skill scope.
  Should this skill handle both creation and
  updating of resources, or creation only?

  ▸ _                                          ← input appears here

  > Creation only for now

  Got it. Generating creation-only skill...
    ✓ write_file: SKILL.md
      [a] Approve  [s] Skip  [r] Reject

  ...

  ✅ Done! Artifacts saved to ./output/

  ▸ _                                          ← continue or Esc to exit
```

No "Execution started (exec-abc123)". No "Execution completed". No internal boundaries. Just a continuous conversation.

### Decision 3: Enhance Existing TUI (Not a New REPL Command)

**Choice**: Enhance `stigmer run` and `stigmer draft` to support conversation within the existing Bubbletea TUI. Do NOT add a separate `stigmer chat` command.

**Rationale**: Adding a new command fragments the UX and forces users to choose between modes. The research shows that the best tools (Claude Code, Codex) make conversation the default behavior of the primary command — not a separate mode. The existing TUI already supports streaming viewport + inline approvals; extending it with an input area is a natural evolution, not a rewrite.

**What this means for the existing commands**:
- `stigmer run <agent>` — starts a session, streams output, allows conversation
- `stigmer draft skill` — starts a session, streams output, allows conversation, downloads artifacts
- `stigmer run <agent> --detach` — unchanged, fire-and-forget (no session UI)
- `stigmer run <agent> --auto-approve --message "do X"` — non-interactive one-shot (no conversation)

### Decision 4: Two-Zone TUI Layout

**Choice**: Scrollable transcript (top) + input composer (bottom). Not split-pane. Not separate views.

**Rationale**: This is the dominant layout across Codex CLI, Claude Code, Copilot CLI, and Gemini CLI. Bubbletea's viewport + textarea components support this directly. The input area is always visible but only active when the agent is waiting for input or has completed a step.

```
┌─────────────────────────────────────────────┐
│                                             │
│  Scrollable transcript                      │
│  (agent messages, tool calls, approvals)    │
│                                             │
│                                             │
│                                             │
├─────────────────────────────────────────────┤
│  ▸ Type a message... (or Esc to exit)       │
└─────────────────────────────────────────────┘
```

**Key interaction**: The user can type while the agent is streaming (message queued, sent when agent pauses) — this is the "queue while working" pattern from Copilot CLI and Windsurf that makes the agent feel like a collaborator, not a blocking command.

### Decision 5: Session Resumability — Verb-First, Using Existing Commands

**Choice**: Use the existing verb-first CLI conventions for session management. No new noun-first commands.

**Rationale**: Every mature tool (Codex, Copilot, Cline, Kiro, Gemini) supports session resume. This is table-stakes for a proper conversational experience. However, Stigmer's CLI follows a strict **verb-first convention** (`stigmer list`, `stigmer run`, `stigmer get`, `stigmer delete`, etc.), and both session listing and session resume are **already implemented** using this pattern. Introducing noun-first commands like `stigmer session list` would break the convention and duplicate existing functionality.

**Existing commands (already implemented)**:
- `stigmer list sessions` — list recent sessions (already works via `stigmer list <type>`)
- `stigmer run <session-id>` — resume a specific session (already works; `stigmer run ses-xxx` re-attaches to a live stream or opens a read-only replay)

**No new commands needed for MVP**. The existing verb-first commands cover listing and resuming sessions. If an interactive session picker is needed in the future, it could be added as a flag on `stigmer run` (e.g., `stigmer run --pick-session`) rather than a new subcommand.

**Storage**: `~/.stigmer/sessions/{session-id}/` containing conversation transcript and metadata. Lightweight — no need to store full execution state, just enough to resume the conversation.

### Decision 6: Agent-Initiated Questions via "Ask User" Event

**Choice**: Add a new event type to the gRPC streaming protocol that signals "agent is asking the user a question." The TUI renders a distinct input prompt. In non-interactive mode, this event is either skipped or fails fast.

**Rationale**: Claude Code, Codex, and Copilot all support an `AskUserQuestion` tool or equivalent. This is the mechanism that makes the conversation bidirectional — without it, the agent can only output, never ask. The research also shows that non-interactive mode needs explicit handling: Copilot has `--no-ask-user`, Cline's headless mode auto-detects TTY.

**Non-interactive behavior**: If the agent asks a question and the session is non-interactive (piped stdin, `--non-interactive` flag, or `--detach`), the agent receives a signal that the user is unavailable and should proceed with its best judgment or fail gracefully.

---

## MVP Scope — What to Build

### In Scope (MVP)

| Feature | Description | Complexity |
|---------|-------------|------------|
| **Session wrapper** | `stigmer run`/`draft` creates a session that wraps one or more executions | Medium |
| **Input composer** | Bottom text area in TUI for user messages | Medium |
| **Agent questions** | New "ask user" event in gRPC protocol; TUI renders input prompt | Medium |
| **Follow-up messages** | After agent completes, user can type a follow-up; creates a new execution within the same session | Medium |
| **Session list/resume** | `stigmer list sessions` and `stigmer run <session-id>` (already implemented, no new commands) | Low |
| **Hide execution internals** | No execution IDs or lifecycle events in transcript | Low |
| **Non-interactive compatibility** | Existing `--detach`, `--auto-approve` work unchanged; new `--non-interactive` flag | Low |

### Out of Scope (Future)

| Feature | Why Deferred |
|---------|-------------|
| Mid-conversation attachments (`/attach <path>`) | Stigmer agents run server-side, so mid-conversation attachments require uploading (not just local file reads like Aider/Claude Code). Adds TUI complexity (path autocomplete, upload progress) and protocol changes (attaching files to mid-session messages). For MVP, users attach at invocation via `--attach`; if more context is needed mid-conversation, the user describes what's needed and the agent can ask for specifics. Natural fit as the first slash command when that feature is built. |
| Slash commands (`/status`, `/model`, `/clear`) | Power-user feature; not needed for MVP |
| Plan/Act mode toggle | Adds complexity; conversation alone is the core value |
| Checkpointing / revert | Valuable but complex; requires shadow git or snapshots |
| Cloud-synced sessions | Local-first is sufficient for MVP |
| Message queueing while agent streams | Nice UX but adds TUI complexity; can start with "wait then type" |
| Parallel agents / multi-session | Advanced feature |
| Session sharing / export to Markdown | Nice-to-have |
| Piping / composition (`git diff \| stigmer run`) | Unix philosophy, but niche |

### Scope Boundary: Agents vs. Workflows

The conversational session concept applies **only to agent executions**. Workflows are a fundamentally different UX.

| Aspect | Agent Execution | Workflow Execution |
|--------|----------------|-------------------|
| User-facing concept | **Session** (conversational) | **Run** (sequential tasks) |
| TUI | Bubbletea full-screen TUI | Inline spinner + stdout |
| Conversation | Yes — agent can ask questions, user can follow up | No — workflow runs tasks in order |
| Approvals | Yes (approve/skip/reject per tool call) | Yes (approve/skip/reject per task) |
| Session resumability | Yes | No (workflows are self-contained) |
| Code path | `streamAgentExecution()` | `streamWorkflowExecution()` |

**Edge case (future, not MVP)**: A workflow may contain an agent step. That agent step might need conversation (e.g., the agent asks a question). This creates a hybrid scenario — the workflow orchestrator would need to pause and proxy a conversational exchange to the CLI for that specific agent step. This is a non-trivial protocol design question deferred to a future iteration. For MVP, if a workflow triggers an agent, the agent runs non-interactively within the workflow context.

### Explicitly Preserved (No Changes)

| Existing Feature | Guarantee |
|------------------|-----------|
| `stigmer run <agent> --detach` | Fire-and-forget, no TUI, returns immediately |
| `stigmer run <agent> --auto-approve` | No approval prompts, runs to completion |
| `stigmer draft skill --attach <files>` | Attachment processing unchanged |
| Approval prompts (approve/skip/reject) | Work exactly as before within the session |
| `--model` flag | Model override unchanged |
| Artifact download on draft completion | Unchanged |
| **Workflow execution UX** | **Completely unchanged — inline spinner, no session, no conversation** |

---

## Implementation Phases

### Phase 1: Session Abstraction (Backend + CLI)

**Goal**: Introduce "session" as a first-class concept that wraps executions.

**Backend changes**:
- New `Session` proto message (id, created_at, agent_ref, status, metadata)
- New RPCs: `CreateSession`, `GetSession`, `ListSessions`
- Execution creation now takes an optional `session_id` — multiple executions can belong to one session
- Session state stored server-side (or local — TBD based on architecture preference)

**CLI changes**:
- `stigmer run` / `stigmer draft` create a session before creating the first execution
- Session ID stored locally in `~/.stigmer/sessions/`
- `stigmer list sessions` and `stigmer run <session-id>` already exist — no new commands needed
- Remove execution ID and lifecycle events from TUI transcript

### Phase 2: Conversational TUI

**Goal**: Add input composer and conversational flow to the existing Bubbletea TUI.

**TUI changes**:
- Add a `textarea` component at the bottom of the viewport
- Three TUI states:
  1. **Streaming** — agent is outputting; transcript scrolls; input area shows "Agent is working..." (dimmed)
  2. **Waiting for input** — agent asked a question or completed; input area is active; cursor blinks
  3. **User typing** — user is composing a message; Enter sends; Esc exits
- When user sends a message:
  - If agent asked a question → send answer via gRPC (new RPC or bidirectional stream)
  - If agent completed → create a new execution within the same session; stream resumes

**Visual treatment**:
- Agent messages: normal text, left-aligned
- Tool calls: indented, collapsible (as today)
- Agent questions: distinct styling (e.g., highlighted, with `▸` prompt indicator)
- User messages: right-aligned or prefixed with `you:` — visually distinct from agent output
- No "execution started/completed" events in transcript

### Phase 3: "Ask User" Protocol

**Goal**: Enable agents to ask the user questions mid-execution.

**Backend changes**:
- New event type in the execution streaming protocol: `ASK_USER` with a question payload
- When agent emits an `ASK_USER` event, execution pauses until a response is received
- New RPC: `RespondToQuestion(session_id, execution_id, response)` — or extend the stream to be bidirectional
- Non-interactive handling: if no response within timeout (or non-interactive flag), send a "user unavailable" signal to the agent

**CLI changes**:
- When TUI receives an `ASK_USER` event:
  - Render the question in the transcript with distinct styling
  - Activate the input composer
  - Wait for user to type and press Enter
  - Send response back to backend
  - Resume streaming

### Phase 4: Polish and Edge Cases

**Goal**: Handle the real-world messiness.

- Session cleanup / expiry (auto-delete sessions older than N days)
- Error recovery: if CLI disconnects mid-session, `stigmer run <session-id>` reconnects
- Graceful handling of agent errors within a session (don't kill the session; show error, allow retry)
- `--verbose` flag to optionally show execution-level details for debugging
- Update `stigmer get execution` to also show which session an execution belongs to (for power users)

---

## Revised UX Wireframe

```
$ stigmer draft skill --attach requirements.md

┌─ Session ses-7f3a ──────────────────────────────────────────────────┐
│                                                                     │
│  Reading your inputs...                                             │
│    ✓ requirements.md (2.1 KB)                                       │
│    ✓ agent-spec.proto (referenced)                                  │
│                                                                     │
│  I've analyzed your requirements. A few questions before I start:   │
│                                                                     │
│  1. Should this skill support both YAML and JSON output formats,    │
│     or YAML only?                                                   │
│  2. The requirements mention "validation" — should the skill        │
│     validate against the proto schema, or just structural checks?   │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│  ▸ YAML only. And yes, validate against the proto schema.           │
└─────────────────────────────────────────────────────────────────────┘

  (user presses Enter, agent continues)

│                                                                     │
│  you: YAML only. And yes, validate against the proto schema.        │
│                                                                     │
│  Got it. Generating YAML-only skill with proto validation...        │
│                                                                     │
│    write_file: SKILL.md                                             │
│    ┌──────────────────────────────────────────────────────────────┐  │
│    │ name: agent-drafter                                         │  │
│    │ description: Creates valid Stigmer Agent YAML files...      │  │
│    │ ...                                                         │  │
│    └──────────────────────────────────────────────────────────────┘  │
│    [a] Approve  [s] Skip  [r] Reject                                │
│                                                                     │

  (user presses 'a')

│    ✓ SKILL.md written                                               │
│                                                                     │
│  Done! Skill saved to ./output/agent-drafter/                       │
│                                                                     │
│  Artifacts downloaded:                                              │
│    • SKILL.md                                                       │
│    • references/schema-details.md                                   │
│    • references/examples.md                                         │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│  ▸ Can you also add a section for error handling patterns?          │
└─────────────────────────────────────────────────────────────────────┘

  (user sends follow-up — new execution created silently within same session)

│                                                                     │
│  you: Can you also add a section for error handling patterns?       │
│                                                                     │
│  Sure, I'll update the skill to include error handling patterns...  │
│    ...                                                              │
│                                                                     │
│  Done! Updated artifacts saved to ./output/agent-drafter/           │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│  ▸ Type a message, or press Esc to exit                             │
└─────────────────────────────────────────────────────────────────────┘
```

**What the user experiences**: A single, continuous conversation. No execution IDs. No "started/completed" noise. The agent works, asks questions when needed, the user responds, and the conversation continues until the user is satisfied and exits.

**What happens internally** (invisible to user): Session `ses-7f3a` contains three executions — the initial draft, the question-answer exchange, and the follow-up modification. The user never knows or cares.

---

## Open Questions (Reduced)

The research resolved many of the original open questions. Remaining:

1. **Session storage: server-side, local, or both?** — Research suggests local-first is the norm (Codex, Copilot, Cline all store locally). But Stigmer already has a backend. Should sessions be a backend concept (better for web UI consistency) or local-only (simpler for MVP)?

2. **Bidirectional gRPC vs. separate "respond" RPC?** — For the "ask user" flow, should we extend the existing streaming to be bidirectional, or add a separate `RespondToQuestion` unary RPC? Bidirectional is cleaner but may be more complex to implement.

3. **Follow-up execution context** — When the user sends a follow-up message, how much context from the previous execution does the new execution receive? Full conversation history? Summary? Just the user's new message?

---

*This revised plan incorporates findings from the deep research report and addresses all feedback from T01_1_review.md. Pending developer approval before proceeding to implementation.*
