---
name: Diagnose Premature Execution
overview: "The premature execution completion has three distinct root causes: (1) the agent never called `publish_artifact` so no files were downloadable, (2) the LangGraph graph terminated after the tool call without routing back to the LLM for a final summary, and (3) the CLI shows tool state as pending when execution completes. None of these are caused by the recent CLI TUI changes (thinking indicator / heartbeat)."
todos:
  - id: investigate-skill-creator-agent
    content: Review skill-creator-agent definition (system prompt, tool set) to check if publish_artifact is available and instructed
    status: completed
  - id: investigate-graphton-termination
    content: Investigate why the Graphton graph terminates after tool call without LLM response -- check graph edges in create_deep_agent
    status: completed
  - id: decide-artifact-fallback
    content: "Decision: determine if draft-skill should auto-collect artifacts as fallback when agent doesn't call publish_artifact"
    status: completed
  - id: decide-graph-termination
    content: "Decision: determine if post-stream validation should detect missing final AI message"
    status: completed
  - id: fix-cli-tool-state
    content: Fix CLI to resolve running tool display state when DoneEvent arrives (handle_events.go)
    status: completed
isProject: false
---

# Diagnose and Fix Premature Agent Execution Completion

## What Happened (Trace of the Issue)

The `stigmer draft skill` execution:

1. Agent read 6 input files (correctly)
2. Agent wrote `agent-drafter/SKILL.md` to the sandbox (correctly)
3. LangGraph graph **terminated immediately** after the write tool -- no LLM response followed
4. Backend set `EXECUTION_COMPLETED` because the stream naturally exhausted
5. CLI displayed "Execution completed" with the write tool still showing as pending
6. After TUI exit, `exec.Status.Artifacts` was **empty** because the agent never called `publish_artifact`
7. CLI likely printed "No skill artifacts were generated" (after TUI closed)

## Root Cause 1: The Recent CLI Changes Are NOT the Cause

**Conclusion: Definitively ruled out.**

I exhaustively traced every code path in the 7 modified CLI files. The entire diff adds three features -- `HeartbeatEvent` for backend liveness, `activityTickMsg` for thinking indicator, `isConnectionStale()` for connection warning. **None of these touch `done`, `tea.Quit`, or any completion logic.** The three paths that set `done = true` (`DoneEvent`, `StreamErrorEvent`, `handleStreamClosed`) are completely unchanged.

The CLI faithfully displays whatever the backend reports. The backend reported `EXECUTION_COMPLETED`, and the CLI displayed it.

## Root Cause 2: Agent Did Not Call `publish_artifact`

Files written to the sandbox do NOT automatically become artifacts. The agent must explicitly call the `publish_artifact` tool to:

1. Upload the file/directory to storage (R2 or local)
2. Create an `ExecutionArtifact` proto with download URL
3. Register it with the status builder

**The skill-creator-agent likely does not have instructions or awareness that it must call `publish_artifact` after writing files.** It wrote `SKILL.md` to the sandbox and considered its job done.

This is the immediate cause of "nothing got downloaded" -- the artifact list was empty, so `downloadArtifacts()` in [draft_skill_handler.go](client-apps/cli/cmd/stigmer/root/draft_skill_handler.go) had nothing to download (line 88: `if len(exec.Status.Artifacts) > 0`).

## Root Cause 3: No Final AI Message (Graph Termination After Tool Call)

The LangGraph graph created by `create_deep_agent` terminated after the file-write tool completed **without routing back to the LLM**. This means:

- No `on_chat_model_stream` events were emitted after the tool
- No AI message was created in the status builder
- The user got no summary of what was accomplished

After the stream naturally exhausted, `execute_graphton.py` (line 2265) set `EXECUTION_COMPLETED`. There is **no validation** that a final AI message exists before marking completion.

## Decisions Needed (Before Implementation)

### Decision A: Should artifacts be auto-collected as a fallback?

Two approaches:

1. **Explicit only (current):** Agent must call `publish_artifact`. Simple, predictable, but depends on agent instructions being correct.
2. **Fallback collection:** After execution completes, if no artifacts were published AND the agent wrote files to a known output path, auto-collect them. Safer for user-facing commands like `draft skill`.

I'd recommend keeping explicit `publish_artifact` as primary but adding a fallback for `draft skill` specifically, since it's a convenience command where users always expect output files.

### Decision B: Should graph termination without final LLM response be an error?

Two approaches:

1. **Post-stream validation:** After the stream ends, check if the last message was a tool result without a subsequent AI response. If so, synthesize a completion message or flag it as abnormal.
2. **Graph structure fix:** Ensure the Graphton agent graph always routes tool results back to the LLM before allowing termination.

Option 2 is the right fix (fix the graph, not the symptom), but option 1 is a good safety net.

### Decision C: Should the CLI finalize in-progress tools on execution completion?

When `DoneEvent` arrives, any tools still tracked as "running" (in `m.runningTools`) should be visually resolved -- either marked as completed or shown as interrupted. Currently they stay as pending, which is confusing.

## Proposed Investigation Tasks

### Task 1: Review skill-creator-agent system prompt and tools

- Check if `publish_artifact` is in its tool set
- Check if the system prompt instructs it to publish outputs
- Files: wherever the skill-creator-agent definition lives (seedpack/bootstrap)

### Task 2: Investigate Graphton graph termination behavior

- Understand why `create_deep_agent` graph can terminate after a tool without returning to LLM
- Check the graph edges and conditional routing
- Files: `backend/libs/graphton/` graph builder

### Task 3: Review `execute_graphton.py` post-stream validation

- Line 2138-2265: what happens after the stream ends
- Can we detect "last message was tool result, no AI follow-up" and handle it?
- File: [execute_graphton.py](backend/services/agent-runner/worker/activities/execute_graphton.py)

### Task 4: CLI tool state finalization on DoneEvent

- In `handle_events.go` DoneEvent handler, resolve any `m.runningTools` entries
- Minor display fix, self-contained in CLI
- File: [handle_events.go](client-apps/cli/pkg/executiontui/handle_events.go)

