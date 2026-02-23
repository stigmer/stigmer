# Suppress LLM Echo of Attached File Contents

**Date**: February 23, 2026

## Summary

Added explicit anti-echo instructions to the agent runner's input files system prompt section, preventing agents from reprinting file contents after reading attachments. This is Phase 1 of the agent-thinking-flow project, targeting token waste and poor UX in file-heavy agent executions.

## Problem Statement

When agents receive attached files via `--attach`, the system prompt lists all files and instructs the agent to read them. After reading, the LLM echoes all file contents in its response ("Here are the complete contents of all 20 files:...").

### Pain Points

- Wastes output tokens (cost + latency) on content already in context
- Creates a terrible UX — wall of proto definitions or code the user didn't ask for
- Provides zero informational benefit since contents are already available from tool results

## Solution

Targeted system prompt change in the input files section of `execute_graphton.py`. Added three lines of instruction text telling the agent not to echo, reprint, or summarize file contents after reading — and to proceed directly to the task instead.

## Implementation Details

**File**: `backend/services/agent-runner/worker/activities/execute_graphton.py` (lines 1900-1905)

The input files system prompt section (behind the `if injected_files:` guard at line 1891) now ends with:

```
These files are available in your workspace. Read them using the read tool
with the paths shown above. After reading, do NOT echo, reprint, or
summarize the file contents in your response. The tool results are already
in your context — proceed directly to the task.
```

No logic changes, no tool changes, no API changes. Pure prompt text addition.

## Benefits

- Reduced output token usage for attachment-heavy executions (e.g., `stigmer draft skill --attach`)
- Cleaner agent output — agents proceed directly to the task instead of echoing input
- Matches the behavior of established tools like Cursor that read silently

## Impact

- **Agent runner**: All executions with file attachments get the updated prompt
- **Non-attachment executions**: Completely unaffected (guarded by `if injected_files:`)
- **Risk**: Near zero — additive prompt text, no behavioral regression path

## Related Work

- Part of the **20260223.01.agent-thinking-flow** project
- Phase 2 (think tool) and Phase 3 (CLI UX) are next

---

**Status**: ✅ Production Ready
