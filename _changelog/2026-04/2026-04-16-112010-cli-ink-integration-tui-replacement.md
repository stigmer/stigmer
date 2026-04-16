# CLI Ink Integration: Full TUI Replacement

**Date**: April 16, 2026

## Summary

Replaced the Go CLI's 37K-line Bubble Tea/Lip Gloss/Glamour interactive TUI with `@stigmer/ink`, a React-for-terminals SDK package invoked via npx. The Go CLI now delegates all interactive session rendering (run, resume, draft) to the Ink renderer while retaining Go-native JSON mode, detach mode, and non-TTY plain text output. This eliminates a problematic TUI codebase and dogfoods the npm SDK distribution model that platform builders use.

## Problem Statement

The Go CLI's interactive rendering layer for `stigmer run`, `stigmer resume`, and `stigmer draft` was a 37K-line Go codebase using Bubble Tea (TUI framework), Lip Gloss (styling), and Glamour (markdown). This code had multiple problems:

### Pain Points

- Numerous rendering bugs that were difficult to diagnose and fix in the Go TUI framework
- Duplicate rendering logic: the same conversation UI concepts (messages, tool calls, approvals, follow-up) existed in both the Go CLI and the `@stigmer/react` web SDK, with no code sharing
- The `@stigmer/ink` SDK package (built in Phase 1) proved that React hooks from `@stigmer/react` work identically in terminal contexts — making the Go TUI redundant
- Every UI improvement required changes in two codebases (Go + React) instead of one

## Solution

Replace the Go TUI with a thin Go orchestration layer that spawns `@stigmer/ink` (via npx or workspace auto-detection) for interactive terminal rendering. Go retains responsibility for command parsing, resource resolution, session/execution creation, JSON mode, and exit codes. Ink handles all interactive UI: streaming conversations, tool call rendering, approval prompts, follow-up input, and keyboard interactions.

## Implementation Details

### Ink SDK Components (TypeScript/React)

**New components:**
- `SubAgentBlock`: Collapsible nested sub-agent execution rendering with status glyphs, duration, internal message thread, and tool call groups. Matches the web SDK's `SubAgentSection` behavior.
- `TodoList`: Sorted checklist with completion counter (e.g., "3/5"), status glyphs, and cancelled item strikethrough.

**Enhanced components:**
- `MessageThread`: Task-tool suppression — splits "task" tools from regular tools, renders matched `SubAgentExecution` blocks by tool call ID instead of flat tool groups.
- `ApprovalPrompt`: Sub-agent attribution — shows "via {subject/name}" badge when approval originates from a sub-agent.
- `ToolCallGroup`: `defaultExpanded` prop for global expand/collapse toggle.
- `SessionView`: Session subject display, Ctrl+O expand/collapse keyboard binding, context compaction indicator, connection status with spinner, reconnection UX with error message.

### Go CLI Integration

**New files:**
- `run_stream_ink.go`: `resolveInkCommand()` with 3-tier resolution (env override → workspace tsx auto-detection → npx with pinned version), `streamAgentInk()` for spawning the Ink process with full terminal I/O passthrough, `resolveInkConfig()` for extracting API connection details from CLI config.
- `run_stream_plaintext.go`: Minimal non-TTY renderer (~100 lines) for piped output — writes clean AI text to stdout, tool summaries to stderr, auto-skips approvals.

**Modified routing in `streamAgentExecution()`:**
- `--json` → unchanged Go JSON renderer
- TTY → spawn Ink renderer via `resolveInkCommand()`
- Non-TTY → minimal plain text renderer

### Workspace Auto-Detection

The Go CLI resolves the Ink renderer automatically, mirroring how the web app resolves `@stigmer/react`:
1. `STIGMER_INK_CMD` env var (escape hatch)
2. Workspace detection: binary at `bin/stigmer` checks for `../node_modules/.bin/tsx` + `../sdk/ink/src/cli/stigmer-ink.tsx`
3. npx with pinned version: `npx @stigmer/ink@<version>`

Developers run `make build && bin/stigmer run my-agent` and it automatically uses the local workspace Ink — no env vars, no manual setup.

### Release Coordination

Added an npm availability gate in `release.cli.yaml`: the CLI `release` job polls npm until `@stigmer/ink@<version>` is published before creating the GitHub Release. Build jobs still run in parallel (no slowdown); only the final release is gated.

## Benefits

- **Single rendering codebase**: Conversation UI changes made once in `@stigmer/react` benefit both web and terminal — no more maintaining parallel TUI code
- **SDK dogfooding**: The Go CLI consumes `@stigmer/ink` the same way a platform builder would, proving the npm distribution model works
- **15,800 lines removed**: 36 inline renderer files deleted from the Go codebase
- **Simpler Go CLI**: Go focuses on orchestration (resource resolution, session creation, exit codes); rendering is React's job
- **Feature parity via shared hooks**: `useSessionConversation`, `useSessionUsage`, and other `@stigmer/react` hooks handle streaming, reconnection, and state management identically across surfaces

## Impact

- **CLI users**: Interactive rendering now uses the same React components as the web console. Sub-agent rendering, todo display, and context compaction indicators are new capabilities.
- **CLI developers**: The Go codebase is significantly simpler — adding new rendering features means updating `@stigmer/ink` TypeScript components, not Go TUI code.
- **Platform builders**: `@stigmer/ink` gains real-world validation as the Stigmer CLI's production renderer, not just a demo package.
- **Release pipeline**: CLI releases are now gated on `@stigmer/ink` npm availability. Node.js >= 18 becomes a documented prerequisite for interactive CLI rendering.

## Related Work

- T04 Phase 1 (Session 4-5): Created `@stigmer/ink` SDK package with 8 components, E2E validated against live API
- T05 (Session 6): CLI Go SDK refactor — SDK-first architecture
- T06 (Session 8): SDK sub-client migration — eliminated raw gRPC stubs

---

**Status**: Experimental (pending E2E validation against live API)
**Timeline**: 1 session (Session 9)
