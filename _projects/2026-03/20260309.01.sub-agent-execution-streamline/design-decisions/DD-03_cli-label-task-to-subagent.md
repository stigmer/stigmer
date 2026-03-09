# DD-03: CLI Label "Task" Renamed to "Sub-agent"

**Date**: 2026-03-09
**Status**: ACCEPTED

## Decision

The hardcoded "Task" label in CLI sub-agent rendering is renamed to "Sub-agent" in all render paths.

## Rationale

- "Task" is the LangGraph tool name, not a user-facing concept
- Users see "Task: Explore CLI rendering code" and cannot tell this represents a sub-agent delegation
- "Sub-agent" matches the domain model (`SubAgentExecution`) and the platform's terminology

## CLI Changes (PR4)

Three render paths and one display map entry:

1. `run_stream_inline_bubbletea.go` line 668: `LabelBold("Task")` -> `LabelBold("Sub-agent")`
2. `run_stream_inline_render.go` line 166: `LabelBold("Task")` -> `LabelBold("Sub-agent")`
3. `run_stream_inline_history.go` line 357: `LabelBold("Task")` -> `LabelBold("Sub-agent")`
4. `toolDisplayMap` in `render.go` line 172: label `"Task"` -> `"Sub-agent"`
