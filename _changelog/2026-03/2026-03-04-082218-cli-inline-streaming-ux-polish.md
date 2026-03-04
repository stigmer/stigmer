# CLI Inline Streaming UX Polish

**Date**: March 4, 2026

## Summary

Polished the inline-first CLI streaming experience by replacing scattered startup text with a professional bordered session header, removing all emoji icons globally, suppressing duplicate think tool output, eliminating noisy phase change messages, and adding visual breathing room between multi-line tool outputs. These changes bring the CLI output quality in line with professional tools like Claude Code.

## Problem Statement

After completing the inline-first CLI project (Phases 1-5), manual testing of the `stigmer draft mcp-server` flow revealed five categories of visual and UX issues that degraded the professional feel of the CLI output.

### Pain Points

- Four separate startup lines ("Using system agent:", "Session started:", "Streaming session...", "Execution pending/started") scattered across different functions, compared to Claude Code's clean bordered header
- Emoji icons still present throughout the CLI despite a Phase 2.2 decision to remove them — visible in phase changes, AI prefixes, `climsg`, `StateBadge`, `toolDisplayMap`, and more
- Think tool output shown twice: `ToolRunningEvent` prints "Thinking ..." then `ToolCompletedEvent` prints the full thought, with no in-place replacement
- "Execution pending" and "Execution started" phase messages adding noise when the session header already confirms the session is live
- Multi-line tool outputs (think, shell) running directly into the next tool with no visual separator

## Solution

Five targeted fixes applied systematically across the CLI codebase:

1. **Bordered session header** — a new `renderSessionHeader()` function using the existing `pkg/panel` package renders a single bordered box with agent name, session ID, model, subject, and workspaces
2. **Global emoji removal** — removed all emoji characters from production code across `climsg`, inline renderer, display renderer, streaming renderer, `toolrender`, approval, and follow-up paths
3. **Think tool suppression** — added `IsThinkTool()` predicate and pre-switch interception to suppress `ToolRunningEvent` for think tools (same pattern as read tools)
4. **Phase noise reduction** — reduced `renderPhaseChange` to only emit output for `failed` and `cancelled` phases
5. **Inter-tool spacing** — added trailing blank line after multi-line tool outputs in `renderToolCompleted` and `flushPendingReads`

## Implementation Details

### Session Header (`run_stream_inline_header.go`)

New file with `sessionHeaderInfo` struct and `renderSessionHeader()` that formats aligned key-value pairs via `panel.Render()`. Two call sites: `executeResolvedAgent` (new execution) and `openSession`/`resumeSession` (session resume). Replaced 6 scattered `climsg` calls across 4 files.

### Emoji Removal (17 files modified)

- `climsg.go`: Removed `ℹ` prefix from `Info()` — the colored style is sufficient
- `toolrender/render.go`: Removed `icon` field from `toolDisplayInfo` struct and all `toolDisplayMap` entries; updated `StateBadge` to use text badges (`...`, `||`, `~`)
- `render_known.go`: Removed icon from `renderKnownHeader` format; changed `renderUnknownHeader` from `🔧` to `*`
- `run_stream_inline.go`: Removed emojis from 12 locations including stream cancelled, sub-agent AI, human message, system message, plan/todo, done, stream error, and agent prefix
- `run_display.go` / `run_display_stream.go`: Removed emojis from `formatNonTUIAIText`, `displaySystemMessage`, `displayAgentPhaseChange`, `displayWorkflowPhaseChange`, `displayWorkflowTask`, `displayHumanMessage`, and streaming AI prefix
- Approval and follow-up files: Changed emoji error prefixes to "Error:" text

### Think Tool Fix

Added `IsThinkTool()` predicate in `render_compact.go` checking `toolDisplayMap[toolName].label == "Thinking"`. Extended the existing read-tool suppression in `handleEvent` to also cover think tools, eliminating the double-render.

### Phase Noise Suppression

Reduced `renderPhaseChange` from a 15-line switch with 6 cases to a 7-line switch with 2 cases (`failed`, `cancelled`). All other phases are now silently absorbed — the session header and streaming activity provide sufficient context.

### Inter-Tool Spacing

After `renderToolCompleted` and `flushPendingReads`, a trailing blank line is emitted when the output contains newlines. Single-line outputs remain compact; multi-line outputs get breathing room.

## Benefits

- Professional, clean CLI output matching the quality bar of Claude Code
- Zero emoji characters in production rendering code — fully `NO_COLOR`-compatible
- No more duplicate think tool output confusing users
- Reduced visual noise from unnecessary phase change messages
- Better readability of multi-line tool outputs with proper spacing
- Single bordered header consolidates 4 scattered startup messages

## Impact

- **All CLI commands** — emoji removal in `climsg` affects every CLI command globally (doctor, apply, server, etc.)
- **Inline streaming** — session header, phase suppression, think fix, and spacing improve the primary user-facing output path
- **Workflow display** — emoji removal also covers the workflow task rendering path
- **Test suite** — 25+ test assertions updated to match the new emoji-free output

## Related Work

- Continues from the inline-first CLI project (Phases 1-5) completed earlier this session
- Builds on the Phase 2.2 "no emoji badges" decision that hadn't been fully implemented
- Uses `pkg/panel` introduced during the approval rendering phase (Phase 3.2)

---

**Status**: ✅ Production Ready
**Timeline**: Single session
