---
name: Sub-agent context separators
overview: Replace the per-block `↳` sub-agent indent prefix with a single context separator line (e.g., `── researcher ──`) that appears once when the active agent context changes. Sub-agent blocks themselves render with no prefix, keeping the UI clean while still communicating which sub-agent is responsible for a group of actions.
todos:
  - id: events-model
    content: Add SubAgentStartedEvent to events.go; add subAgentName to contentBlock in blocks.go; add subAgentNames map to Model in model.go
    status: completed
  - id: bridge
    content: Emit SubAgentStartedEvent in emitSubAgentEvents (run_stream_subagent.go) when new sub-agent detected
    status: completed
  - id: handle-events
    content: Handle SubAgentStartedEvent in handleExecutionEvent; propagate subAgentName alongside subAgentID on all block assignments
    status: completed
  - id: render-remove-old
    content: Remove hasMultipleSubAgents, indentSubAgentBlock, constants, and nestSubAgents param from renderedBlockText in render_blocks.go
    status: completed
  - id: render-add-separator
    content: Add renderSubAgentSeparator function and modify rebuildViewportContent to inject separators on context switch
    status: completed
  - id: scroll
    content: Update blockStartLine and blockLineCount in scroll.go to match new renderedBlockText signature and account for separator lines
    status: completed
  - id: tests
    content: Delete old nesting tests, add separator tests in render_blocks_test.go, add SubAgentStartedEvent test in run_stream_subagent_test.go
    status: completed
  - id: verify
    content: Run go build and go test to confirm clean compilation and all tests pass
    status: completed
isProject: false
---

# Replace Sub-Agent Nesting Prefix with Context Separators

## Design

Replace the noisy per-block `↳` prefix with a single dim separator line inserted when the active agent context changes. The separator shows the sub-agent name from `SubAgentExecution.name` (e.g., "researcher", "code_editor"):

```
  📖 Read: bin/skills/skill-creator/SKILL.md (18 KB, 258 lines) ▶
── researcher ──
  💭 Thinking (141 chars, 1 line, 577ms) ▶
  📖 Read: inputs/agent/docs/README.md (3.2 KB, 53 lines) ▶
  📖 Read: inputs/agent/docs/examples.md (6.7 KB, 250 lines) ▶
```

A separator is inserted **only when entering a sub-agent context** -- when a block's `subAgentID` differs from the previous non-empty block's `subAgentID` AND the current block IS from a sub-agent. Returning to the main agent (empty `subAgentID`) does not emit a separator; the absence of a label IS the signal.

The sub-agent name flows from the backend proto via a one-time `SubAgentStartedEvent` rather than adding a name field to all 8 existing event types. The Model stores a `subAgentNames` map lookup, and the name is stamped on each `contentBlock` for self-contained rendering.

## Changes by file

### Layer 1: Event and data model (no rendering changes)

#### 1. `[client-apps/cli/pkg/executiontui/events.go](client-apps/cli/pkg/executiontui/events.go)`

Add a new event type:

```go
type SubAgentStartedEvent struct {
    ID   string
    Name string
}
func (SubAgentStartedEvent) isEvent() {}
```

#### 2. `[client-apps/cli/pkg/executiontui/blocks.go](client-apps/cli/pkg/executiontui/blocks.go)`

- Add `subAgentName string` field to `contentBlock` (next to existing `subAgentID`)
- Update the doc comment on `subAgentID` to reference the context separator instead of the `↳` prefix

#### 3. `[client-apps/cli/pkg/executiontui/model.go](client-apps/cli/pkg/executiontui/model.go)`

- Add `subAgentNames map[string]string` field to `Model`
- Initialize it in `New()`: `subAgentNames: make(map[string]string)`

### Layer 2: Bridge -- propagate sub-agent name

#### 4. `[client-apps/cli/cmd/stigmer/root/run_stream_subagent.go](client-apps/cli/cmd/stigmer/root/run_stream_subagent.go)`

In `emitSubAgentEvents`, when a new sub-agent is first detected (`!exists` branch, line 38), emit a `SubAgentStartedEvent` before any tool/message events:

```go
if !exists {
    tracker = &subAgentTracker{...}
    trackers[sa.Id] = tracker
    events <- executiontui.SubAgentStartedEvent{ID: sa.Id, Name: sa.Name}
    // ... existing log statement
}
```

This event arrives on the channel before any tool/message events from the sub-agent, so the TUI model's name map is populated before blocks need the name.

### Layer 3: Event handling -- populate name on blocks

#### 5. `[client-apps/cli/pkg/executiontui/handle_events.go](client-apps/cli/pkg/executiontui/handle_events.go)`

- Add a case for `SubAgentStartedEvent` in `handleExecutionEvent`:

```go
  case SubAgentStartedEvent:
      m.subAgentNames[e.ID] = e.Name
  

```

- At every location where `b.subAgentID = e.SubAgentID` is set (lines 27, 32, 58, 88, 234, 237, 260), also set: `b.subAgentName = m.subAgentNames[subAgentID]`
- In `updateToolBadge`, propagate `subAgentName` alongside `subAgentID`

### Layer 4: Rendering -- replace indent with context separator

#### 6. `[client-apps/cli/pkg/executiontui/render_blocks.go](client-apps/cli/pkg/executiontui/render_blocks.go)`

**Remove entirely:**

- `hasMultipleSubAgents` function (lines 332-351)
- `subAgentIndent` constant (line 355)
- `subAgentContinuation` constant (line 359)
- `indentSubAgentBlock` function (lines 361-371)

**Simplify `renderedBlockText`** (line 318):

- Remove `nestSubAgents bool` parameter
- Remove the 3-line indent block (lines 326-328)
- Update doc comment to remove nesting references

**Add new function:**

```go
func renderSubAgentSeparator(name string) string {
    if name == "" {
        name = "sub-agent"
    }
    return dimStyle.Render("── " + name + " ──")
}
```

**Modify `rebuildViewportContent`** (line 387):

- Remove `nest := hasMultipleSubAgents(blocks)` (line 392)
- Track `prevSubAgentID` across non-empty blocks
- When a block has `subAgentID != ""` AND it differs from `prevSubAgentID`, insert a separator as a standalone part before the block's text
- Update doc comment to describe the separator behavior

#### 7. `[client-apps/cli/pkg/executiontui/scroll.go](client-apps/cli/pkg/executiontui/scroll.go)`

`**blockStartLine**` (line 45):

- Remove `nest := hasMultipleSubAgents(blocks)`
- Update `renderedBlockText` call (drop the `nest` arg)
- Add the same context-switch separator line counting: when iterating blocks before `targetIdx`, if a context switch would produce a separator, add its line count (separator lines + blank line)

`**blockLineCount**` (line 67):

- Remove `nest := hasMultipleSubAgents(blocks)`
- Update `renderedBlockText` call (drop the `nest` arg)
- No separator accounting needed here (separators are between blocks, not within)

### Layer 5: Tests

#### 8. `[client-apps/cli/pkg/executiontui/render_blocks_test.go](client-apps/cli/pkg/executiontui/render_blocks_test.go)`

**Delete:**

- All `hasMultipleSubAgents` tests (lines 479-521, 4 tests)
- All `renderedBlockText` nesting tests (lines 523-549, 3 tests)

**Add new tests:**

- `TestRenderSubAgentSeparator` -- verifies separator contains the name
- `TestRenderSubAgentSeparator_EmptyName` -- verifies fallback to "sub-agent"
- `TestRebuildViewportContent_SubAgentSeparator` -- verifies separator appears on context switch
- `TestRebuildViewportContent_NoSeparator_MainAgent` -- verifies no separator for main-agent-only blocks
- `TestRebuildViewportContent_NoSeparator_SameSubAgent` -- verifies separator only on FIRST block from a sub-agent group

#### 9. `[client-apps/cli/cmd/stigmer/root/run_stream_subagent_test.go](client-apps/cli/cmd/stigmer/root/run_stream_subagent_test.go)`

Add a test that verifies `emitSubAgentEvents` emits `SubAgentStartedEvent` when a new sub-agent is first detected.

## What is NOT changed

- `**contentBlock.subAgentID` field**: Kept -- used to detect context switches during rendering
- `**SubAgentID` on all 8 existing event types**: Unchanged -- still propagated as before
- `**run_stream_events.go`**: No changes needed -- `emitToolCallStateEvents` still passes `subAgentID` through events; the name comes from the model's map lookup
- `**run_stream_snapshot.go`**: Already calls `emitSubAgentEvents` so it will automatically emit `SubAgentStartedEvent` for historical replays

