# Sub-Agent Subject Generation and TUI UX Redesign

**Date**: March 3, 2026

## Summary

Introduced server-side LLM-powered subject generation for sub-agent executions and redesigned the CLI TUI to show concise, meaningful labels in collapsed sub-agent headers with full details on expand. This brings the sub-agent display experience in line with Cursor's approach — short, descriptive summaries at a glance, full context on demand — and eliminates reliance on unpredictable `tool_args` descriptions from the calling LLM.

## Problem Statement

The CLI TUI displayed sub-agent executions using the raw sub-agent name (e.g., "general_purpose") alongside the full input text, which could be several paragraphs long. This created a cluttered, unreadable experience in collapsed view.

### Pain Points

- **No concise label**: The collapsed header showed the sub-agent type name and full input, providing no at-a-glance summary of what the sub-agent was doing
- **Unreliable descriptions**: The `description` field from `tool_args` was LLM-dependent — sometimes empty, sometimes overly verbose, sometimes a single word
- **No collapsed vs. expanded distinction**: Both states rendered identical content, making expansion meaningless
- **No server-side summary**: Unlike sessions (which generate subjects), sub-agent executions had no dedicated mechanism for generating concise display labels

## Solution

A three-layer change spanning Proto definitions, Python agent-runner, and Go CLI/TUI:

1. **Proto**: Added a dedicated `subject` field (`string subject = 13`) to `SubAgentExecution` for structured, queryable storage of generated summaries
2. **Agent-Runner**: Implemented inline LLM-based subject generation in `_handle_sub_agent_start`, using the platform's existing `ModelRegistry.get_summarization_model()` to select an economical model (e.g., Claude Haiku, GPT-4o-mini)
3. **CLI TUI**: Redesigned sub-agent headers with distinct collapsed (subject label) and expanded (type, input, output) views with graceful fallback cascades

## Implementation Details

### Proto Layer (`api.proto`)

Added `string subject = 13` to `SubAgentExecution` with clear documentation specifying its purpose, generation method, and example values. Regenerated Go and Python stubs plus MCP server codegen schemas.

### Agent-Runner (`status_builder.py`)

Added `_generate_sub_agent_subject()` async function that:
- Loads the platform config to determine the appropriate economical LLM
- Constructs a concise prompt requesting 3-7 word titles
- Truncates output to 50 characters
- Handles all failure modes gracefully (returns empty string on error)
- Integrated directly in `_handle_sub_agent_start` (changed to `async def`) with `force_next_update = True` for immediate TUI visibility

### CLI Bridge (`run_stream_subagent.go`)

Modified `emitSubAgentEvents` to prefer `sa.GetSubject()` over metadata description, with fallback chain for backward compatibility.

### TUI Rendering (`render_blocks.go`, `blocks.go`, `handle_events.go`, `model.go`)

- **`resolveSubAgentLabel()`**: Implements the display cascade: generated subject → metadata description → truncated input (first line, 60 chars) → sub-agent name
- **`renderSubAgentHeader()`**: Collapsed view shows the resolved label with tool count and status — no raw name cluttering the view
- **`renderSubAgentExpanded()`**: Expanded view reveals sub-agent type, gutter-bordered input (capped at 12 lines), and optional result output
- **`newSubAgentBlock()`**: Wires `preview` (collapsed) and `full` (expanded) to the distinct renderers
- **`subAgentInfo.Output`**: New field to store and display sub-agent completion output

### Test Coverage (`render_blocks_test.go`)

Updated all 9 existing `newSubAgentBlock` call sites to the new 6-parameter signature. Added 8 new tests covering: description-first preference, fallback to input, fallback to name, full cascade verification, expanded view content with type/input, output display, empty output suppression, and collapsed-vs-expanded content differentiation.

## Benefits

- **At-a-glance readability**: Users immediately see what each sub-agent is doing ("Explore CLI rendering", "Fix auth middleware tests") without parsing long input text
- **Consistent with session UX**: Sub-agents now follow the same subject-generation pattern as sessions, creating a unified experience
- **Graceful degradation**: The fallback cascade ensures every sub-agent has a meaningful label, even when subject generation fails
- **Expandable detail**: Full input and output are preserved and accessible on demand, not lost
- **Queryable subject**: Dedicated proto field enables future filtering and search by sub-agent summary

## Impact

- **End users**: Significantly improved readability of multi-agent execution output in the CLI
- **Platform consistency**: Sub-agent and session subject generation now share the same economical-model pattern
- **Latency trade-off**: ~200-500ms inline generation delay per sub-agent start, accepted for immediacy over background polling
- **Backward compatible**: Existing sub-agent executions without `subject` gracefully fall back to description or input

## Related Work

- Session subject generation (existing pattern this follows)
- Sub-agent execution tracking in `status_builder.py`
- TUI content block expand/collapse system

---

**Status**: ✅ Production Ready
**Timeline**: Single session, collaborative architecture + implementation
