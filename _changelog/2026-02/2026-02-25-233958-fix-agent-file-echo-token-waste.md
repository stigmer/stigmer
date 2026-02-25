# Fix Agent File-Content Echo Token Waste

**Date**: February 25, 2026

## Summary

Eliminated the sporadic behavior where agents echo full file contents in their response after reading files (e.g. "Below is the complete, verbatim content of every requested file..."). Three prompt-engineering changes address the root cause: how file access is framed in the system prompt.

## Problem Statement

During agent execution, the model sometimes dumps full file contents into its assistant text after using the `read` tool. This wastes output tokens (cost + latency), can exhaust the model's token budget, and creates a terrible UX. The behavior is sporadic because it originates from the LLM's tendency to "acknowledge" what it read.

### Pain Points

- Output tokens wasted on content already present in tool results
- Wall of file text that the user never asked for
- Token budget exhaustion on file-heavy executions (draft skill, draft agent)
- Previous fix (2026-02-23) only partially addressed this — it added anti-echo text to the Input Files section, but the model still echoed sporadically

## Solution

Three targeted prompt-design changes that eliminate the echo behavior at the source, matching how Cursor and similar tools handle this.

## Implementation Details

### 1. Global "Response rules" at end of system prompt

**File**: `backend/services/agent-runner/worker/activities/execute_graphton.py`

A new `## Response rules` section is **always** appended at the very end of `enhanced_system_prompt`, after both skills and input files sections. It is not gated on any condition because agents can read files via tools at any time.

Being last in the system prompt gives it maximum salience — the model processes these rules right before generating its first token.

### 2. Anti-echo in skills preamble

**File**: `backend/services/agent-runner/worker/activities/graphton/skill_writer.py`

The skills preamble previously said "To use a skill, read its SKILL.md" with zero anti-echo guidance. Added one line: "After reading skill files, do not reprint their contents — use them to guide your actions."

### 3. Reframed Input Files section

**File**: `backend/services/agent-runner/worker/activities/execute_graphton.py`

Changed the Input Files section framing from "these files are available, read them" (task-like, triggers reporting) to "these files have been provided as context... they are reference material, not output" (context-like, no impulse to report).

## Benefits

- Reduced output token waste for all agent executions that read files
- Cleaner agent responses — agents proceed directly to the task
- Aligns with how Cursor and other tools frame file access (context, not task)
- Global rule covers all read-tool usage, not just input files

## Impact

- **All agent executions**: The global response rule applies unconditionally
- **Input-file executions**: Reframed from task-oriented to context-oriented
- **Skill-based executions**: Skills preamble now includes anti-echo guidance
- **Risk**: Near zero — additive prompt text only, no logic or API changes

## Related Work

- Supersedes the partial fix from 2026-02-23 (`suppress-llm-echo-of-attached-file-contents`)
- Part of the `20260223.01.agent-thinking-flow` project (Phase 1 continuation)

---

**Status**: Production Ready
